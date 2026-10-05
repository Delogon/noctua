import type { CalendarInstance } from '@shared/calendar-types'
import type { Lang } from '@renderer/i18n/strings'
import { isoWeek, pad2, addDays, type CalView } from './dates'

// Anzeigeformate der Kalenderansicht (24-h, Montag-Wochen).

export function locale(lang: Lang): string {
  return lang === 'de' ? 'de-DE' : 'en-GB'
}

/** 'HH:mm' (24 h) eines Zeitstempels in der Systemzone. */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function timeRange(e: Pick<CalendarInstance, 'startUtc' | 'endUtc'>): string {
  return `${hhmm(e.startUtc)}–${hhmm(e.endUtc)}`
}

export function weekdayShort(lang: Lang, d: Date): string {
  return d.toLocaleDateString(locale(lang), { weekday: 'short' }).replace('.', '').toUpperCase()
}

/** Titel der Toolbar je Ansicht (Monat/Jahr, Zeitraum + KW, langer Tag). */
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

/** Datum für Listen/Agenda: 'MO 5. OKT.' */
export function dayLabel(lang: Lang, d: Date): string {
  return d.toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' })
}
