import type Database from 'better-sqlite3-multiple-ciphers'
import {
  DAY_MS,
  expandResource,
  extractObjectFields,
  parseCalendar,
  type ObjectFields,
  type Occurrence
} from './ics'

/**
 * DB-Zugriff des Kalenders: Konten, Kalender, Objekte, Vorkommens-Cache
 * (cal_instances) und lokale Warteschlange (cal_pending_ops).
 */

export interface CalAccountRow {
  id: number
  name: string
  server_url: string
  principal_url: string | null
  home_url: string
  username: string
  mail_account_id: number | null
  schedule_inbox_url: string | null
  schedule_outbox_url: string | null
  user_addresses: string
  auto_schedule: number
  dav_capabilities: string
  state: string
  last_error: string | null
  last_sync: number | null
  created_at: number
}

export interface CalendarRow {
  id: number
  account_id: number
  url: string
  display_name: string
  color: string | null
  components: string
  read_only: number
  supports_sync: number
  ctag: string | null
  sync_token: string | null
  visible: number
  sort_order: number
  color_user_set: number
}

export interface CalObjectRow {
  id: number
  calendar_id: number
  href: string
  etag: string | null
  uid: string
  component: string
  ics: string
  summary: string | null
  location: string | null
  dtstart_utc: number | null
  dtend_utc: number | null
  tzid: string | null
  all_day: number
  has_rrule: number
  status: string | null
  organizer: string | null
  sequence: number
  last_modified: number | null
  pending_op: 'create' | 'update' | 'delete' | null
}

export interface PendingOpRow {
  id: number
  account_id: number
  calendar_id: number
  object_id: number | null
  kind: 'create' | 'update' | 'delete'
  href: string
  uid: string
  base_etag: string | null
  ics: string | null
  summary: string | null
  status: 'pending' | 'dead'
  attempts: number
  last_error: string | null
  created_at: number
}

export const calSecretKey = (accountId: number): string => `cal:${accountId}:password`

// --- Instanz-Fenster ---------------------------------------------------------------------

const WINDOW_KEY = 'calendar.window'
export const WINDOW_BACK_MS = 183 * DAY_MS // ~6 Monate
export const WINDOW_FORWARD_MS = 548 * DAY_MS // ~18 Monate
const WINDOW_REFRESH_MS = 30 * DAY_MS

export interface InstanceWindow {
  from: number
  to: number
  computedAt: number
}

function readSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

function writeSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

export function getInstanceWindow(db: Database.Database, now = Date.now()): InstanceWindow {
  const raw = readSetting(db, WINDOW_KEY)
  if (raw) {
    try {
      const w = JSON.parse(raw) as InstanceWindow
      if (Number.isFinite(w.from) && Number.isFinite(w.to)) return w
    } catch {
      // defekt → neu berechnen
    }
  }
  const w: InstanceWindow = {
    from: now - WINDOW_BACK_MS,
    to: now + WINDOW_FORWARD_MS,
    computedAt: now
  }
  writeSetting(db, WINDOW_KEY, JSON.stringify(w))
  return w
}

/**
 * Fenster bei Bedarf nachziehen (ca. monatlich) und wiederkehrende Objekte neu
 * materialisieren. Rückgabe: true, wenn das Fenster verschoben wurde.
 */
export function ensureInstanceWindow(db: Database.Database, now = Date.now()): boolean {
  const current = getInstanceWindow(db, now)
  if (now - current.computedAt < WINDOW_REFRESH_MS) return false
  const next: InstanceWindow = {
    from: now - WINDOW_BACK_MS,
    to: now + WINDOW_FORWARD_MS,
    computedAt: now
  }
  writeSetting(db, WINDOW_KEY, JSON.stringify(next))
  const ids = db
    .prepare(`SELECT id FROM cal_objects WHERE has_rrule = 1 AND component = 'VEVENT'`)
    .all() as Array<{ id: number }>
  const tx = db.transaction(() => {
    for (const { id } of ids) materializeInstances(db, id, next)
  })
  tx()
  return true
}

// --- Objekte -------------------------------------------------------------------------------

/** Spalten aus dem ICS ableiten; nicht parsebare Ressourcen bleiben als INVALID erhalten. */
export function fieldsFromIcs(ics: string, href: string): ObjectFields {
  try {
    return extractObjectFields(parseCalendar(ics))
  } catch (error) {
    console.warn(
      `[calendar] ICS nicht lesbar (${href}): ${error instanceof Error ? error.message : 'unbekannt'}`
    )
    return {
      uid: `invalid:${href}`,
      component: 'INVALID',
      summary: null,
      location: null,
      dtstartUtc: null,
      dtendUtc: null,
      tzid: null,
      allDay: false,
      hasRrule: false,
      status: null,
      organizer: null,
      sequence: 0,
      lastModified: null
    }
  }
}

