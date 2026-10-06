import { app, Notification, BrowserWindow } from 'electron'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import icon from '../../resources/icon.png?asset'
import { getSetting } from './db'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const FRESH_WINDOW_MS = 30 * 60_000

let db: Database.Database | null = null
let push: PushFn = () => {}

export function initNotifications(database: Database.Database, pushFn: PushFn): void {
  db = database
  push = pushFn
}

function enabled(): boolean {
  return (getSetting('notifications.enabled') ?? '1') === '1'
}

function minPriority(): number {
  const n = Number(getSetting('notifications.minPriority') ?? '4')
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 5) : 4
}

/**
 * Smart Notifications: nur frische, ungelesene Mails, deren AI-Priorität die
 * Schwelle erreicht (Default P4). P5 mit Sound, P4 still. Klick fokussiert
 * das Fenster und öffnet den Thread. Backfill-Altbestand bleibt stumm.
 */
export function maybeNotify(messageId: number): void {
  if (!db || !enabled() || !Notification.isSupported()) return
  const row = db
    .prepare(
      `SELECT m.thread_key, m.subject, m.from_name, m.from_addr, m.date, m.seen,
              a.priority, a.summary
       FROM messages m
       JOIN ai_annotations a ON a.message_id = m.id
       JOIN folders f ON f.id = m.folder_id
       WHERE m.id = ? AND f.special_use = '\\Inbox'`
    )
    .get(messageId) as
    | {
        thread_key: string
        subject: string | null
        from_name: string | null
        from_addr: string | null
        date: number | null
        seen: number
        priority: number
        summary: string | null
      }
    | undefined
  if (!row) return
  if (row.seen === 1) return
  if (row.priority < minPriority()) return
  if (!row.date || Date.now() - row.date > FRESH_WINDOW_MS) return

  const notification = new Notification({
    title: row.from_name ?? row.from_addr ?? 'Neue E-Mail',
    subtitle: row.subject ?? undefined,
    body: row.summary ?? row.subject ?? '',
    silent: row.priority < 5,
    // macOS nutzt das Icon der Noctua.app; Windows/Linux brauchen es explizit.
    ...(process.platform === 'darwin' ? {} : { icon })
  })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    push('app:openThread', { threadKey: row.thread_key })
  })
  notification.show()
}

/** Dock-Badge = Anzahl wichtiger ungelesener Threads (nicht alle Ungelesenen). */
export function updateBadge(): void {
  if (!db || process.platform !== 'darwin') return
  const row = db
    .prepare(
      `SELECT count(DISTINCT m.thread_key) AS n
       FROM messages m
       JOIN ai_annotations a ON a.message_id = m.id
       JOIN folders f ON f.id = m.folder_id
       WHERE f.special_use = '\\Inbox' AND m.seen = 0
         AND coalesce(a.user_override_category, a.category) NOT IN ('promotions', 'newsletter')
         AND a.priority >= ?`
    )
    .get(minPriority()) as { n: number }
  app.setBadgeCount(row.n)
}

/**
 * Kalender-Erinnerung (VALARM) als macOS-Benachrichtigung. Klick fokussiert das
 * Fenster und meldet dem Renderer, welcher Termin gemeint war.
 */
export function notifyCalendarReminder(notice: {
  objectId: number
  recurrenceId: string | null
  title: string
  body: string
}): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: notice.title,
    body: notice.body,
    ...(process.platform === 'darwin' ? {} : { icon })
  })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    push('calendar:openEvent', { objectId: notice.objectId, recurrenceId: notice.recurrenceId })
  })
  notification.show()
}
