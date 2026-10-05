import type Database from 'better-sqlite3-multiple-ciphers'
import type { CalendarAttendee } from '@shared/calendar-types'
import type { InvitationRespondInput, InvitationView, RsvpPartstat } from '@shared/invitation-types'
import { getSetting } from '../db'
import type { ParsedCalendarPart } from '../mail/parser'
import { defaultEditContext, type EditContext } from './edit'
import { myAddresses } from './identity'
import { readAttendees, parseCalendar, splitComponents, vtimezonesOf } from './ics'
import {
  buildReplyIcs,
  buildStoredCopy,
  compareRevision,
  findMyAttendee,
  mergeInvitation,
  organizerOf,
  parseItip,
  ridKey,
  setAttendeePartstat,
  type ItipMessage,
  type Partstat
} from './itip'
import { itipSubject, replyBody, sendItipMail, type MailLang } from './mailer'
import {
  getCalAccount,
  getCalendar,
  type CalAccountRow,
  type CalendarRow,
  type CalObjectRow
} from './repo'
import { applyIcsToObject, createObjectFromIcs, deleteEvent } from './service'

/**
 * Eingehende Einladungen (iMIP): Parsen beim Ingest, Karte für die Mail-Ansicht,
 * RSVP und Verarbeitung von Antworten. Mails sind untrusted — es wird nie ohne
 * Nutzeraktion ein Termin angelegt. Einzige Ausnahme: ein REPLY, der den
 * PARTSTAT eines Teilnehmers an einem Termin aktualisiert, den WIR organisieren,
 * und dessen Absender-Adresse zum Teilnehmer passt.
 */

const MAX_PARTS_PER_MESSAGE = 4
const VISIBLE_METHODS = new Set(['REQUEST', 'CANCEL', 'REPLY', 'COUNTER'])

export interface InvitationRow {
  id: number
  message_id: number
  part_index: number
  uid: string
  method: string
  sequence: number
  dtstamp: number | null
  organizer: string | null
  organizer_name: string | null
  summary: string | null
  location: string | null
  description: string | null
  start_utc: number | null
  end_utc: number | null
  all_day: number
  start_day: string | null
  end_day: string | null
  tzid: string | null
  rrule: string | null
  recurrence_id: string | null
  attendees_json: string
  my_address: string | null
  my_partstat: string | null
  ics: string
  cal_object_id: number | null
  state: string
  responded_partstat: string | null
  responded_at: number | null
  created_at: number
}

function lang(): MailLang {
  return getSetting('ui.language') === 'en' ? 'en' : 'de'
}

// --- Kalenderobjekt zur UID ------------------------------------------------------------------------

/** Termin im Kalender des Nutzers (per UID). Bevorzugt Konten mit Server-Scheduling. */
export function findObjectByUid(db: Database.Database, uid: string): CalObjectRow | undefined {
  return db
    .prepare(
      `SELECT o.* FROM cal_objects o
         JOIN calendars c ON c.id = o.calendar_id
         JOIN cal_accounts a ON a.id = c.account_id
        WHERE o.uid = ? AND o.component = 'VEVENT' AND o.pending_op IS NOT 'delete'
        ORDER BY a.auto_schedule DESC, o.id LIMIT 1`
    )
    .get(uid) as CalObjectRow | undefined
}

function accountOfObject(db: Database.Database, obj: CalObjectRow): CalAccountRow | undefined {
  const cal = getCalendar(db, obj.calendar_id)
  return cal ? getCalAccount(db, cal.account_id) : undefined
}

