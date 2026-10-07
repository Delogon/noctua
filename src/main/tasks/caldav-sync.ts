import type Database from 'better-sqlite3-multiple-ciphers'
import { calendarSync } from '../calendar/sync'
import {
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  getCalendar,
  type CalendarRow,
  type CalObjectRow
} from '../calendar/repo'
import {
  buildTodoIcs,
  fieldsHash,
  patchTodoIcs,
  readTodo,
  taskUid,
  type TaskFields,
  type TodoFields
} from './todo'

/**
 * Zwei-Wege-Abgleich Noctua-Aufgaben <-> VTODOs einer gewählten CalDAV-Liste
 * (Phase 3.2). Reiner DB-Abgleich: Netzwerk machen weiterhin die Kalender-
 * Sync-Engine und cal_pending_ops (If-Match, 412 → Server-Fassung gewinnt).
 *
 * Idee: Je Aufgabe merkt `task_caldav` Hash und ETag des zuletzt abgeglichenen
 * Stands. Änderte sich nur die lokale Seite → Update einreihen; nur die
 * Serverseite (ETag und Hash weichen ab) → Aufgabe übernehmen; beides → Server
 * gewinnt und der Nutzer bekommt den Konflikt-Toast.
 */

export const TASKS_CALENDAR_KEY = 'tasks.caldavCalendar'
const DEAD_OP_WINDOW_MS = 24 * 3600_000

export interface TasksSyncEvents {
  /** Lokale Aufgaben wurden durch den Abgleich verändert (Push `tasks:changed`). */
  onTasksChanged(): void
  onConflict(info: {
    accountId: number
    calendarId: number
    uid: string
    summary: string | null
  }): void
}

let events: TasksSyncEvents = { onTasksChanged: () => {}, onConflict: () => {} }

export function initTasksSync(e: TasksSyncEvents): void {
  events = e
}

// --- Einstellung -------------------------------------------------------------------------------

function readSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

/** Gewählte Aufgabenliste; null, wenn aus, gelöscht, schreibgeschützt oder ohne VTODO. */
export function targetCalendar(db: Database.Database): CalendarRow | null {
  const raw = readSetting(db, TASKS_CALENDAR_KEY)
  const id = raw ? Number(raw) : NaN
  if (!Number.isInteger(id) || id <= 0) return null
  const cal = getCalendar(db, id)
  if (!cal || cal.read_only === 1 || !cal.components.split(',').includes('VTODO')) return null
  return cal
}

export interface TaskListChoice {
  calendarId: number
  accountId: number
  accountName: string
  name: string
}

