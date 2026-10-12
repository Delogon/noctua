import { useMemo } from 'react'
import type { CalendarInstance } from '@shared/calendar-types'
import { useT } from '@renderer/lib/i18n'
import { usePaper } from '@renderer/stores/paper'
import { useCalendar } from '@renderer/stores/calendar'
import { useCalendarEvents, useCalendars } from '@renderer/queries/calendar'
import { agendaItems, agendaRange } from './agenda'
import { colorMapOf } from './palette'
import { hhmm } from './format'
import { useNow } from './useNow'

// Kompakte „Heute"-Agenda der Owl-Rail: die nächsten Termine von heute (und morgen).
// Klick springt in die Kalenderansicht auf den Termin. Ohne Kalender bleibt die Rail
// unverändert (keine Karte).

const MAX_ITEMS = 5

function Row({
  event,
  color,
  onOpen
}: {
  event: CalendarInstance
  color: string
  onOpen: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className="cal-rail-row btn-bare flex w-full items-center gap-2"
      onClick={onOpen}
      style={{ marginTop: 7, ['--cal-c' as string]: color }}
    >
      <span className="cal-rail-row__bar" aria-hidden="true" />
      <span className="cal-rail-row__time">
        {event.allDay ? t('cvAllDayShort') : hhmm(event.startUtc)}
      </span>
      <span className="min-w-0 flex-1 truncate" style={{ font: '400 12px var(--serif)' }}>
        {event.summary || t('cvNoTitle')}
      </span>
      {(event.recurring || event.pending) && (
        <span aria-hidden="true" style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {event.recurring ? '↻' : ''}
          {event.pending ? '●' : ''}
        </span>
      )}
    </button>
  )
}

export function RailAgenda(): React.JSX.Element | null {
  const t = useT()
  const setView = usePaper((s) => s.setView)
  const calendarsQ = useCalendars()
  const now = useNow()
  const calendars = calendarsQ.data
  const visibleIds = useMemo(
    () => (calendars ?? []).filter((c) => c.visible).map((c) => c.id),
    [calendars]
  )
  const colors = useMemo(() => colorMapOf(calendars ?? []), [calendars])
  // Tagesbeginn als Abfrageschlüssel: stabil über den Tag, wechselt um Mitternacht
  const range = useMemo(() => agendaRange(new Date(now)), [now])
  const { events } = useCalendarEvents(range.start, range.end, visibleIds)
  const items = useMemo(() => agendaItems(events, new Date(now)), [events, now])

  if (!calendars || calendars.length === 0) return null

  const all = [
    ...items.today.map((e) => ({ e, day: 'today' as const })),
    ...items.tomorrow.map((e) => ({ e, day: 'tomorrow' as const }))
  ]
  const shown = all.slice(0, MAX_ITEMS)
  const hidden = all.length - shown.length
  const open = (e: CalendarInstance): void => {
    const startMs =
      e.allDay && e.startDay ? new Date(`${e.startDay}T00:00:00`).getTime() : e.startUtc
    useCalendar.getState().focusEvent(e.objectId, e.recurrenceId, startMs)
  }

  return (
    <div className="rail-card flex-none" style={{ padding: '11px 13px' }}>
      <div className="flex items-baseline">
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('railAgendaHead')}
        </span>
        <button
          type="button"
          onClick={() => setView('calendar')}
          className="btn-bare ml-auto"
          style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}
        >
          {t('railAgendaArrow')}
        </button>
      </div>
      {shown.length === 0 && (
        <div
          style={{
            font: '400 11.5px/1.55 var(--serif)',
            fontStyle: 'italic',
            color: 'var(--faint)',
            marginTop: 8
          }}
        >
          {t('railAgendaNone')}
        </div>
      )}
      {shown.map(({ e, day }, i) => (
        <div key={e.key}>
          {day === 'tomorrow' && (i === 0 || shown[i - 1].day === 'today') && (
            <div
              className="mmeta"
              style={{ marginTop: 9, paddingTop: 7, borderTop: '1px solid var(--hairline)' }}
            >
              {t('cvTomorrow')}
            </div>
          )}
          <Row event={e} color={colors.get(e.calendarId) ?? 'var(--ac)'} onOpen={() => open(e)} />
        </div>
      ))}
      {hidden > 0 && (
        <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 9 }}>
          {t('cvMore', { n: hidden })}
        </div>
      )}
    </div>
  )
}
