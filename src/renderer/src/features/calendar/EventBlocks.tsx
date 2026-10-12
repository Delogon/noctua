import type { CalendarInstance } from '@shared/calendar-types'
import { useT } from '@renderer/lib/i18n'
import { dayTimeLabel, timeRange } from './format'

// Rendering of single events (time grid block, band, month chip). Shared:
// calendar color as left edge, ↻ for series, dot for "not yet synced",
// struck through for cancelled events. Read-only events look the same
// (no edit affordance) and open the editor read-only.

interface BlockProps {
  event: CalendarInstance
  color: string
  selected: boolean
  onOpen: (e: CalendarInstance) => void
  onSelect: (e: CalendarInstance) => void
}

/** Below this block width (px) only the title remains, single line with ellipsis. */
const TINY_BLOCK_PX = 96

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

/** Block in the time grid (absolutely positioned, position via style from outside). */
export function TimedBlock({
  event,
  color,
  selected,
  onOpen,
  onSelect,
  style,
  compact,
  dayStart,
  widthPx
}: BlockProps & {
  style: React.CSSProperties
  compact: boolean
  /** Start of the column's day (local, ms): following days past midnight show "→ end" */
  dayStart: number
  /** Block width in px: very narrow blocks show only the title (with ellipsis) */
  widthPx: number
}): React.JSX.Element {
  const t = useT()
  const title = event.summary || t('cvNoTitle')
  const tiny = widthPx < TINY_BLOCK_PX
  return (
    <button
      type="button"
      className="cal-event"
      data-selected={selected}
      data-pending={event.pending}
      data-cancelled={event.status === 'CANCELLED'}
      data-readonly={event.readOnly}
      data-compact={compact}
      data-tiny={tiny}
      title={title}
      data-glyphs={event.recurring || event.pending}
      style={{ ...style, ['--cal-c' as string]: color }}
      aria-label={ariaLabelOf(event, t('cvNoTitle'), t('cvPendingTip'))}
      aria-pressed={selected}
      onFocus={() => onSelect(event)}
      onClick={() => onOpen(event)}
    >
      <span className="cal-event__title">{title}</span>
      {!compact && !tiny && (
        <span className="cal-event__meta">
          {dayTimeLabel(event, dayStart)}
          {event.location ? ` · ${event.location}` : ''}
        </span>
      )}
      <Glyphs event={event} />
    </button>
  )
}

/** Band in the all-day row or multi-day (grid position from outside). */
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

/** Time in the month chip; following day ("→ 01:30"): narrow cells keep only the arrow. */
function ChipTime({ label }: { label: string }): React.JSX.Element {
  if (!label.startsWith('→')) return <span className="cal-chip__time">{label}</span>
  return (
    <span className="cal-chip__time" data-cont="true">
      →<span className="cal-chip__end">{label.slice(1)}</span>
    </span>
  )
}

/** Entry of a month cell: timed events with time, bands filled. */
export function MonthChip({
  event,
  color,
  selected,
  banner,
  dayStart,
  onOpen,
  onSelect
}: BlockProps & { banner: boolean; dayStart: number }): React.JSX.Element {
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
      title={event.summary || t('cvNoTitle')}
      onFocus={() => onSelect(event)}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(event)
      }}
    >
      {!banner && <ChipTime label={dayTimeLabel(event, dayStart, 'start')} />}
      <span className="cal-chip__title">{event.summary || t('cvNoTitle')}</span>
      <Glyphs event={event} />
    </button>
  )
}