/** Standardkalender für „Annehmen": erster beschreibbarer VEVENT-Kalender des passenden Kontos. */
export function suggestCalendarId(
  db: Database.Database,
  mailAccountId: number,
  address: string | null
): number | null {
  const calendars = db
    .prepare(
      `SELECT c.*, a.mail_account_id, a.username, a.user_addresses FROM calendars c
         JOIN cal_accounts a ON a.id = c.account_id
        WHERE c.read_only = 0 AND (',' || c.components || ',') LIKE '%,VEVENT,%'
        ORDER BY c.account_id, c.sort_order, c.id`
    )
    .all() as Array<
    CalendarRow & { mail_account_id: number | null; username: string; user_addresses: string }
  >
  if (calendars.length === 0) return null
  const addr = address?.toLowerCase() ?? null
  const matches = calendars.filter(
    (c) =>
      c.mail_account_id === mailAccountId ||
      (addr !== null &&
        (c.username.toLowerCase() === addr || c.user_addresses.toLowerCase().includes(addr)))
  )
  if (matches.length > 0) return matches[0].id
  const configured = Number(getSetting('calendar.defaultCalendarId') ?? '')
  if (Number.isFinite(configured) && calendars.some((c) => c.id === configured)) return configured
  return calendars[0].id
}

// --- Ingest ---------------------------------------------------------------------------------------

/**
 * Speichert die Einladungsteile einer Mail (aus storeBody). Wirft nie — eine
 * kaputte Einladung darf den Mail-Abruf nicht stören.
 */
