import type Database from 'better-sqlite3-multiple-ciphers'
import type {
  CalendarAccountSummary,
  CalendarEditScope,
  CalendarEventDetail,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarInstance,
  CalendarSummary
} from '@shared/calendar-types'
import { getDb } from '../db'
import { createEventIcs, deleteFromIcs, updateIcs, type EditContext } from './edit'
import {
  dateStringToUtcMs,
  eventTimes,
  exdatesOf,
  expandResource,
  parseCalendar,
  readFields,
  splitComponents,
  vtimezonesOf,
  wallToDateString,
  type Occurrence
} from './ics'
import {
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  getCalendar,
  getInstanceWindow,
  getObject,
  type CalAccountRow,
  type CalendarRow,
  type CalObjectRow
} from './repo'
import { calendarSync } from './sync'
import { systemTimeZone, resolveZone } from './tz'

/**
 * Domain-API des Kalenders. Alle Schreibzugriffe sind optimistisch: sofort in
 * der lokalen DB (und damit in listEvents), die Übertragung zum Server läuft
 * über cal_pending_ops und die Sync-Engine.
 */

type ChangedFn = (accountId: number, calendarIds: number[]) => void
let changedFn: ChangedFn = () => {}

/** Vom Bootstrap gesetzt: Push `calendar:changed` nach lokalen Änderungen. */
export function setCalendarChangedHandler(fn: ChangedFn): void {
  changedFn = fn
}

// --- Konten & Kalender -----------------------------------------------------------------------

export function accountSummary(
  db: Database.Database,
  row: CalAccountRow,
  state?: { state: CalendarAccountSummary['state']; errorSince: number | null }
): CalendarAccountSummary {
  const engine = calendarSync.getState(row.id)
  const count = (
    db.prepare('SELECT count(*) n FROM calendars WHERE account_id = ?').get(row.id) as { n: number }
  ).n
  const ops = db
    .prepare(
      `SELECT sum(status = 'pending') p, sum(status = 'dead') d FROM cal_pending_ops WHERE account_id = ?`
    )
    .get(row.id) as { p: number | null; d: number | null }
  return {
    id: row.id,
    name: row.name,
    serverUrl: row.server_url,
    username: row.username,
    mailAccountId: row.mail_account_id,
    // Läuft die Engine nicht (z. B. gestoppt), zeigt die zuletzt gespeicherte Zustandsinfo
    state: state?.state ?? (engine.state === 'off' ? (row.state as never) : engine.state),
    lastError: engine.state === 'off' ? row.last_error : engine.detail,
    errorSince: state?.errorSince ?? engine.errorSince,
    lastSync: row.last_sync,
    autoSchedule: row.auto_schedule === 1,
    calendarCount: count,
    pendingOps: ops.p ?? 0,
    deadOps: ops.d ?? 0
  }
}

export function listAccounts(db: Database.Database = getDb()): CalendarAccountSummary[] {
  const rows = db.prepare('SELECT * FROM cal_accounts ORDER BY id').all() as CalAccountRow[]
  return rows.map((r) => accountSummary(db, r))
}

function toCalendarSummary(c: CalendarRow): CalendarSummary {
  return {
    id: c.id,
    accountId: c.account_id,
    url: c.url,
    displayName: c.display_name,
    color: c.color,
    components: c.components.split(',').filter(Boolean),
    readOnly: c.read_only === 1,
    visible: c.visible === 1,
    order: c.sort_order
  }
}

export function listCalendars(
  accountId?: number,
  db: Database.Database = getDb()
): CalendarSummary[] {
  const rows = (
    accountId === undefined
      ? db.prepare('SELECT * FROM calendars ORDER BY account_id, sort_order, display_name').all()
      : db
          .prepare('SELECT * FROM calendars WHERE account_id = ? ORDER BY sort_order, display_name')
          .all(accountId)
  ) as CalendarRow[]
  return rows.map(toCalendarSummary)
}

export function setCalendarVisible(
  calendarId: number,
  visible: boolean,
  db: Database.Database = getDb()
): void {
  const cal = requireCalendar(db, calendarId)
  db.prepare('UPDATE calendars SET visible = ? WHERE id = ?').run(visible ? 1 : 0, calendarId)
  changedFn(cal.account_id, [])
}

