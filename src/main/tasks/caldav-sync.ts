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
 * Two-way sync of Noctua tasks <-> VTODOs of a selected CalDAV list
 * (phase 3.2). Pure DB reconciliation: networking is still done by the calendar
 * sync engine and cal_pending_ops (If-Match, 412 → server version wins).
 *
 * Idea: per task, `task_caldav` remembers the hash and ETag of the last reconciled
 * state. If only the local side changed → queue an update; only the
 * server side (ETag and hash differ) → apply it to the task; both → the server
 * wins and the user gets the conflict toast.
 */

export const TASKS_CALENDAR_KEY = 'tasks.caldavCalendar'
const DEAD_OP_WINDOW_MS = 24 * 3600_000

export interface TasksSyncEvents {
  /** Local tasks were changed by the sync (push `tasks:changed`). */
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

// --- Setting -----------------------------------------------------------------------------------

function readSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

/** Selected task list; null if off, deleted, read-only or without VTODO. */
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

/** All calendars usable as a task list (VTODO, writable). */
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

/** Select a list (null = off). Switching lists discards the mappings. */
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
      // Different list: old mappings don't apply there (tasks stay local)
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

// --- Reconciliation ------------------------------------------------------------------------------

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
  /** Pushes were queued (trigger the sync engine). */
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

/** Same-named VTODO not yet mapped (dedupe if the mapping was lost). */
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

/** Create a task from a server VTODO; with a back link to the mail if it is known locally. */
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
 * Reconciles tasks and VTODOs of the selected list. Idempotent; pure DB
 * operations in a single transaction.
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
    // 1. Existing mappings
    const mappings = db
      .prepare('SELECT * FROM task_caldav WHERE calendar_id = ?')
      .all(cal.id) as MappingRow[]
    for (const m of mappings) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(m.task_id) as
        TaskRow | undefined
      const obj = objectByUid(db, cal.id, m.uid)

      // Deleted or discarded locally → delete on the server
      if (!task || task.status === 'dismissed') {
        if (obj && obj.pending_op !== 'delete') {
          enqueueDelete(db, obj, cal)
          queued = true
        }
        dropMapping.run(m.task_id)
        continue
      }
      // The server deleted it (only if the state there was ever confirmed)
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
        continue // never overwrite an unreadable VTODO
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
        // own push confirmed, or only unmapped properties changed
        setMapping.run(task.id, cal.id, m.uid, hLocal, obj.etag, now)
      }
    }

    // 2. Active tasks without a mapping → create (or adopt by UID)
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
        // Already on the server (e.g. after re-enabling): adopt, don't duplicate
        try {
          const server = readTodo(existing.ics)
          if (existing.pending_op === null) {
            applyToTask(db, task.id, server, now)
            tasksChanged = true
          }
          setMapping.run(task.id, cal.id, existing.uid, fieldsHash(server), existing.etag, now)
        } catch {
          // unreadable: do nothing
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

    // 3. Server VTODOs without a task → create as a task
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

// --- Triggers ------------------------------------------------------------------------------------

/** After a calendar sync (hook from calendar/index.ts); empty list = calendar list changed. */
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

/** After a local change to tasks (repo hook); does nothing while the sync is off. */
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

// --- Status glyph ----------------------------------------------------------------------------------

export type TaskSyncState = 'pending' | 'synced' | 'conflict'

/** Sync state per task ID (mapped tasks only). */
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
