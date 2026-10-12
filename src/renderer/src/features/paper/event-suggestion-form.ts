import type { EventSuggestionView } from '@shared/event-suggestion-types'
import { addDays, dayKey, parseDayKey, systemTz } from '@renderer/features/calendar/dates'
import { NO_RECURRENCE } from '@renderer/features/calendar/rrule'
import type { EventForm } from '@renderer/features/calendar/event-form'

/**
 * Event suggestion → editor prefill („Bearbeiten…") and time display. Pure
 * functions. All-day suggestions have an EXCLUSIVE end; the form shows the
 * end date inclusively (like the editor).
 */
export function formFromSuggestion(
  s: Pick<
    EventSuggestionView,
    'title' | 'allDay' | 'startLocal' | 'endLocal' | 'tzid' | 'location' | 'link'
  >,
  calendarId: number | null,
  zone: string = systemTz()
): EventForm {
  const startDate = s.startLocal.slice(0, 10)
  const endDate = s.allDay
    ? // exclusive → inclusive, never before the start
      (() => {
        const incl = dayKey(addDays(parseDayKey(s.endLocal.slice(0, 10)), -1))
        return incl < startDate ? startDate : incl
      })()
    : s.endLocal.slice(0, 10)
  return {
    summary: s.title,
    location: s.location ?? '',
    description: s.link ?? '',
    allDay: s.allDay,
    startDate,
    startTime: s.allDay ? '09:00' : s.startLocal.slice(11, 16),
    endDate,
    endTime: s.allDay ? '10:00' : s.endLocal.slice(11, 16),
    tzid: s.allDay ? zone : (s.tzid ?? zone),
    calendarId,
    rec: NO_RECURRENCE,
    recCustom: null,
    alarm: 'none',
    transparency: 'OPAQUE'
  }
}

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** „Dienstag, 6. Oktober 2026, 10:00–11:00" (wall time as in the mail, no conversion). */
export function formatSuggestionWhen(
  s: Pick<EventSuggestionView, 'allDay' | 'startLocal' | 'endLocal' | 'tzid'>,
  lang: 'de' | 'en',
  zone: string = systemTz()
): string {
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  const dayFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
  const start = dayDate(s.startLocal.slice(0, 10))
  if (s.allDay) {
    const last = new Date(dayDate(s.endLocal.slice(0, 10)).getTime() - 86_400_000)
    const allDay = lang === 'de' ? 'ganztägig' : 'all day'
    return last.getTime() > start.getTime()
      ? `${dayFmt.format(start)} – ${dayFmt.format(last)} (${allDay})`
      : `${dayFmt.format(start)} (${allDay})`
  }
  const startTime = s.startLocal.slice(11, 16)
  const endTime = s.endLocal.slice(11, 16)
  const sameDay = s.startLocal.slice(0, 10) === s.endLocal.slice(0, 10)
  const head = `${dayFmt.format(start)}, ${startTime}`
  const tail = sameDay
    ? ` – ${endTime}`
    : ` – ${dayFmt.format(dayDate(s.endLocal.slice(0, 10)))}, ${endTime}`
  // Make a differing time zone named in the mail visible
  const tz = s.tzid && s.tzid !== zone ? ` (${s.tzid})` : ''
  return `${head}${tail}${tz}`
}
