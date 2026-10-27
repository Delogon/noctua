import type {
  CalendarEditScope,
  CalendarEventFields,
  CalendarEventPatch
} from '@shared/calendar-types'
import { wallAsUtcMs, utcMsAsWall } from './dates'

// Series editing: when the scope dialog ("Only this / This and following /
// All") is needed and how the patch for the chosen scope is built.

export const SCOPE_ORDER: readonly CalendarEditScope[] = ['this', 'following', 'all']

/** Must the user choose a scope? (only for series or series exceptions) */
export function needsScope(target: { recurring: boolean }): boolean {
  return target.recurring
}

/** Effective scope for the backend: single events always run as 'all'. */
export function effectiveScope(
  target: { recurring: boolean },
  chosen: CalendarEditScope | null
): CalendarEditScope {
  return target.recurring ? (chosen ?? 'all') : 'all'
}

/**
 * Only the fields that actually changed. For scope 'all' the backend changes time
 * and rule of the whole series and then discards exceptions — unchanged fields
 * must therefore never be sent.
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
 * Time change for the WHOLE series: the edited event is an occurrence (not
 * the series start). The shift of this occurrence is applied to the series start
 * (`masterTime`) so DTSTART does not jump to the occurrence.
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
 * Patch for `calendar:events:update` depending on scope:
 * - 'this': the series rule cannot be changed → remove it
 * - 'all' with a time change on an occurrence: shift relative to the series start
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