/** Alle Kalender, die als Aufgabenliste taugen (VTODO, schreibbar). */
export function listTaskLists(db: Database.Database): TaskListChoice[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.account_id, c.display_name, c.components, a.name account_name
       FROM calendars c JOIN cal_accounts a ON a.id = c.account_id
       WHERE c.read_only = 0 ORDER BY a.id, c.sort_order, c.display_name`
    )
    .all() as Array<{
    id: number
    account_id: number
    display_name: string
    components: string
    account_name: string
  }>
  return rows
    .filter((r) => r.components.split(',').includes('VTODO'))
    .map((r) => ({
      calendarId: r.id,
      accountId: r.account_id,
      accountName: r.account_name,
      name: r.display_name
    }))
}

/** Liste wählen (null = aus). Beim Wechsel der Liste werden die Zuordnungen verworfen. */
export function setTasksSyncCalendar(db: Database.Database, calendarId: number | null): void {
  if (calendarId !== null) {
    const cal = getCalendar(db, calendarId)
    if (!cal) throw new Error('Kalender nicht gefunden')
    if (cal.read_only === 1) throw new Error('Dieser Kalender ist schreibgeschützt')
    if (!cal.components.split(',').includes('VTODO'))
      throw new Error('Dieser Kalender unterstützt keine Aufgaben')
  }
  const previous = readSetting(db, TASKS_CALENDAR_KEY)
  db.transaction(() => {
    if (calendarId === null) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(TASKS_CALENDAR_KEY)
    } else {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(TASKS_CALENDAR_KEY, String(calendarId))
      // Andere Liste: alte Zuordnungen gelten dort nicht (Aufgaben bleiben lokal)
      if (previous !== null && previous !== String(calendarId))
        db.prepare('DELETE FROM task_caldav WHERE calendar_id <> ?').run(calendarId)
    }
  })()
  if (calendarId !== null) {
    reconcileTasks(db)
    kickAccount(db, calendarId)
  }
}

function kickAccount(db: Database.Database, calendarId: number): void {
  const cal = getCalendar(db, calendarId)
  if (cal) calendarSync.kick(cal.account_id)
}

// --- Abgleich ------------------------------------------------------------------------------------

interface TaskRow {
  id: number
  source_kind: 'mail' | 'signal' | 'manual'
  source_id: number | null
  title: string
  notes: string | null
  due_date: string | null
  status: 'open' | 'done' | 'dismissed'
}

interface MappingRow {
  task_id: number
  calendar_id: number
  uid: string
  synced_hash: string | null
  synced_etag: string | null
}

const taskFieldsOf = (t: TaskRow): TaskFields => ({
  title: t.title,
  notes: t.notes,
  due: t.due_date,
  done: t.status === 'done'
})

export interface ReconcileResult {
  tasksChanged: boolean
  /** Es wurden Pushes eingereiht (Sync-Engine anstoßen). */
  queued: boolean
}

export interface ReconcileOptions {
  now?: number
}

function applyToTask(db: Database.Database, taskId: number, f: TodoFields, now: number): void {
  db.prepare(
    `UPDATE OR IGNORE tasks SET title = ?, notes = ?, due_date = ?, status = ?, completed_at = ? WHERE id = ?`
  ).run(
    f.title.slice(0, 500),
    f.notes,
    f.due,
    f.done ? 'done' : 'open',
    f.done ? now : null,
    taskId
  )
}

function objectByUid(
  db: Database.Database,
  calendarId: number,
  uid: string
): CalObjectRow | undefined {
  return db
    .prepare(
      `SELECT * FROM cal_objects WHERE calendar_id = ? AND uid = ? AND component = 'VTODO'
       ORDER BY id LIMIT 1`
    )
    .get(calendarId, uid) as CalObjectRow | undefined
}

/** Gleichnamiges, noch nicht zugeordnetes VTODO (Dedupe, wenn die Zuordnung verloren ging). */
function unmappedObjectByTitle(
  db: Database.Database,
  calendarId: number,
  title: string
): CalObjectRow | undefined {
  return db
    .prepare(
      `SELECT o.* FROM cal_objects o
       WHERE o.calendar_id = ? AND o.component = 'VTODO' AND o.pending_op IS NULL AND o.summary = ?
         AND NOT EXISTS (SELECT 1 FROM task_caldav tc WHERE tc.calendar_id = o.calendar_id AND tc.uid = o.uid)
       ORDER BY o.id LIMIT 1`
    )
    .get(calendarId, title.trim()) as CalObjectRow | undefined
}

function hasRecentDeadOp(
  db: Database.Database,
  calendarId: number,
  uid: string,
  now: number
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM cal_pending_ops
       WHERE calendar_id = ? AND uid = ? AND status = 'dead' AND created_at > ? LIMIT 1`
    )
    .get(calendarId, uid, now - DEAD_OP_WINDOW_MS)
}

function messageIdHeader(db: Database.Database, t: TaskRow): string | null {
  if (t.source_kind !== 'mail' || t.source_id === null) return null
  const row = db.prepare('SELECT message_id FROM messages WHERE id = ?').get(t.source_id) as
    { message_id: string | null } | undefined
  return row?.message_id ?? null
}

/** Aufgabe aus Server-VTODO anlegen; mit Rück-Link zur Mail, wenn sie lokal bekannt ist. */
function insertTaskFromTodo(db: Database.Database, f: TodoFields, now: number): number {
  let source: { id: number; accountId: number } | null = null
  if (f.messageId) {
    const rows = db
      .prepare('SELECT id, account_id FROM messages WHERE message_id IN (?, ?) LIMIT 2')
      .all(f.messageId, `<${f.messageId}>`) as Array<{ id: number; account_id: number }>
    if (rows.length === 1) source = { id: rows[0].id, accountId: rows[0].account_id }
  }
  const insert = (
    kind: 'mail' | 'manual',
    sourceId: number | null,
    accountId: number | null
  ): Database.RunResult =>
    db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (source_kind, source_id, account_id, title, notes, due_date, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        kind,
        sourceId,
        accountId,
        f.title.slice(0, 500),
        f.notes,
        f.due,
        f.done ? 'done' : 'open',
        now,
        f.done ? now : null
      )
  let res = source ? insert('mail', source.id, source.accountId) : null
  if (!res || res.changes === 0) res = insert('manual', null, null)
  return Number(res.lastInsertRowid)
}

