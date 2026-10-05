import type { CalendarInstance } from '@shared/calendar-types'
import { useT } from '@renderer/lib/i18n'
import { hhmm, timeRange } from './format'

// Darstellung einzelner Termine (Zeitraster-Block, Bandleiste, Monats-Chip). Gemeinsam:
// Kalenderfarbe als linke Kante, ↻ für Serien, Punkt für „noch nicht übertragen",
// durchgestrichen bei abgesagten Terminen. Schreibgeschützte Termine sehen gleich aus
// (kein Bearbeiten-Affordance) und öffnen den Editor schreibgeschützt.

interface BlockProps {
  event: CalendarInstance
  color: string
  selected: boolean
  onOpen: (e: CalendarInstance) => void
  onSelect: (e: CalendarInstance) => void
}

function Glyphs({ event }: { event: CalendarInstance }): React.JSX.Element | null {
  const t = useT()
  if (!event.recurring && !event.pending) return null
  return (
    <span className="cal-glyphs" aria-hidden="true">
      {event.recurring && <span title={t('cvRecurring')}>↻</span>}
      {event.pending && <span title={t('cvPendingTip')}>●</span>}
    </span>
  )
}

function ariaLabelOf(event: CalendarInstance, noTitle: string, pending: string): string {
  const title = event.summary || noTitle
  const when = event.allDay ? '' : `, ${timeRange(event)}`
  return `${title}${when}${event.location ? `, ${event.location}` : ''}${event.pending ? `, ${pending}` : ''}`
}

/** Block im Zeitraster (absolut positioniert, Position per Style von außen). */
export function TimedBlock({
  event,
  color,
  selected,
  onOpen,
  onSelect,
  style,
  compact
}: BlockProps & { style: React.CSSProperties; compact: boolean }): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className="cal-event"
      data-selected={selected}
      data-pending={event.pending}
      data-cancelled={event.status === 'CANCELLED'}
      data-readonly={event.readOnly}
      data-compact={compact}
      style={{ ...style, ['--cal-c' as string]: color }}
      aria-label={ariaLabelOf(event, t('cvNoTitle'), t('cvPendingTip'))}
      aria-pressed={selected}
      onFocus={() => onSelect(event)}
      onClick={() => onOpen(event)}
    >
      <span className="cal-event__title">{event.summary || t('cvNoTitle')}</span>
      {!compact && (
        <span className="cal-event__meta">
          {timeRange(event)}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      )}
      <Glyphs event={event} />
    </button>
  )
}

/** Band in der Ganztagszeile bzw. mehrtägig (Gitter-Position von außen). */
export function BannerBar({
  event,
  color,
  selected,
  onOpen,
  onSelect,
  style,
  clippedStart,
  clippedEnd
}: BlockProps & {
  style: React.CSSProperties
  clippedStart: boolean
  clippedEnd: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className="cal-bar"
      data-selected={selected}
      data-pending={event.pending}
      data-cancelled={event.status === 'CANCELLED'}
      data-clip-start={clippedStart}
      data-clip-end={clippedEnd}
      style={{ ...style, ['--cal-c' as string]: color }}
      aria-label={ariaLabelOf(event, t('cvNoTitle'), t('cvPendingTip'))}
      aria-pressed={selected}
      onFocus={() => onSelect(event)}
      onClick={() => onOpen(event)}
    >
      <span className="cal-bar__title">{event.summary || t('cvNoTitle')}</span>
      <Glyphs event={event} />
    </button>
  )
}

/** Eintrag einer Monatszelle: Zeittermine mit Uhrzeit, Bänder gefüllt. */
export function MonthChip({
  event,
  color,
  selected,
  banner,
  onOpen,
  onSelect
}: BlockProps & { banner: boolean }): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className="cal-chip"
      data-banner={banner}
      data-selected={selected}
      data-pending={event.pending}
      data-cancelled={event.status === 'CANCELLED'}
      style={{ ['--cal-c' as string]: color }}
      aria-label={ariaLabelOf(event, t('cvNoTitle'), t('cvPendingTip'))}
      aria-pressed={selected}
      onFocus={() => onSelect(event)}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(event)
      }}
    >
      {!banner && <span className="cal-chip__time">{hhmm(event.startUtc)}</span>}
      <span className="cal-chip__title">{event.summary || t('cvNoTitle')}</span>
      <Glyphs event={event} />
    </button>
  )
}
