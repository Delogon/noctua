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

/**
 * Zeitangabe eines Termins für EINEN Tag (Tagesbeginn `dayStartMs`, lokal). Über Mitternacht
 * laufende Termine zeigen am ersten Tag den Start mit „→", am Folgetag nur „→ Ende" — der Start
 * wird nicht wiederholt. `start`: am Starttag nur die Startzeit (Monatschips).
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