/** Farbe setzen (#RRGGBB); null = zurück auf die Server-Farbe beim nächsten Sync. */
export function setCalendarColor(
  calendarId: number,
  color: string | null,
  db: Database.Database = getDb()
): void {
  const cal = requireCalendar(db, calendarId)
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Ungültige Farbe')
  db.prepare('UPDATE calendars SET color = ?, color_user_set = ? WHERE id = ?').run(
    color?.toLowerCase() ?? null,
    color === null ? 0 : 1,
    calendarId
  )
  changedFn(cal.account_id, [])
}

function requireCalendar(db: Database.Database, id: number): CalendarRow {
  const cal = getCalendar(db, id)
  if (!cal) throw new Error('Kalender nicht gefunden')
  return cal
}

// --- Ereignisse lesen ------------------------------------------------------------------------------

export interface ListEventsInput {
  /** Beginn der Spanne (UTC ms, inklusiv) */
  rangeStart: number
  /** Ende der Spanne (UTC ms, exklusiv) */
  rangeEnd: number
  /** Nur diese Kalender (unabhängig von `visible`); sonst alle sichtbaren */
  calendarIds?: number[]
  /** Zeitzone des Betrachters für ganztägige Einträge (Default: Systemzone) */
  tz?: string
}

interface InstanceJoinRow {
  object_id: number
  calendar_id: number
  recurrence_id: string | null
  start_utc: number
  end_utc: number
  all_day: number
  start_day: string | null
  end_day: string | null
  is_override: number
  summary: string | null
  location: string | null
  status: string | null
  has_rrule: number
  pending_op: string | null
  read_only: number
}

function rowToInstance(r: InstanceJoinRow): CalendarInstance {
  return {
    key: `${r.object_id}:${r.recurrence_id ?? ''}`,
    objectId: r.object_id,
    calendarId: r.calendar_id,
    recurrenceId: r.recurrence_id,
    startUtc: r.start_utc,
    endUtc: r.end_utc,
    allDay: r.all_day === 1,
    startDay: r.start_day,
    endDay: r.end_day,
    summary: r.summary ?? '',
    location: r.location,
    status: r.status,
    recurring: r.has_rrule === 1,
    isOverride: r.is_override === 1,
    pending: r.pending_op !== null,
    readOnly: r.read_only === 1
  }
}

/**
 * Vorkommen in [rangeStart, rangeEnd), expandiert, nach Start sortiert.
 * Liegt die Spanne im materialisierten Fenster, kommt alles aus cal_instances;
 * darüber hinaus werden wiederkehrende Ereignisse direkt expandiert.
 */
export function listEvents(
  input: ListEventsInput,
  db: Database.Database = getDb()
): CalendarInstance[] {
  const { rangeStart, rangeEnd } = input
  if (!(rangeEnd > rangeStart)) return []
  const tz = input.tz && resolveZoneSafe(input.tz) ? input.tz : systemTimeZone()
  const zone = resolveZone(tz)
  const firstDay = wallToDateString(zone.utcToWall(rangeStart))
  const lastDay = wallToDateString(zone.utcToWall(rangeEnd - 1))
  const window = getInstanceWindow(db)
  const inWindow = rangeStart >= window.from && rangeEnd <= window.to

  const calFilter =
    input.calendarIds === undefined
      ? 'c.visible = 1'
      : `c.id IN (${input.calendarIds.map(() => '?').join(',') || 'NULL'})`
  const params: unknown[] = [...(input.calendarIds ?? [])]
  const rows = db
    .prepare(
      `SELECT i.object_id, i.calendar_id, i.recurrence_id, i.start_utc, i.end_utc, i.all_day,
              i.start_day, i.end_day, i.is_override, i.summary, i.location, i.status,
              o.has_rrule, o.pending_op, c.read_only
       FROM cal_instances i
       JOIN cal_objects o ON o.id = i.object_id
       JOIN calendars c ON c.id = i.calendar_id
       WHERE ${calFilter}
         AND o.pending_op IS NOT 'delete'
         ${inWindow ? '' : 'AND o.has_rrule = 0'}
         AND (
           (i.all_day = 0 AND i.start_utc < ? AND (i.end_utc > ? OR (i.end_utc = i.start_utc AND i.start_utc >= ?)))
           OR (i.all_day = 1 AND i.start_day <= ? AND i.end_day > ?)
         )
       ORDER BY i.start_utc, i.end_utc`
    )
    .all(...params, rangeEnd, rangeStart, rangeStart, lastDay, firstDay) as InstanceJoinRow[]
  const out = rows.map(rowToInstance)

  if (!inWindow) {
    const objects = db
      .prepare(
        `SELECT o.*, c.read_only FROM cal_objects o JOIN calendars c ON c.id = o.calendar_id
         WHERE ${calFilter} AND o.has_rrule = 1 AND o.component = 'VEVENT' AND o.pending_op IS NOT 'delete'`
      )
      .all(...params) as Array<CalObjectRow & { read_only: number }>
    for (const obj of objects) {
      let occurrences: Occurrence[]
      try {
        occurrences = expandResource(parseCalendar(obj.ics), {
          windowStart: rangeStart,
          windowEnd: rangeEnd
        })
      } catch {
        continue
      }
      for (const occ of occurrences) {
        if (occ.allDay) {
          if (!(occ.startDay! <= lastDay && occ.endDay! > firstDay)) continue
        }
        out.push({
          key: `${obj.id}:${occ.recurrenceId ?? ''}`,
          objectId: obj.id,
          calendarId: obj.calendar_id,
          recurrenceId: occ.recurrenceId,
          startUtc: occ.startUtc,
          endUtc: occ.endUtc,
          allDay: occ.allDay,
          startDay: occ.startDay,
          endDay: occ.endDay,
          summary: textOf(occ, 'summary') ?? '',
          location: textOf(occ, 'location'),
          status: textOf(occ, 'status')?.toUpperCase() ?? null,
          recurring: true,
          isOverride: occ.isOverride,
          pending: obj.pending_op !== null,
          readOnly: obj.read_only === 1
        })
      }
    }
    out.sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc)
  }
  return out
}