/**
 * Gleicht Aufgaben und VTODOs der gewählten Liste ab. Idempotent; reine DB-
 * Operationen in einer Transaktion.
 */
export function reconcileTasks(
  db: Database.Database,
  opts: ReconcileOptions = {}
): ReconcileResult {
  const cal = targetCalendar(db)
  if (!cal) return { tasksChanged: false, queued: false }
  const now = opts.now ?? Date.now()
  let tasksChanged = false
  let queued = false
  const conflicts: Array<{ uid: string; summary: string | null }> = []

  const setMapping = db.prepare(
    `INSERT INTO task_caldav (task_id, calendar_id, uid, synced_hash, synced_etag, last_synced)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET calendar_id = excluded.calendar_id, uid = excluded.uid,
       synced_hash = excluded.synced_hash, synced_etag = excluded.synced_etag,
       last_synced = excluded.last_synced`
  )
  const dropMapping = db.prepare('DELETE FROM task_caldav WHERE task_id = ?')

  db.transaction(() => {
    // 1. Bestehende Zuordnungen
    const mappings = db
      .prepare('SELECT * FROM task_caldav WHERE calendar_id = ?')
      .all(cal.id) as MappingRow[]
    for (const m of mappings) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(m.task_id) as
        TaskRow | undefined
      const obj = objectByUid(db, cal.id, m.uid)

      // Lokal gelöscht oder verworfen → serverseitig löschen
      if (!task || task.status === 'dismissed') {
        if (obj && obj.pending_op !== 'delete') {
          enqueueDelete(db, obj, cal)
          queued = true
        }
        dropMapping.run(m.task_id)
        continue
      }
      // Server hat gelöscht (nur wenn der Stand dort je bestätigt war)
      if (!obj || obj.pending_op === 'delete') {
        if (!obj && m.synced_etag !== null) {
          db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id)
          tasksChanged = true
        }
        if (!obj) dropMapping.run(m.task_id)
        continue
      }

      let server: TodoFields
      try {
        server = readTodo(obj.ics)
      } catch {
        continue // nicht lesbares VTODO nie überschreiben
      }
      const local = taskFieldsOf(task)
      const hLocal = fieldsHash(local)
      const hServer = fieldsHash(server)
      const pending = obj.pending_op !== null
      const localChanged = hLocal !== m.synced_hash
      const serverChanged = !pending && obj.etag !== m.synced_etag && hServer !== m.synced_hash

      if (serverChanged) {
        if (localChanged && hLocal !== hServer)
          conflicts.push({ uid: m.uid, summary: server.title })
        if (hLocal !== hServer) {
          applyToTask(db, task.id, server, now)
          tasksChanged = true
        }
        setMapping.run(task.id, cal.id, m.uid, hServer, obj.etag, now)
      } else if (localChanged && hLocal !== hServer) {
        const ics = patchTodoIcs(obj.ics, local, server, now)
        enqueueUpdate(db, obj, cal, ics)
        queued = true
        setMapping.run(task.id, cal.id, m.uid, hLocal, m.synced_etag, now)
      } else if (!pending && (obj.etag !== m.synced_etag || hLocal !== m.synced_hash)) {
        // eigener Push bestätigt bzw. nur unabgebildete Properties geändert
        setMapping.run(task.id, cal.id, m.uid, hLocal, obj.etag, now)
      }
    }

    // 2. Aktive Aufgaben ohne Zuordnung → anlegen (oder per UID übernehmen)
    const unmapped = db
      .prepare(
        `SELECT t.* FROM tasks t LEFT JOIN task_caldav tc ON tc.task_id = t.id
         WHERE t.status = 'open' AND tc.task_id IS NULL ORDER BY t.id`
      )
      .all() as TaskRow[]
    for (const task of unmapped) {
      const uid = taskUid(task.id)
      const existing = objectByUid(db, cal.id, uid) ?? unmappedObjectByTitle(db, cal.id, task.title)
      if (existing) {
        // Bereits auf dem Server (z. B. nach erneutem Aktivieren): übernehmen, nicht doppeln
        try {
          const server = readTodo(existing.ics)
          if (existing.pending_op === null) {
            applyToTask(db, task.id, server, now)
            tasksChanged = true
          }
          setMapping.run(task.id, cal.id, existing.uid, fieldsHash(server), existing.etag, now)
        } catch {
          // nicht lesbar: nichts tun
        }
        continue
      }
      if (hasRecentDeadOp(db, cal.id, uid, now)) continue
      const fields = taskFieldsOf(task)
      const ics = buildTodoIcs(uid, fields, { now, messageId: messageIdHeader(db, task) })
      enqueueCreate(db, cal, uid, ics)
      queued = true
      setMapping.run(task.id, cal.id, uid, fieldsHash(fields), null, now)
    }

    // 3. Server-VTODOs ohne Aufgabe → als Aufgabe anlegen
    const objects = db
      .prepare(
        `SELECT o.* FROM cal_objects o
         WHERE o.calendar_id = ? AND o.component = 'VTODO' AND o.pending_op IS NULL
           AND NOT EXISTS (SELECT 1 FROM task_caldav tc WHERE tc.calendar_id = o.calendar_id AND tc.uid = o.uid)`
      )
      .all(cal.id) as CalObjectRow[]
    for (const obj of objects) {
      let server: TodoFields
      try {
        server = readTodo(obj.ics)
      } catch {
        continue
      }
      const id = insertTaskFromTodo(db, server, now)
      if (id > 0) {
        setMapping.run(id, cal.id, obj.uid, fieldsHash(server), obj.etag, now)
        tasksChanged = true
      }
    }
  })()

  for (const c of conflicts)
    events.onConflict({ accountId: cal.account_id, calendarId: cal.id, ...c })
  if (tasksChanged) events.onTasksChanged()
  return { tasksChanged, queued }
}

