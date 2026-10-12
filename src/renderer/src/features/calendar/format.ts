import type { CalendarInstance } from '@shared/calendar-types'
import type { Lang } from '@renderer/i18n/strings'
import { isoWeek, pad2, addDays, type CalView } from './dates'

// Display formats of the calendar view (24 h, Monday weeks).

export function locale(lang: Lang): string {
  return lang === 'de' ? 'de-DE' : 'en-GB'
}

/** 'HH:mm' (24 h) of a timestamp in the system zone. */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function timeRange(e: Pick<CalendarInstance, 'startUtc' | 'endUtc'>): string {
  return `${hhmm(e.startUtc)}–${hhmm(e.endUtc)}`
}

/**
 * Time label of an event for ONE day (start of day `dayStartMs`, local). Events running
 * past midnight show the start with "→" on the first day, only "→ end" on the following day — the start
 * is not repeated. `start`: on the start day only the start time (month chips).
 */
export function dayTimeLabel(
  e: Pick<CalendarInstance, 'startUtc' | 'endUtc'>,
  dayStartMs: number,
  mode: 'range' | 'start' = 'range'
): string {
  const dayEndMs = addDays(new Date(dayStartMs), 1).getTime()
  const startsHere = e.startUtc >= dayStartMs
  const endsHere = e.endUtc <= dayEndMs
  if (startsHere && endsHere) return mode === 'start' ? hhmm(e.startUtc) : timeRange(e)
  if (startsHere) return mode === 'start' ? hhmm(e.startUtc) : `${hhmm(e.startUtc)} →`
  if (endsHere) return `→ ${hhmm(e.endUtc)}`
  return '→'
}

export function weekdayShort(lang: Lang, d: Date): string {
  return d.toLocaleDateString(locale(lang), { weekday: 'short' }).replace('.', '').toUpperCase()
}

/** Toolbar title per view (month/year, range + week number, long day). */
export function periodTitle(
  lang: Lang,
  view: CalView,
  anchor: Date,
  days: readonly Date[]
): string {
  const loc = locale(lang)
  if (view === 'month') return anchor.toLocaleDateString(loc, { month: 'long', year: 'numeric' })
  if (view === 'day') {
    return anchor.toLocaleDateString(loc, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }
  const first = days[0]
  const last = days[days.length - 1] ?? addDays(first, 6)
  const range = new Intl.DateTimeFormat(loc, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).formatRange(first, last)
  return range
}

export function weekLabel(lang: Lang, d: Date): string {
  return `${lang === 'de' ? 'KW' : 'W'} ${isoWeek(d)}`
}

/** Date for lists/agenda: 'MO 5. OKT.' */
export function dayLabel(lang: Lang, d: Date): string {
  return d.toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' })
}