export interface UpsertObjectInput {
  calendarId: number
  href: string
  etag: string | null
  ics: string
  pendingOp?: 'create' | 'update' | 'delete' | null
}

/** Legt ein Objekt an oder aktualisiert es (id bleibt stabil) und materialisiert die Vorkommen. */
export function upsertObject(db: Database.Database, input: UpsertObjectInput): number {
  const f = fieldsFromIcs(input.ics, input.href)
  db.prepare(
    `INSERT INTO cal_objects (calendar_id, href, etag, uid, component, ics, summary, location,
       dtstart_utc, dtend_utc, tzid, all_day, has_rrule, status, organizer, sequence, last_modified, pending_op)
     VALUES (@calendarId, @href, @etag, @uid, @component, @ics, @summary, @location,
       @dtstart, @dtend, @tzid, @allDay, @hasRrule, @status, @organizer, @sequence, @lastModified, @pendingOp)
     ON CONFLICT(calendar_id, href) DO UPDATE SET
       etag = excluded.etag, uid = excluded.uid, component = excluded.component, ics = excluded.ics,
       summary = excluded.summary, location = excluded.location, dtstart_utc = excluded.dtstart_utc,
       dtend_utc = excluded.dtend_utc, tzid = excluded.tzid, all_day = excluded.all_day,
       has_rrule = excluded.has_rrule, status = excluded.status, organizer = excluded.organizer,
       sequence = excluded.sequence, last_modified = excluded.last_modified,
       pending_op = excluded.pending_op`
  ).run({
    calendarId: input.calendarId,
    href: input.href,
    etag: input.etag,
    uid: f.uid,
    component: f.component,
    ics: input.ics,
    summary: f.summary,
    location: f.location,
    dtstart: f.dtstartUtc,
    dtend: f.dtendUtc,
    tzid: f.tzid,
    allDay: f.allDay ? 1 : 0,
    hasRrule: f.hasRrule ? 1 : 0,
    status: f.status,
    organizer: f.organizer,
    sequence: f.sequence,
    lastModified: f.lastModified,
    pendingOp: input.pendingOp ?? null
  })
  const row = db
    .prepare('SELECT id FROM cal_objects WHERE calendar_id = ? AND href = ?')
    .get(input.calendarId, input.href) as { id: number }
  materializeInstances(db, row.id)
  return row.id
}

export function getObject(db: Database.Database, id: number): CalObjectRow | undefined {
  return db.prepare('SELECT * FROM cal_objects WHERE id = ?').get(id) as CalObjectRow | undefined
}

export function getObjectByHref(
  db: Database.Database,
  calendarId: number,
  href: string
): CalObjectRow | undefined {
  return db
    .prepare('SELECT * FROM cal_objects WHERE calendar_id = ? AND href = ?')
    .get(calendarId, href) as CalObjectRow | undefined
}

export function deleteObject(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM cal_objects WHERE id = ?').run(id)
}

// --- Vorkommen ------------------------------------------------------------------------------

