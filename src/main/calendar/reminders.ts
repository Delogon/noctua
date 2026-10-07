import type Database from 'better-sqlite3-multiple-ciphers'
import { DAY_MS, expandResource, parseCalendar, readAlarms, type Occurrence } from './ics'
import { resolveZone, systemTimeZone } from './tz'

/**
 * Erinnerungen (VALARM): ein Scheduler prüft regelmäßig die sichtbaren Kalender
 * und löst DISPLAY-/AUDIO-Alarme als Benachrichtigung aus. Bereits ausgelöste
 * Alarme stehen in cal_reminders_fired — nach einem Neustart feuert nichts doppelt,
 * Verpasstes aus den letzten Minuten wird nachgeholt.
 */

export interface ReminderNotice {
  objectId: number
  recurrenceId: string | null
  title: string
  body: string
  startUtc: number
  allDay: boolean
}

export type NotifyFn = (notice: ReminderNotice) => void

/** Wie lange nach der Auslösezeit ein (verpasster) Alarm noch nachgeholt wird. */
export const CATCH_UP_MS = 15 * 60_000
/** Alarme weiter als so weit voraus werden nicht betrachtet. */
export const LOOKAHEAD_MS = 31 * DAY_MS
const TICK_MS = 30_000
const FIRED_RETENTION_MS = 7 * DAY_MS
const SETTING_KEY = 'calendar.reminders'

interface ObjectRow {
  id: number
  ics: string
  has_rrule: number
}

function textProp(occ: Occurrence, name: string): string | null {
  const v = occ.comp.getFirstPropertyValue(name)
  return typeof v === 'string' && v !== '' ? v : null
}

export function formatReminderBody(occ: Occurrence, now: number, tz = systemTimeZone()): string {
  const location = textProp(occ, 'location')
  const dayFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: occ.allDay ? 'UTC' : tz
  })
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz
  })
  const sameDay = (a: number): boolean =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(a) ===
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  let when: string
  if (occ.allDay) when = dayFmt.format(occ.startUtc)
  else if (sameDay(occ.startUtc)) when = timeFmt.format(occ.startUtc)
  else when = `${dayFmt.format(occ.startUtc)}, ${timeFmt.format(occ.startUtc)}`
  return location ? `${when} · ${location}` : when
}

export class ReminderScheduler {
  private db: Database.Database | null = null
  private notify: NotifyFn = () => {}
  private timer: NodeJS.Timeout | null = null
  private snoozed = new Map<string, { until: number; notice: ReminderNotice }>()

  init(db: Database.Database, notify: NotifyFn): void {
    this.db = db
    this.notify = notify
  }

  start(): void {
    if (this.timer || !this.db) return
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Erinnerung später erneut zeigen (nur im Speicher — überlebt keinen Neustart). */
  snooze(notice: ReminderNotice, minutes: number, now = Date.now()): void {
    this.snoozed.set(`${notice.objectId}:${notice.recurrenceId ?? ''}`, {
      until: now + minutes * 60_000,
      notice
    })
  }

  private enabled(db: Database.Database): boolean {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as
      { value: string } | undefined
    return row?.value !== '0'
  }

  /** Ein Durchlauf. Rückgabe: Anzahl ausgelöster Benachrichtigungen. */
  tick(now = Date.now()): number {
    const db = this.db
    if (!db) return 0
    let fired = 0
    try {
      for (const [key, entry] of this.snoozed) {
        if (entry.until <= now) {
          this.snoozed.delete(key)
          this.notify(entry.notice)
          fired += 1
        }
      }
      if (!this.enabled(db)) return fired
      db.prepare('DELETE FROM cal_reminders_fired WHERE fire_at < ?').run(now - FIRED_RETENTION_MS)

      const rows = db
        .prepare(
          `SELECT o.id, o.ics, o.has_rrule
           FROM cal_objects o JOIN calendars c ON c.id = o.calendar_id
           WHERE c.visible = 1 AND o.component = 'VEVENT'
             AND o.pending_op IS NOT 'delete'
             AND o.ics LIKE '%BEGIN:VALARM%'
             AND (o.has_rrule = 1
                  OR (o.dtstart_utc <= ? AND coalesce(o.dtend_utc, o.dtstart_utc) >= ?))`
        )
        .all(now + LOOKAHEAD_MS, now - DAY_MS) as ObjectRow[]

      for (const row of rows) fired += this.processObject(db, row, now)
    } catch (error) {
      console.warn('[calendar] Erinnerungen:', error instanceof Error ? error.message : error)
    }
    return fired
  }

  private processObject(db: Database.Database, row: ObjectRow, now: number): number {
    let occurrences: Occurrence[]
    try {
      occurrences = expandResource(parseCalendar(row.ics), {
        windowStart: now - DAY_MS,
        windowEnd: now + LOOKAHEAD_MS
      })
    } catch {
      return 0
    }
    const zone = resolveZone(null)
    const mark = db.prepare(
      `INSERT OR IGNORE INTO cal_reminders_fired (object_id, recurrence_id, alarm_key, fire_at, fired_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    let fired = 0
    for (const occ of occurrences) {
      if (occ.endUtc < now - CATCH_UP_MS && occ.startUtc < now - CATCH_UP_MS) continue
      const status = textProp(occ, 'status')?.toUpperCase()
      if (status === 'CANCELLED') continue
      for (const alarm of readAlarms(occ.comp)) {
        if (alarm.action === 'EMAIL') continue
        let fireAt: number
        if (alarm.absoluteUtc !== null) fireAt = alarm.absoluteUtc
        else {
          let base: number
          if (occ.allDay) {
            // Ganztägig: relativ zu Mitternacht in der Zone des Nutzers
            const day = (alarm.relativeTo === 'END' ? occ.endDay : occ.startDay) ?? occ.startDay!
            const [y, m, d] = day.split('-').map(Number)
            base = zone.wallToUtc({ y, m, d, h: 0, mi: 0, s: 0 })
          } else {
            base = alarm.relativeTo === 'END' ? occ.endUtc : occ.startUtc
          }
          fireAt = base + alarm.offsetSeconds * 1000
        }
        if (fireAt > now || now - fireAt > CATCH_UP_MS) continue
        const key = `${alarm.action}|${alarm.relativeTo}|${alarm.offsetSeconds}|${alarm.absoluteUtc ?? ''}`
        const res = mark.run(row.id, occ.recurrenceId ?? '', key, fireAt, now)
        if (res.changes === 0) continue
        this.notify({
          objectId: row.id,
          recurrenceId: occ.recurrenceId,
          title: textProp(occ, 'summary') ?? 'Termin',
          body: formatReminderBody(occ, now),
          startUtc: occ.startUtc,
          allDay: occ.allDay
        })
        fired += 1
      }
    }
    return fired
  }
}

export const reminderScheduler = new ReminderScheduler()