function textOf(occ: Occurrence, name: string): string | null {
  const v = occ.comp.getFirstPropertyValue(name)
  return typeof v === 'string' && v !== '' ? v : null
}

function resolveZoneSafe(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Details eines Ereignisses bzw. eines Vorkommens (`recurrenceId` aus CalendarInstance). */
export function getEvent(
  objectId: number,
  recurrenceId: string | null = null,
  db: Database.Database = getDb()
): CalendarEventDetail {
  const obj = getObject(db, objectId)
  if (!obj || obj.pending_op === 'delete') throw new Error('Ereignis nicht gefunden')
  if (obj.component !== 'VEVENT') throw new Error('Kein Termin')
  const cal = requireCalendar(db, obj.calendar_id)
  const root = parseCalendar(obj.ics)
  const vtz = vtimezonesOf(root)
  const { master, overrides } = splitComponents(root, 'vevent')
  const recurring = !!master && (master.hasProperty('rrule') || master.hasProperty('rdate'))

  let occ: Occurrence | undefined
  if (recurrenceId !== null) {
    const center =
      recurrenceId.length === 10 ? dateStringToUtcMs(recurrenceId) : Date.parse(recurrenceId)
    if (!Number.isFinite(center)) throw new Error('Ungültige Vorkommens-ID')
    occ = expandResource(root, {
      windowStart: center - 86_400_000,
      windowEnd: center + 4 * 86_400_000
    }).find((o) => o.recurrenceId === recurrenceId)
    // Verschobene Ausnahme: liegt eventuell außerhalb der Suchspanne
    occ ??= expandResource(root, { windowStart: 0, windowEnd: 0, all: true }).find(
      (o) => o.recurrenceId === recurrenceId
    )
    if (!occ) throw new Error('Vorkommen nicht gefunden')
  } else {
    const all = expandResource(root, { windowStart: 0, windowEnd: 0, all: true })
    occ = all[0]
    if (!occ) {
      // Serie ohne Vorkommen im Zählbereich: Stamm-Termin selbst zeigen
      const first = expandResource(root, {
        windowStart: obj.dtstart_utc ?? 0,
        windowEnd: (obj.dtstart_utc ?? 0) + 1
      })[0]
      occ = first
    }
    if (!occ) throw new Error('Ereignis ohne Vorkommen')
    if (recurring && !occ.isOverride) occ = { ...occ, recurrenceId: null }
  }

  const comp = occ.comp
  const zoneId = occ.allDay ? null : (eventTimes(comp, vtz)?.start.tzid ?? null)
  const fields = readFields(comp, vtz, {
    startUtc: occ.startUtc,
    endUtc: occ.endUtc,
    allDay: occ.allDay,
    zone: resolveZone(zoneId, vtz),
    tzid: zoneId
  })
  // Stamm-Regel auch für generierte Vorkommen anzeigen
  if (master && !occ.isOverride)
    fields.rrule = master.getFirstPropertyValue('rrule')?.toString() ?? null
  const sequence = Number(comp.getFirstPropertyValue('sequence') ?? 0)
  return {
    objectId: obj.id,
    calendarId: obj.calendar_id,
    uid: obj.uid,
    etag: obj.etag,
    readOnly: cal.read_only === 1,
    pending: obj.pending_op !== null,
    recurrenceId: occ.recurrenceId,
    recurring: recurring || overrides.length > 0,
    isOverride: occ.isOverride,
    startUtc: occ.startUtc,
    endUtc: occ.endUtc,
    startDay: occ.startDay,
    endDay: occ.endDay,
    fields,
    exdates: master ? exdatesOf(master, vtz) : [],
    sequence: Number.isFinite(sequence) ? sequence : 0
  }
}

// --- Ereignisse schreiben -----------------------------------------------------------------------------

function writableCalendar(db: Database.Database, id: number): CalendarRow {
  const cal = requireCalendar(db, id)
  if (cal.read_only) throw new Error('Dieser Kalender ist schreibgeschützt')
  if (!cal.components.split(',').includes('VEVENT'))
    throw new Error('Kalender nimmt keine Termine auf')
  return cal
}

function afterWrite(cal: CalendarRow): void {
  changedFn(cal.account_id, [cal.id])
  calendarSync.kick(cal.account_id)
}

/** Neuen Termin anlegen (optimistisch lokal, Übertragung im Hintergrund). */
export function createEvent(
  input: CalendarEventInput,
  db: Database.Database = getDb(),
  ctx?: EditContext
): { objectId: number } {
  const cal = writableCalendar(db, input.calendarId)
  const { calendarId: _calendarId, ...fields } = input
  void _calendarId
  const { ics, uid } = createEventIcs(fields, ctx)
  let objectId = 0
  db.transaction(() => {
    objectId = enqueueCreate(db, cal, uid, ics)
  })()
  afterWrite(cal)
  return { objectId }
}

/**
 * Termin ändern. `scope`: 'this' = nur dieses Vorkommen (RECURRENCE-ID-Override),
 * 'following' = dieses und alle folgenden (Serie wird per UNTIL geteilt, die
 * Fortsetzung ist ein neues Objekt), 'all' = ganze Serie. Bei nicht
 * wiederkehrenden Terminen gilt immer 'all'.
 */
export function updateEvent(
  objectId: number,
  scope: CalendarEditScope,
  recurrenceId: string | null,
  patch: CalendarEventPatch,
  db: Database.Database = getDb(),
  ctx?: EditContext
): { objectId: number; createdObjectId: number | null } {
  const obj = getObject(db, objectId)
  if (!obj || obj.pending_op === 'delete') throw new Error('Ereignis nicht gefunden')
  const cal = writableCalendar(db, obj.calendar_id)
  const result = updateIcs(obj.ics, { scope, recurrenceId, patch }, ctx)
  let createdObjectId: number | null = null
  db.transaction(() => {
    enqueueUpdate(db, obj, cal, result.ics)
    if (result.created)
      createdObjectId = enqueueCreate(db, cal, result.created.uid, result.created.ics)
  })()
  afterWrite(cal)
  return { objectId, createdObjectId }
}

/** Termin (bzw. Vorkommen / Rest einer Serie) löschen. Scopes wie bei updateEvent. */
export function deleteEvent(
  objectId: number,
  scope: CalendarEditScope,
  recurrenceId: string | null,
  db: Database.Database = getDb(),
  ctx?: EditContext
): void {
  const obj = getObject(db, objectId)
  if (!obj || obj.pending_op === 'delete') throw new Error('Ereignis nicht gefunden')
  const cal = writableCalendar(db, obj.calendar_id)
  const result = deleteFromIcs(obj.ics, { scope, recurrenceId }, ctx)
  db.transaction(() => {
    if (result.kind === 'delete') enqueueDelete(db, obj, cal)
    else enqueueUpdate(db, obj, cal, result.ics)
  })()
  afterWrite(cal)
}