export function storeInvitations(
  db: Database.Database,
  messageId: number,
  parts: ParsedCalendarPart[] | undefined
): void {
  if (!parts || parts.length === 0) return
  try {
    const msg = db
      .prepare('SELECT account_id, from_addr FROM messages WHERE id = ?')
      .get(messageId) as { account_id: number; from_addr: string | null } | undefined
    if (!msg) return
    const account = db.prepare('SELECT email FROM accounts WHERE id = ?').get(msg.account_id) as
      { email: string } | undefined
    const mine = myAddresses(db)
    const seen = new Set<string>()
    let index = 0
    for (const part of parts.slice(0, MAX_PARTS_PER_MESSAGE)) {
      const parsed = parseItip(part.content, part.method)
      if (!parsed) continue
      // text/calendar-Alternative und .ics-Anhang sind dieselbe Einladung
      const key = `${parsed.method}|${parsed.uid}|${parsed.sequence}|${parsed.recurrenceId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const partIndex = index++
      const meAtt = findMyAttendee(parsed.attendees, mine)
      const myAddress =
        parsed.method === 'REPLY' ? null : (meAtt?.email ?? account?.email.toLowerCase() ?? null)
      const obj = findObjectByUid(db, parsed.uid)
      db.prepare(
        `INSERT INTO invitations (message_id, part_index, uid, method, sequence, dtstamp, organizer,
           organizer_name, summary, location, description, start_utc, end_utc, all_day, start_day,
           end_day, tzid, rrule, recurrence_id, attendees_json, my_address, my_partstat, ics,
           cal_object_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(message_id, part_index) DO UPDATE SET
           uid = excluded.uid, method = excluded.method, sequence = excluded.sequence,
           dtstamp = excluded.dtstamp, organizer = excluded.organizer,
           organizer_name = excluded.organizer_name, summary = excluded.summary,
           location = excluded.location, description = excluded.description,
           start_utc = excluded.start_utc, end_utc = excluded.end_utc, all_day = excluded.all_day,
           start_day = excluded.start_day, end_day = excluded.end_day, tzid = excluded.tzid,
           rrule = excluded.rrule, recurrence_id = excluded.recurrence_id,
           attendees_json = excluded.attendees_json, my_address = excluded.my_address,
           my_partstat = excluded.my_partstat, ics = excluded.ics,
           cal_object_id = excluded.cal_object_id`
      ).run(
        messageId,
        partIndex,
        parsed.uid,
        parsed.method,
        parsed.sequence,
        parsed.dtstamp,
        parsed.organizer?.email ?? null,
        parsed.organizer?.name ?? null,
        parsed.summary,
        parsed.location,
        parsed.description,
        parsed.startUtc,
        parsed.endUtc,
        parsed.allDay ? 1 : 0,
        parsed.startDay,
        parsed.endDay,
        parsed.tzid,
        parsed.rrule,
        parsed.recurrenceId,
        JSON.stringify(parsed.attendees),
        myAddress,
        meAtt?.partstat ?? null,
        parsed.ics,
        obj?.id ?? null,
        Date.now()
      )
      if (parsed.method === 'REPLY') {
        const row = db
          .prepare('SELECT id FROM invitations WHERE message_id = ? AND part_index = ?')
          .get(messageId, partIndex) as { id: number }
        processReply(db, row.id, parsed, msg.from_addr)
      }
    }
  } catch (error) {
    console.warn(
      `[invitations] Einladung nicht verarbeitet: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Antwort eines Teilnehmers (REPLY). Wird nur übernommen, wenn
 * (a) wir Organisator des Termins sind, (b) der Absender der Mail genau dem
 * Teilnehmer entspricht, dessen PARTSTAT sich ändert (Spoofing-Schutz),
 * (c) der Teilnehmer in unserem Termin steht und (d) die Antwort nicht auf
 * einer älteren SEQUENCE beruht. Alles andere wird ignoriert.
 */
function processReply(
  db: Database.Database,
  invitationId: number,
  reply: ItipMessage,
  senderAddr: string | null
): void {
  const setState = (state: string): void => {
    db.prepare('UPDATE invitations SET state = ? WHERE id = ?').run(state, invitationId)
  }
  const sender = senderAddr?.toLowerCase() ?? null
  const att = sender ? reply.attendees.find((a) => a.email.toLowerCase() === sender) : undefined
  const partstat = att?.partstat
  if (!att || !partstat || !['ACCEPTED', 'TENTATIVE', 'DECLINED'].includes(partstat)) {
    setState('reply-ignored')
    return
  }
  const obj = findObjectByUid(db, reply.uid)
  const mine = myAddresses(db)
  if (!obj || !mine.has(organizerOf(obj.ics) ?? '') || reply.sequence < obj.sequence) {
    setState('reply-ignored')
    return
  }
  const res = setAttendeePartstat(
    obj.ics,
    new Set([att.email.toLowerCase()]),
    partstat,
    reply.recurrenceId
  )
  if (!res.matched) {
    setState('reply-ignored')
    return
  }
  if (res.changed) {
    try {
      applyIcsToObject(obj.id, res.ics, db)
    } catch (error) {
      // z. B. schreibgeschützter Kalender
      console.warn(
        `[invitations] Antwort nicht übernommen: ${error instanceof Error ? error.message : String(error)}`
      )
      setState('reply-ignored')
      return
    }
  }
  db.prepare('UPDATE invitations SET state = ?, cal_object_id = ? WHERE id = ?').run(
    'reply-applied',
    obj.id,
    invitationId
  )
}

// --- Ansicht ----------------------------------------------------------------------------------------

function parseAttendeesJson(json: string): CalendarAttendee[] {
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? (v as CalendarAttendee[]) : []
  } catch {
    return []
  }
}

/** PARTSTAT des Nutzers im gespeicherten Termin (für das Vorkommen, sonst Stamm). */
function storedPartstat(
  ics: string,
  mine: ReadonlySet<string>,
  recurrenceId: string | null
): { partstat: string | null; hasMe: boolean } {
  try {
    const root = parseCalendar(ics)
    const vtz = vtimezonesOf(root)
    const { master, overrides } = splitComponents(root, 'vevent')
    const comp =
      (recurrenceId && overrides.find((o) => ridKey(o, vtz) === recurrenceId)) ||
      master ||
      overrides[0]
    if (!comp) return { partstat: null, hasMe: false }
    const me = findMyAttendee(readAttendees(comp), mine)
    return { partstat: me?.partstat ?? null, hasMe: me !== undefined }
  } catch {
    return { partstat: null, hasMe: false }
  }
}

function isOutdated(
  db: Database.Database,
  row: InvitationRow,
  obj: CalObjectRow | undefined
): boolean {
  if (row.method !== 'REQUEST' && row.method !== 'CANCEL') return false
  if (obj && row.recurrence_id === null && obj.sequence > row.sequence) return true
  const others = db
    .prepare(
      `SELECT sequence, dtstamp FROM invitations
        WHERE uid = ? AND recurrence_id IS ? AND method IN ('REQUEST', 'CANCEL') AND id != ?`
    )
    .all(row.uid, row.recurrence_id, row.id) as Array<{ sequence: number; dtstamp: number | null }>
  return others.some(
    (o) => compareRevision(o, { sequence: row.sequence, dtstamp: row.dtstamp }) > 0
  )
}

export function toInvitationView(
  db: Database.Database,
  row: InvitationRow,
  senderAddr: string | null,
  mailAccountId: number
): InvitationView {
  const mine = myAddresses(db)
  const attendees = parseAttendeesJson(row.attendees_json)
  const obj = findObjectByUid(db, row.uid)
  const cal = obj ? getCalendar(db, obj.calendar_id) : undefined
  const account = obj ? accountOfObject(db, obj) : undefined
  const stored = obj ? storedPartstat(obj.ics, mine, row.recurrence_id) : null
  const organizerIsMe = obj ? mine.has(organizerOf(obj.ics) ?? '') : false
  const serverHandlesReply =
    !!obj && account?.auto_schedule === 1 && stored?.hasMe === true && !organizerIsMe
  const replyAtt = row.method === 'REPLY' ? attendees[0] : undefined
  const orgEmail = row.organizer
  return {
    id: row.id,
    messageId: row.message_id,
    method: row.method as InvitationView['method'],
    uid: row.uid,
    sequence: row.sequence,
    summary: row.summary,
    location: row.location,
    description: row.description,
    organizer: orgEmail ? { email: orgEmail, name: row.organizer_name } : null,
    senderMismatch:
      (row.method === 'REQUEST' || row.method === 'CANCEL') &&
      !!orgEmail &&
      !!senderAddr &&
      orgEmail.toLowerCase() !== senderAddr.toLowerCase(),
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    allDay: row.all_day === 1,
    startDay: row.start_day,
    endDay: row.end_day,
    tzid: row.tzid,
    rrule: row.rrule,
    recurrenceId: row.recurrence_id,
    attendeeCount: attendees.length,
    attendees: attendees.slice(0, 20),
    myAddress: row.my_address,
    myPartstat: row.my_partstat,
    state: row.state as InvitationView['state'],
    respondedPartstat: row.responded_partstat,
    outdated: isOutdated(db, row, obj),
    localEvent:
      obj && cal
        ? {
            objectId: obj.id,
            calendarId: cal.id,
            calendarName: cal.display_name,
            myPartstat: stored?.partstat ?? null,
            recurrenceId: row.recurrence_id
          }
        : null,
    suggestedCalendarId: suggestCalendarId(db, mailAccountId, row.my_address),
    serverHandlesReply,
    reply: replyAtt
      ? { email: replyAtt.email, name: replyAtt.name, partstat: replyAtt.partstat }
      : null
  }
}

/** Einladungskarten einer Nachricht (nur REQUEST/CANCEL/REPLY/COUNTER). */
export function getInvitationsForMessage(
  db: Database.Database,
  messageId: number
): InvitationView[] {
  const msg = db
    .prepare('SELECT account_id, from_addr FROM messages WHERE id = ?')
    .get(messageId) as { account_id: number; from_addr: string | null } | undefined
  if (!msg) return []
  const rows = db
    .prepare('SELECT * FROM invitations WHERE message_id = ? ORDER BY part_index')
    .all(messageId) as InvitationRow[]
  return rows
    .filter((r) => VISIBLE_METHODS.has(r.method))
    .map((r) => toInvitationView(db, r, msg.from_addr, msg.account_id))
}

// --- RSVP -----------------------------------------------------------------------------------------------

export interface RespondResult {
  path: 'server' | 'imip' | 'local'
  objectId: number | null
  mailQueued: boolean
}

function requireRow(db: Database.Database, id: number): InvitationRow {
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id) as
    InvitationRow | undefined
  if (!row) throw new Error('Einladung nicht gefunden')
  return row
}

function markResponded(db: Database.Database, row: InvitationRow, partstat: string): void {
  // Alle Mails zu demselben Termin zeigen den neuen Stand
  db.prepare(
    `UPDATE invitations SET state = 'responded', responded_partstat = ?, responded_at = ?
      WHERE uid = ? AND recurrence_id IS ? AND method = 'REQUEST'`
  ).run(partstat, Date.now(), row.uid, row.recurrence_id)
}

/**
 * Antwortweg bestimmen (reine Entscheidung, getrennt testbar):
 * - 'server': Termin liegt schon in einem Konto mit calendar-auto-schedule und enthält
 *   uns als ATTENDEE → nur PARTSTAT per PUT ändern, der Server verschickt die Antwort.
 *   KEINE iMIP-Mail (sonst doppelte Antwort beim Organisator).
 * - 'imip': sonst Termin lokal speichern (SCHEDULE-AGENT=CLIENT am ORGANIZER, damit der
 *   Server nicht zusätzlich antwortet) und die Antwort per Mail über die Outbox senden.
 */
export function chooseRsvpPath(db: Database.Database, row: InvitationRow): 'server' | 'imip' {
  const obj = findObjectByUid(db, row.uid)
  if (!obj) return 'imip'
  const account = accountOfObject(db, obj)
  if (account?.auto_schedule !== 1) return 'imip'
  const mine = myAddresses(db)
  if (mine.has(organizerOf(obj.ics) ?? '')) return 'imip'
  return storedPartstat(obj.ics, mine, row.recurrence_id).hasMe ||
    storedPartstat(obj.ics, mine, null).hasMe
    ? 'server'
    : 'imip'
}

export function respondToInvitation(
  db: Database.Database,
  input: InvitationRespondInput,
  ctx: EditContext = defaultEditContext()
): RespondResult {
  const row = requireRow(db, input.invitationId)
  if (row.method !== 'REQUEST') throw new Error('Auf diese Nachricht kann nicht geantwortet werden')
  const msg = db.prepare('SELECT account_id FROM messages WHERE id = ?').get(row.message_id) as
    { account_id: number } | undefined
  if (!msg) throw new Error('Nachricht nicht gefunden')
  const obj = findObjectByUid(db, row.uid)
  if (isOutdated(db, row, obj)) throw new Error('Diese Einladung ist veraltet')
  const partstat: RsvpPartstat = input.partstat
  const comment = input.comment?.trim() || undefined

  // Doppelversand vermeiden: dieselbe Antwort ohne neuen Kommentar nicht erneut senden
  if (row.state === 'responded' && row.responded_partstat === partstat && !comment) {
    return { path: chooseRsvpPath(db, row), objectId: obj?.id ?? null, mailQueued: false }
  }

  const mine = myAddresses(db)
  const path = chooseRsvpPath(db, row)

  if (path === 'server' && obj) {
    // Server-Scheduling: PARTSTAT der Serverkopie ändern (PUT mit If-Match über die Sync-Op);
    // der Server schickt die Antwort an den Organisator.
    const res = setAttendeePartstat(obj.ics, mine, partstat, row.recurrence_id, ctx)
    if (res.changed) applyIcsToObject(obj.id, res.ics, db)
    markResponded(db, row, partstat)
    return { path: 'server', objectId: obj.id, mailQueued: false }
  }

  // iMIP-Weg
  const myAddress = (row.my_address ?? '').toLowerCase()
  if (!myAddress) throw new Error('Eigene Adresse in der Einladung nicht erkennbar')
  const organizer = row.organizer
  if (!organizer) throw new Error('Die Einladung enthält keinen Organisator')
  const mineWithMe = new Set([...mine, myAddress])

  let objectId: number | null = obj?.id ?? null
  if (partstat === 'DECLINED') {
    // Absage: Termin nicht (mehr) im Kalender führen
    if (obj && !mine.has(organizerOf(obj.ics) ?? '')) {
      deleteEvent(obj.id, row.recurrence_id ? 'this' : 'all', row.recurrence_id, db, ctx, {
        notifyAttendees: false
      })
      objectId = null
    }
  } else {
    const stored = buildStoredCopy(row.ics, {
      myAddresses: mineWithMe,
      partstat,
      scheduleAgentClient: true
    })
    if (obj) {
      applyIcsToObject(obj.id, mergeInvitation(obj.ics, stored), db)
    } else {
      const calendarId = input.calendarId ?? suggestCalendarId(db, msg.account_id, myAddress)
      if (calendarId === null) throw new Error('Kein beschreibbarer Kalender vorhanden')
      objectId = createObjectFromIcs(calendarId, row.uid, stored, db)
    }
  }

  const account = db
    .prepare('SELECT email, display_name FROM accounts WHERE id = ?')
    .get(msg.account_id) as { email: string; display_name: string | null } | undefined
  const attendee = parseAttendeesJson(row.attendees_json).find(
    (a) => a.email.toLowerCase() === myAddress
  )
  const name = attendee?.name ?? account?.display_name ?? null
  const l = lang()
  const ics = buildReplyIcs(row.ics, {
    attendeeEmail: myAddress,
    attendeeName: name,
    partstat: partstat as Partstat,
    comment,
    now: ctx.now
  })
  sendItipMail(msg.account_id, {
    to: [organizer],
    subject: itipSubject(l, partstat as Partstat, row.summary),
    text: replyBody(l, {
      who: name ?? myAddress,
      partstat: partstat as Partstat,
      summary: row.summary,
      comment
    }),
    method: 'REPLY',
    ics
  })
  markResponded(db, row, partstat)
  return { path: 'imip', objectId, mailQueued: true }
}

// --- Absage übernehmen ----------------------------------------------------------------------------------

/**
 * „Aus Kalender entfernen" nach einer Absage (CANCEL). Nur wenn der Organisator
 * des gespeicherten Termins der Organisator der Absage ist (sonst könnte jeder
 * fremde Termine „absagen") und die Absage nicht veraltet ist.
 */
export function removeCancelledEvent(
  db: Database.Database,
  invitationId: number,
  ctx: EditContext = defaultEditContext()
): void {
  const row = requireRow(db, invitationId)
  if (row.method !== 'CANCEL') throw new Error('Keine Absage')
  const obj = findObjectByUid(db, row.uid)
  if (!obj) {
    db.prepare(`UPDATE invitations SET state = 'removed' WHERE id = ?`).run(row.id)
    return
  }
  const storedOrganizer = organizerOf(obj.ics)
  if (!storedOrganizer || !row.organizer || storedOrganizer !== row.organizer.toLowerCase()) {
    throw new Error('Der Absender der Absage ist nicht der Organisator des Termins')
  }
  if (isOutdated(db, row, obj)) throw new Error('Diese Absage ist veraltet')
  const recurring = row.recurrence_id !== null && /RRULE|RDATE/i.test(obj.ics)
  deleteEvent(obj.id, recurring ? 'this' : 'all', recurring ? row.recurrence_id : null, db, ctx, {
    notifyAttendees: false
  })
  db.prepare(`UPDATE invitations SET state = 'removed' WHERE uid = ? AND method = 'CANCEL'`).run(
    row.uid
  )
}
