import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { ensureInstanceWindow } from './repo'
import { reminderScheduler, type NotifyFn } from './reminders'
import { setCalendarChangedHandler } from './service'
import { calendarSync } from './sync'
import { afterCalendarChanged, initTasksSync } from '../tasks/caldav-sync'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

/**
 * Verdrahtet Kalender-Sync, Domain-Service und Erinnerungen mit Push-Kanal und
 * Benachrichtigungen. Vom Main-Bootstrap nach openDb() aufgerufen.
 */
export function initCalendar(
  db: Database.Database,
  push: PushFn,
  notify: NotifyFn,
  opts: { startSync?: boolean } = {}
): void {
  setCalendarChangedHandler((accountId, calendarIds) => {
    push('calendar:changed', { accountId, calendarIds })
    reminderScheduler.tick()
  })
  calendarSync.init(
    db,
    {
      onChanged: (accountId, calendarIds) => {
        push('calendar:changed', { accountId, calendarIds })
        reminderScheduler.tick()
        // Aufgaben <-> VTODO (3.2): nach Sync/Push die gewählte Liste abgleichen
        afterCalendarChanged(db, accountId, calendarIds)
      },
      onConflict: (info) => push('calendar:conflict', info),
      onContactsChanged: (accountId) => push('contacts:changed', { accountId })
    },
    (accountId, state, detail) => push('calendar:accountState', { accountId, state, detail })
  )
  initTasksSync({
    onTasksChanged: () => push('tasks:changed', {}),
    onConflict: (info) => push('calendar:conflict', { ...info, kind: 'update', reason: 'conflict' })
  })
  ensureInstanceWindow(db)
  // startSync=false: nur der Dev-Demo-Modus (keine Server hinter den Demo-Konten)
  if (opts.startSync !== false) calendarSync.startAll()
  reminderScheduler.init(db, notify)
  reminderScheduler.start()
}

export function stopCalendar(): void {
  reminderScheduler.stop()
  calendarSync.stopAll()
}
