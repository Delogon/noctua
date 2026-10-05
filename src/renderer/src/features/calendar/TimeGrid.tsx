import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CalendarInstance } from '@shared/calendar-types'
import { useI18n, useT } from '@renderer/lib/i18n'
import { addDays, dayKey, isSameDay, pad2, wallMinutes } from './dates'
import { isBanner, layoutDay, layoutSpans } from './layout'
import { BannerBar, TimedBlock } from './EventBlocks'
import { weekdayShort } from './format'
import { instanceKey, type QuickDraft } from '@renderer/stores/calendar'

// Tages-/Wochenraster: Ganztagszeile oben (Bänder), darunter das Zeitraster mit
// Überlappungs-Spalten, Arbeitszeit-Hinterlegung (08–18), Jetzt-Linie. Kopf und
// Ganztagszeile kleben (sticky) im selben Scroll-Container wie das Raster, damit
// Spalten bei Scrollbalken exakt fluchten.

export const HOUR_H = 44
const GUTTER = 48
const SNAP_MIN = 15
const WORK_START = 8
const WORK_END = 18
const INITIAL_SCROLL_HOUR = 7
const BAR_H = 20

interface Props {
  days: Date[]
  events: CalendarInstance[]
  colors: Map<number, string>
  selKey: string | null
  canCreate: boolean
  now: number
  onSelect: (e: CalendarInstance) => void
  onOpen: (e: CalendarInstance) => void
  onCreate: (slot: QuickDraft) => void
  onDayClick: (d: Date) => void
}

interface Drag {
  col: number
  a: number
  b: number
}

function snapMinutes(clientY: number, rect: DOMRect): number {
  const raw = ((clientY - rect.top) / HOUR_H) * 60
  return Math.max(0, Math.min(1440 - SNAP_MIN, Math.floor(raw / SNAP_MIN) * SNAP_MIN))
}

function atMinutes(day: Date, minutes: number): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime()
}