function occurrenceText(occ: Occurrence, name: string): string | null {
  const v = occ.comp.getFirstPropertyValue(name)
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * Vorkommen eines Objekts neu berechnen. Nicht wiederkehrende vollständig,
 * wiederkehrende für das rollende Fenster.
 */
export function materializeInstances(
  db: Database.Database,
  objectId: number,
  window?: InstanceWindow
): void {
  const obj = getObject(db, objectId)
  if (!obj) return
  db.prepare('DELETE FROM cal_instances WHERE object_id = ?').run(objectId)
  if (obj.component !== 'VEVENT') return
  let occurrences: Occurrence[]
  try {
    const root = parseCalendar(obj.ics)
    if (obj.has_rrule) {
      const w = window ?? getInstanceWindow(db)
      occurrences = expandResource(root, { windowStart: w.from, windowEnd: w.to })
    } else {
      occurrences = expandResource(root, { windowStart: 0, windowEnd: 0, all: true })
    }
  } catch (error) {
    console.warn(
      `[calendar] Expansion fehlgeschlagen (${obj.href}): ${error instanceof Error ? error.message : 'unbekannt'}`
    )
    return
  }
  const insert = db.prepare(
    `INSERT INTO cal_instances (object_id, calendar_id, recurrence_id, start_utc, end_utc, all_day,
       start_day, end_day, is_override, summary, location, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const occ of occurrences) {
    insert.run(
      objectId,
      obj.calendar_id,
      occ.recurrenceId,
      occ.startUtc,
      occ.endUtc,
      occ.allDay ? 1 : 0,
      occ.startDay,
      occ.endDay,
      occ.isOverride ? 1 : 0,
      occurrenceText(occ, 'summary'),
      occurrenceText(occ, 'location'),
      occurrenceText(occ, 'status')?.toUpperCase() ?? null
    )
  }
}

// --- Pending ops -----------------------------------------------------------------------------

export const MAX_CAL_OP_ATTEMPTS = 10
const DEAD_OP_RETENTION_MS = 30 * DAY_MS

/**
 * Lokale Neuanlage: optimistisch schreiben, Op einreihen. Der Hrefs-Name leitet
 * sich aus der UID ab (nur sichere Zeichen).
 */
export function enqueueCreate(
  db: Database.Database,
  calendar: CalendarRow,
  uid: string,
  ics: string
): number {
  const href = newObjectHref(calendar.url, uid)
  const objectId = upsertObject(db, {
    calendarId: calendar.id,
    href,
    etag: null,
    ics,
    pendingOp: 'create'
  })
  db.prepare(
    `INSERT INTO cal_pending_ops (account_id, calendar_id, object_id, kind, href, uid, base_etag, summary, created_at)
     VALUES (?, ?, ?, 'create', ?, ?, NULL, ?, ?)`
  ).run(
    calendar.account_id,
    calendar.id,
    objectId,
    href,
    uid,
    fieldsFromIcs(ics, href).summary,
    Date.now()
  )
  return objectId
}

export function newObjectHref(calendarUrl: string, uid: string): string {
  const slug = uid.replace(/[^A-Za-z0-9._@-]/g, '_').slice(0, 100) || 'event'
  const base = new URL(calendarUrl).pathname.replace(/\/?$/, '/')
  return `${base}${slug}.ics`
}

/** Lokale Änderung: Objekt aktualisieren; bestehende Op wird zusammengeführt. */
export function enqueueUpdate(
  db: Database.Database,
  obj: CalObjectRow,
  calendar: CalendarRow,
  ics: string
): void {
  const pendingKind = obj.pending_op === 'create' ? 'create' : 'update'
  upsertObject(db, {
    calendarId: obj.calendar_id,
    href: obj.href,
    etag: obj.etag,
    ics,
    pendingOp: pendingKind
  })
  const existing = db
    .prepare(`SELECT id FROM cal_pending_ops WHERE object_id = ? AND status = 'pending'`)
    .get(obj.id) as { id: number } | undefined
  const summary = fieldsFromIcs(ics, obj.href).summary
  if (existing) {
    db.prepare('UPDATE cal_pending_ops SET summary = ? WHERE id = ?').run(summary, existing.id)
    return
  }
  db.prepare(
    `INSERT INTO cal_pending_ops (account_id, calendar_id, object_id, kind, href, uid, base_etag, summary, created_at)
     VALUES (?, ?, ?, 'update', ?, ?, ?, ?, ?)`
  ).run(calendar.account_id, calendar.id, obj.id, obj.href, obj.uid, obj.etag, summary, Date.now())
}

/** Lokales Löschen. Nie übertragene Neuanlagen verschwinden ersatzlos. */
export function enqueueDelete(
  db: Database.Database,
  obj: CalObjectRow,
  calendar: CalendarRow
): void {
  if (obj.pending_op === 'create') {
    db.prepare(`DELETE FROM cal_pending_ops WHERE object_id = ?`).run(obj.id)
    deleteObject(db, obj.id)
    return
  }
  db.prepare(`DELETE FROM cal_pending_ops WHERE object_id = ? AND status = 'pending'`).run(obj.id)
  db.prepare(`UPDATE cal_objects SET pending_op = 'delete' WHERE id = ?`).run(obj.id)
  db.prepare('DELETE FROM cal_instances WHERE object_id = ?').run(obj.id)
  db.prepare(
    `INSERT INTO cal_pending_ops (account_id, calendar_id, object_id, kind, href, uid, base_etag, summary, created_at)
     VALUES (?, ?, ?, 'delete', ?, ?, ?, ?, ?)`
  ).run(
    calendar.account_id,
    calendar.id,
    obj.id,
    obj.href,
    obj.uid,
    obj.etag,
    obj.summary,
    Date.now()
  )
}

export function listPendingOps(db: Database.Database, accountId: number): PendingOpRow[] {
  db.prepare(`DELETE FROM cal_pending_ops WHERE status = 'dead' AND created_at < ?`).run(
    Date.now() - DEAD_OP_RETENTION_MS
  )
  return db
    .prepare(
      `SELECT * FROM cal_pending_ops WHERE account_id = ? AND status = 'pending' ORDER BY id`
    )
    .all(accountId) as PendingOpRow[]
}

export function listDeadOps(db: Database.Database, accountId: number): PendingOpRow[] {
  return db
    .prepare(`SELECT * FROM cal_pending_ops WHERE account_id = ? AND status = 'dead' ORDER BY id`)
    .all(accountId) as PendingOpRow[]
}

export function getCalendar(db: Database.Database, id: number): CalendarRow | undefined {
  return db.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as CalendarRow | undefined
}

export function getCalAccount(db: Database.Database, id: number): CalAccountRow | undefined {
  return db.prepare('SELECT * FROM cal_accounts WHERE id = ?').get(id) as CalAccountRow | undefined
}