// --- Auslöser ------------------------------------------------------------------------------------

/** Nach einem Kalender-Sync (Hook aus calendar/index.ts); leere Liste = Kalenderliste geändert. */
export function afterCalendarChanged(
  db: Database.Database,
  accountId: number,
  calendarIds: number[]
): void {
  try {
    const cal = targetCalendar(db)
    if (!cal || cal.account_id !== accountId) return
    if (calendarIds.length > 0 && !calendarIds.includes(cal.id)) return
    const res = reconcileTasks(db)
    if (res.queued) calendarSync.kick(cal.account_id)
  } catch (error) {
    console.warn(
      '[tasks] CalDAV-Abgleich fehlgeschlagen:',
      error instanceof Error ? error.message : error
    )
  }
}

/** Nach lokaler Änderung an Aufgaben (Repo-Hook); tut nichts, solange der Abgleich aus ist. */
export function afterLocalTaskChange(db: Database.Database): void {
  try {
    const cal = targetCalendar(db)
    if (!cal) return
    const res = reconcileTasks(db)
    if (res.queued) calendarSync.kick(cal.account_id)
  } catch (error) {
    console.warn(
      '[tasks] CalDAV-Abgleich fehlgeschlagen:',
      error instanceof Error ? error.message : error
    )
  }
}

// --- Status-Glyphe ---------------------------------------------------------------------------------

export type TaskSyncState = 'pending' | 'synced' | 'conflict'

/** Sync-Zustand je Aufgaben-ID (nur zugeordnete Aufgaben). */
export function loadTaskSyncStates(
  db: Database.Database,
  hashes: Map<number, string>,
  now = Date.now()
): Map<number, TaskSyncState> {
  const out = new Map<number, TaskSyncState>()
  const rows = db
    .prepare(
      `SELECT tc.task_id, tc.synced_hash, tc.synced_etag, tc.calendar_id, tc.uid,
              o.pending_op, o.etag,
              EXISTS (SELECT 1 FROM cal_pending_ops p WHERE p.calendar_id = tc.calendar_id
                      AND p.uid = tc.uid AND p.status = 'dead' AND p.created_at > ?) dead
       FROM task_caldav tc
       LEFT JOIN cal_objects o ON o.calendar_id = tc.calendar_id AND o.uid = tc.uid AND o.component = 'VTODO'`
    )
    .all(now - DEAD_OP_WINDOW_MS) as Array<{
    task_id: number
    synced_hash: string | null
    synced_etag: string | null
    pending_op: string | null
    etag: string | null
    dead: number
  }>
  for (const r of rows) {
    const current = hashes.get(r.task_id)
    if (r.dead) out.set(r.task_id, 'conflict')
    else if (r.pending_op !== null || current !== r.synced_hash || r.synced_etag === null)
      out.set(r.task_id, 'pending')
    else out.set(r.task_id, 'synced')
  }
  return out
}
