import type {
  CalendarEditScope,
  CalendarEventFields,
  CalendarEventPatch
} from '@shared/calendar-types'
import { wallAsUtcMs, utcMsAsWall } from './dates'

// Serien-Bearbeitung: wann der Bereichs-Dialog („Nur dieser / Dieser und folgende /
// Alle") nötig ist und wie das Patch für den gewählten Bereich entsteht.

export const SCOPE_ORDER: readonly CalendarEditScope[] = ['this', 'following', 'all']

/** Muss der Nutzer einen Bereich wählen? (nur bei Serien bzw. Serien-Ausnahmen) */
export function needsScope(target: { recurring: boolean }): boolean {
  return target.recurring
}

/** Effektiver Bereich fürs Backend: Einzeltermine laufen immer als 'all'. */
export function effectiveScope(
  target: { recurring: boolean },
  chosen: CalendarEditScope | null
): CalendarEditScope {
  return target.recurring ? (chosen ?? 'all') : 'all'
}

/**
 * Nur die tatsächlich geänderten Felder. Das Backend stellt bei Bereich 'all' Zeit
 * und Regel der ganzen Serie um und verwirft dann Ausnahmen — ungeänderte Felder
 * dürfen deshalb nie mitgeschickt werden.
 */
export function diffFields(
  initial: CalendarEventFields,
  next: CalendarEventFields
): CalendarEventPatch {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(next) as Array<keyof CalendarEventFields>) {
    if (JSON.stringify(initial[key]) !== JSON.stringify(next[key])) patch[key] = next[key]
  }
  return patch as CalendarEventPatch
}

/**
 * Zeitänderung für die GANZE Serie: der bearbeitete Termin ist ein Vorkommen (nicht
 * der Serienstart). Die Verschiebung dieses Vorkommens wird auf den Serienstart
 * (`masterTime`) übertragen, damit DTSTART nicht auf das Vorkommen springt.
 */
export function shiftSeriesTime(
  masterTime: CalendarEventFields['time'],
  occurrenceTime: CalendarEventFields['time'],
  nextTime: CalendarEventFields['time']
): CalendarEventFields['time'] {
  const delta = wallAsUtcMs(nextTime.start) - wallAsUtcMs(occurrenceTime.start)
  const duration = wallAsUtcMs(nextTime.end) - wallAsUtcMs(nextTime.start)
  const start = wallAsUtcMs(masterTime.start) + delta
  return {
    allDay: nextTime.allDay,
    start: utcMsAsWall(start, nextTime.allDay),
    end: utcMsAsWall(start + duration, nextTime.allDay),
    tzid: nextTime.tzid
  }
}

/**
 * Patch für `calendar:events:update` je nach Bereich:
 * - 'this': die Serienregel ist nicht änderbar → entfernen
 * - 'all' mit Zeitänderung an einem Vorkommen: relativ zum Serienstart verschieben
 */
export function patchForScope(
  scope: CalendarEditScope,
  patch: CalendarEventPatch,
  ctx: {
    recurring: boolean
    occurrenceTime: CalendarEventFields['time']
    masterTime: CalendarEventFields['time'] | null
  }
): CalendarEventPatch {
  const out: CalendarEventPatch = { ...patch }
  if (scope === 'this') delete out.rrule
  if (scope === 'all' && ctx.recurring && out.time && ctx.masterTime) {
    out.time = shiftSeriesTime(ctx.masterTime, ctx.occurrenceTime, out.time)
  }
  return out
}
