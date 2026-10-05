import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { FreeBusyResult } from '@shared/invitation-types'
import { getSecret } from '../auth/secrets'
import { getDb } from '../db'
import { DavClient, DavError, type FetchLike } from '../dav'
import { child, children, NS, parseXml, textOf } from '../dav/xml'
import { calendarAccountAddresses, myAddresses, ownAddressOf } from './identity'
import {
  buildFreeBusyRequest,
  findMyAttendee,
  mergeBusy,
  parseFreeBusy,
  ridKey,
  type BusyInterval
} from './itip'
import { parseCalendar, readAttendees, splitComponents, vtimezonesOf } from './ics'
import { calSecretKey, getCalAccount, type CalAccountRow } from './repo'
import { listEvents } from './service'
import { systemTimeZone, wallToUtcIana } from './tz'

/**
 * Free/Busy: eigene Belegung aus der lokalen DB (`calendar:freebusy:self`) und
 * die anderer Teilnehmer per CalDAV-Scheduling-Outbox (RFC 6638 §5: POST einer
 * VFREEBUSY-Anfrage). Ohne Server-Unterstützung: nur "ich" aus den eigenen
 * Kalendern, alle anderen `unavailable`.
 */

const MAX_RANGE_MS = 62 * 24 * 3600_000
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

export interface FreeBusyDeps {
  fetch?: FetchLike
  getPassword?: (accountId: number) => string | null
  now?: () => number
  newUid?: () => string
}

// --- Eigene Belegung --------------------------------------------------------------------------------------

export interface SelfBusyInput {
  rangeStart: number
  rangeEnd: number
  calendarIds?: number[]
  /** Dieser Termin zählt nicht als belegt (Editor: der Termin selbst) */
  excludeObjectId?: number
}

/**
 * Belegte Zeiten aus allen (oder den angegebenen) Kalendern: ohne abgesagte
 * Termine, ohne TRANSPARENT (frei) und ohne von mir abgelehnte; TENTATIVE
 * (Status oder PARTSTAT) zählt als BUSY-TENTATIVE.
 */
export function selfBusy(input: SelfBusyInput, db: Database.Database = getDb()): BusyInterval[] {
  if (!(input.rangeEnd > input.rangeStart)) return []
  const range = Math.min(input.rangeEnd, input.rangeStart + MAX_RANGE_MS * 3)
  const calendarIds =
    input.calendarIds ??
    (
      db
        .prepare(`SELECT id FROM calendars WHERE (',' || components || ',') LIKE '%,VEVENT,%'`)
        .all() as Array<{ id: number }>
    ).map((r) => r.id)
  const mine = myAddresses(db)
  const events = listEvents({ rangeStart: input.rangeStart, rangeEnd: range, calendarIds }, db)
  const zone = systemTimeZone()
  const cache = new Map<number, { ics: string } | null>()
  const out: BusyInterval[] = []
  for (const e of events) {
    if (e.status === 'CANCELLED' || e.objectId === input.excludeObjectId) continue
    let cached = cache.get(e.objectId)
    if (cached === undefined) {
      const row = db.prepare('SELECT ics FROM cal_objects WHERE id = ?').get(e.objectId) as
        { ics: string } | undefined
      cached = row ?? null
      cache.set(e.objectId, cached)
    }
    let tentative = e.status === 'TENTATIVE'
    if (cached) {
      const flags = occurrenceFlags(cached.ics, e.recurrenceId, mine)
      if (flags.transparent || flags.declined) continue
      tentative = tentative || flags.tentative
    }
    let start = e.startUtc
    let end = e.endUtc
    if (e.allDay && e.startDay && e.endDay) {
      // Ganztägig: lokale Mitternacht statt UTC-Mitternacht
      const [sy, sm, sd] = e.startDay.split('-').map(Number)
      const [ey, em, ed] = e.endDay.split('-').map(Number)
      start = wallToUtcIana({ y: sy, m: sm, d: sd, h: 0, mi: 0, s: 0 }, zone)
      end = wallToUtcIana({ y: ey, m: em, d: ed, h: 0, mi: 0, s: 0 }, zone)
    }
    out.push({
      startUtc: Math.max(start, input.rangeStart),
      endUtc: Math.min(end, input.rangeEnd),
      type: tentative ? 'BUSY-TENTATIVE' : 'BUSY'
    })
  }
  return mergeBusy(out)
}

function occurrenceFlags(
  ics: string,
  recurrenceId: string | null,
  mine: ReadonlySet<string>
): { transparent: boolean; declined: boolean; tentative: boolean } {
  try {
    const root = parseCalendar(ics)
    const vtz = vtimezonesOf(root)
    const { master, overrides } = splitComponents(root, 'vevent')
    const comp =
      (recurrenceId && overrides.find((o) => ridKey(o, vtz) === recurrenceId)) ||
      master ||
      overrides[0]
    if (!comp) return { transparent: false, declined: false, tentative: false }
    const transp = String(comp.getFirstPropertyValue('transp') ?? '').toUpperCase()
    const me = findMyAttendee(readAttendees(comp), mine)
    return {
      transparent: transp === 'TRANSPARENT',
      declined: me?.partstat === 'DECLINED',
      tentative: me?.partstat === 'TENTATIVE'
    }
  } catch {
    return { transparent: false, declined: false, tentative: false }
  }
}

