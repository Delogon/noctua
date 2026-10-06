import type { CalendarInstance } from '@shared/calendar-types'
import { addDays, dayKey, startOfDay } from './dates'
import { compareEvents, dayRange } from './layout'

// Agenda der Owl-Rail: die nächsten Termine von heute und morgen.

export interface AgendaItems {
  today: CalendarInstance[]
  tomorrow: CalendarInstance[]
}

/** Abfragefenster [heute 00:00, übermorgen 00:00) in ms. */
export function agendaRange(now: Date): { start: number; end: number } {
  const start = startOfDay(now)
  return { start: start.getTime(), end: addDays(start, 2).getTime() }
}

/**
 * Heute: nur, was noch nicht vorbei ist (Ganztägiges bleibt den ganzen Tag);
 * morgen: alles. Abgesagte Termine fallen heraus.
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
