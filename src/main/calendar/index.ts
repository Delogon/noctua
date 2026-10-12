import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { ensureInstanceWindow } from './repo'
import { reminderScheduler, type NotifyFn } from './reminders'
import { setCalendarChangedHandler } from './service'
import { calendarSync } from './sync'
import { afterCalendarChanged, initTasksSync } from '../tasks/caldav-sync'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

/**
 * Wires calendar sync, domain service and reminders to the push channel and
 * notifications. Called by the main bootstrap after openDb().
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
        // Tasks <-> VTODO (3.2): reconcile the selected list after sync/push
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
  // startSync=false: dev demo mode only (no servers behind the demo accounts)
  if (opts.startSync !== false) calendarSync.startAll()
  reminderScheduler.init(db, notify)
  reminderScheduler.start()
}

export function stopCalendar(): void {
  reminderScheduler.stop()
  calendarSync.stopAll()
}