// --- Scheduling-Outbox ----------------------------------------------------------------------------------------

export interface ScheduleRecipientResult {
  email: string
  ok: boolean
  status: string | null
  busy: BusyInterval[]
}

/** Antwort des Scheduling-Outbox (schedule-response, RFC 6638 §10.1) lesen. */
export function parseScheduleResponse(xml: string): ScheduleRecipientResult[] {
  const out: ScheduleRecipientResult[] = []
  let root
  try {
    root = parseXml(xml)
  } catch {
    return out
  }
  for (const resp of children(root, NS.caldav, 'response')) {
    const href = textOf(child(child(resp, NS.caldav, 'recipient'), NS.dav, 'href'))
    const email = href
      ? href
          .replace(/^mailto:/i, '')
          .trim()
          .toLowerCase()
      : null
    if (!email) continue
    const status = textOf(child(resp, NS.caldav, 'request-status'))
    const data = textOf(child(resp, NS.caldav, 'calendar-data'))
    // "2.0;Success" (auch 2.x) = Erfolg; 3.x/5.x = Fehler (z. B. 3.7 Invalid calendar user)
    const ok = status !== null && /^2\./.test(status)
    out.push({ email, ok, status, busy: ok && data ? parseFreeBusy(data) : [] })
  }
  return out
}

export interface FreeBusyQuery {
  accountId: number
  attendees: string[]
  rangeStart: number
  rangeEnd: number
}

/**
 * Busy-Intervalle je Adresse. „Ich" kommt immer aus der lokalen DB (aktuell,
 * auch mit wartenden Änderungen); alle anderen per Scheduling-Outbox, falls
 * das Konto es kann, sonst `unavailable`.
 */
export async function queryFreeBusy(
  query: FreeBusyQuery,
  db: Database.Database = getDb(),
  deps: FreeBusyDeps = {}
): Promise<FreeBusyResult[]> {
  const { rangeStart, rangeEnd } = query
  if (!(rangeEnd > rangeStart) || rangeEnd - rangeStart > MAX_RANGE_MS) {
    throw new Error('Ungültiger Zeitraum (maximal 62 Tage)')
  }
  const account = getCalAccount(db, query.accountId)
  if (!account) throw new Error('Kalender-Konto nicht gefunden')
  const mine = myAddresses(db)
  const emails: string[] = []
  for (const raw of query.attendees) {
    const e = raw
      .trim()
      .replace(/^mailto:/i, '')
      .toLowerCase()
    if (EMAIL_RE.test(e) && !emails.includes(e)) emails.push(e)
  }
  const results = new Map<string, FreeBusyResult>()
  const others: string[] = []
  for (const e of emails) {
    if (mine.has(e)) {
      results.set(e, {
        email: e,
        source: 'local',
        busy: selfBusy({ rangeStart, rangeEnd }, db),
        error: null
      })
    } else others.push(e)
  }

  if (others.length > 0) {
    const server = await serverFreeBusy(account, others, rangeStart, rangeEnd, db, deps)
    for (const e of others) {
      results.set(e, server.get(e) ?? { email: e, source: 'unavailable', busy: [], error: null })
    }
  }
  return emails.map((e) => results.get(e)!)
}

async function serverFreeBusy(
  account: CalAccountRow,
  emails: string[],
  rangeStart: number,
  rangeEnd: number,
  db: Database.Database,
  deps: FreeBusyDeps
): Promise<Map<string, FreeBusyResult>> {
  const out = new Map<string, FreeBusyResult>()
  const unavailable = (error: string | null): Map<string, FreeBusyResult> => {
    for (const e of emails) out.set(e, { email: e, source: 'unavailable', busy: [], error })
    return out
  }
  // schedule-outbox-URL wird nur von Servern mit Scheduling (RFC 6638) angeboten
  if (!account.schedule_outbox_url) return unavailable(null)
  const organizer = ownAddressOf(db, account) ?? calendarAccountAddresses(account)[0]
  if (!organizer) return unavailable('Eigene Adresse unbekannt')
  const password = (deps.getPassword ?? ((id) => getSecret(calSecretKey(id))))(account.id)
  if (!password) return unavailable('Kein Passwort für das Kalender-Konto')
  const client = new DavClient({ username: account.username, password, fetch: deps.fetch })
  const now = deps.now?.() ?? Date.now()
  const body = buildFreeBusyRequest({
    organizer,
    attendees: emails,
    rangeStart,
    rangeEnd,
    uid: deps.newUid?.() ?? `${randomUUID()}@noctua`,
    now
  })
  try {
    const res = await client.request('POST', account.schedule_outbox_url, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        Originator: `mailto:${organizer}`,
        Recipient: emails.map((e) => `mailto:${e}`).join(', ')
      },
      body
    })
    for (const r of parseScheduleResponse(res.text)) {
      if (!emails.includes(r.email)) continue
      out.set(r.email, {
        email: r.email,
        source: r.ok ? 'server' : 'unavailable',
        busy: r.busy,
        error: r.ok ? null : (r.status ?? 'Keine Auskunft')
      })
    }
    return out
  } catch (error) {
    return unavailable(error instanceof DavError ? error.message : 'Free/Busy nicht abrufbar')
  }
}