export function TimeGrid({
  days,
  events,
  colors,
  selKey,
  canCreate,
  now,
  onSelect,
  onOpen,
  onCreate,
  onDayClick
}: Props): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const nowDate = new Date(now)

  // Beim Öffnen auf 07:00 scrollen (Sticky-Kopf liegt im Fluss darüber → scrollTop = 7 h)
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = INITIAL_SCROLL_HOUR * HOUR_H
  }, [])

  const dayKeys = useMemo(() => days.map(dayKey), [days])
  const { banners, laid } = useMemo(() => {
    const banners = events.filter(isBanner)
    const timed = events.filter((e) => !isBanner(e))
    return { banners: layoutSpans(banners, dayKeys), laid: days.map((d) => layoutDay(timed, d)) }
  }, [events, days, dayKeys])

  const cols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`
  const laneRows = Math.max(1, banners.lanes)

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, d: Drag): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const moved = d.a !== d.b
    const startMin = Math.min(d.a, d.b)
    const endMin = moved ? Math.max(d.a, d.b) + SNAP_MIN : Math.min(1440, startMin + 60)
    const day = days[d.col]
    onCreate({
      startMs: atMinutes(day, startMin),
      endMs: atMinutes(day, endMin),
      allDay: false,
      rect: {
        left: rect.left,
        width: rect.width,
        top: rect.top + (startMin / 60) * HOUR_H,
        height: ((endMin - startMin) / 60) * HOUR_H
      }
    })
  }

  return (
    <div ref={scrollRef} className="cal-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="cal-sticky">
        <div className="cal-head" style={{ gridTemplateColumns: cols }}>
          <div className="cal-head__gutter" />
          {days.map((d) => {
            const today = isSameDay(d, nowDate)
            return (
              <button
                key={dayKey(d)}
                type="button"
                className="cal-head__day"
                data-today={today}
                aria-current={today ? 'date' : undefined}
                title={d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long'
                })}
                onClick={() => onDayClick(d)}
              >
                <span className="cal-head__wd">{weekdayShort(lang, d)}</span>
                <span className="cal-head__num" data-today={today}>
                  {d.getDate()}
                </span>
              </button>
            )
          })}
        </div>
        <div className="cal-allday" style={{ gridTemplateColumns: cols }}>
          <div className="cal-allday__label">{t('cvAllDayShort')}</div>
          <div
            className="cal-allday__grid"
            style={{
              gridColumn: `2 / span ${days.length}`,
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${laneRows}, ${BAR_H}px)`
            }}
          >
            {days.map((d, i) => (
              <div
                key={dayKey(d)}
                className="cal-allday__cell"
                data-today={isSameDay(d, nowDate)}
                data-creatable={canCreate}
                style={{ gridColumn: i + 1, gridRow: `1 / span ${laneRows}` }}
                aria-label={t('cvNewAllDayOn', { day: d.toLocaleDateString() })}
                onClick={(e) => {
                  if (!canCreate) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  onCreate({
                    startMs: d.getTime(),
                    endMs: addDays(d, 1).getTime(),
                    allDay: true,
                    rect: {
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height
                    }
                  })
                }}
              />
            ))}
            {banners.spans.map((s) => (
              <BannerBar
                key={s.item.key}
                event={s.item}
                color={colors.get(s.item.calendarId) ?? 'var(--ac)'}
                selected={selKey === instanceKey(s.item.objectId, s.item.recurrenceId)}
                onOpen={onOpen}
                onSelect={onSelect}
                clippedStart={s.clippedStart}
                clippedEnd={s.clippedEnd}
                style={{ gridColumn: `${s.startCol + 1} / ${s.endCol + 1}`, gridRow: s.lane + 1 }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="cal-body" style={{ gridTemplateColumns: cols, height: 24 * HOUR_H }}>
        <div className="cal-gutter">
          {Array.from({ length: 23 }, (_, i) => (
            <span key={i} className="cal-gutter__hour" style={{ top: (i + 1) * HOUR_H - 6 }}>
              {pad2(i + 1)}:00
            </span>
          ))}
        </div>
        {days.map((d, col) => {
          const today = isSameDay(d, nowDate)
          return (
            <div
              key={dayKey(d)}
              className="cal-col"
              data-today={today}
              data-creatable={canCreate}
              style={{ backgroundSize: `100% ${HOUR_H}px` }}
              onPointerDown={(e) => {
                if (!canCreate || e.button !== 0) return
                if ((e.target as HTMLElement).closest('.cal-event')) return
                e.currentTarget.setPointerCapture(e.pointerId)
                const m = snapMinutes(e.clientY, e.currentTarget.getBoundingClientRect())
                setDrag({ col, a: m, b: m })
              }}
              onPointerMove={(e) => {
                if (!drag || drag.col !== col) return
                const m = snapMinutes(e.clientY, e.currentTarget.getBoundingClientRect())
                if (m !== drag.b) setDrag({ ...drag, b: m })
              }}
              onPointerUp={(e) => {
                if (!drag || drag.col !== col) return
                finishDrag(e, drag)
                setDrag(null)
              }}
              onPointerCancel={() => setDrag(null)}
            >
              <div
                className="cal-work"
                style={{
                  top: WORK_START * HOUR_H,
                  height: (WORK_END - WORK_START) * HOUR_H
                }}
              />
              {laid[col].map((p) => (
                <TimedBlock
                  key={p.item.key}
                  event={p.item}
                  color={colors.get(p.item.calendarId) ?? 'var(--ac)'}
                  selected={selKey === instanceKey(p.item.objectId, p.item.recurrenceId)}
                  onOpen={onOpen}
                  onSelect={onSelect}
                  compact={p.bottom - p.top < 40}
                  style={{
                    top: (p.top / 60) * HOUR_H,
                    height: Math.max(14, ((p.bottom - p.top) / 60) * HOUR_H - 1),
                    left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                    width: `calc(${100 / p.cols}% - 3px)`
                  }}
                />
              ))}
              {drag?.col === col && (
                <div
                  className="cal-ghost"
                  style={{
                    top: (Math.min(drag.a, drag.b) / 60) * HOUR_H,
                    height:
                      ((drag.a === drag.b ? 60 : Math.abs(drag.b - drag.a) + SNAP_MIN) / 60) *
                      HOUR_H
                  }}
                />
              )}
              {today && (
                <div
                  className="cal-now"
                  aria-hidden="true"
                  style={{ top: (wallMinutes(now) / 60) * HOUR_H }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
