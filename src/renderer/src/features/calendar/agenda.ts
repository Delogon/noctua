import type { CalendarInstance } from '@shared/calendar-types'
import { addDays, dayKey, startOfDay } from './dates'
import { compareEvents, dayRange } from './layout'

// Owl rail agenda: the next events of today and tomorrow.

export interface AgendaItems {
  today: CalendarInstance[]
  tomorrow: CalendarInstance[]
}

/** Query window [today 00:00, day after tomorrow 00:00) in ms. */
export function agendaRange(now: Date): { start: number; end: number } {
  const start = startOfDay(now)
  return { start: start.getTime(), end: addDays(start, 2).getTime() }
}

/**
 * Today: only what is not over yet (all-day stays for the whole day);
 * tomorrow: everything. Cancelled events are dropped.
 */
export function agendaItems(events: readonly CalendarInstance[], now: Date): AgendaItems {
  const todayKey = dayKey(now)
  const tomorrowKey = dayKey(addDays(now, 1))
  const out: AgendaItems = { today: [], tomorrow: [] }
  for (const e of [...events].sort(compareEvents)) {
    if (e.status === 'CANCELLED') continue
    const { startDay, endDay } = dayRange(e)
    if (todayKey >= startDay && todayKey < endDay) {
      if (e.allDay || e.endUtc > now.getTime()) out.today.push(e)
    }
    if (tomorrowKey >= startDay && tomorrowKey < endDay) out.tomorrow.push(e)
  }
  return out
}
