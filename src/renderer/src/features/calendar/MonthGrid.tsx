import { useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarInstance } from '@shared/calendar-types'
import { useI18n, useT } from '@renderer/lib/i18n'
import { addDays, dayKey, isSameDay } from './dates'
import { eventsByDay, isBanner } from './layout'
import { MonthChip } from './EventBlocks'
import { weekdayShort } from './format'
import { instanceKey, type QuickDraft } from '@renderer/stores/calendar'

// Monatsraster: Wochen als Zeilen (Mo–So), je Tag so viele Einträge, wie die Zellhöhe
// zulässt, dazu „+k weitere" (öffnet die Tagesansicht).

const CHIP_H = 19
const DAY_HEAD_H = 24
const FALLBACK_ROWS = 3

interface Props {
  weeks: Date[][]
  anchor: Date
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

export function MonthGrid({
  weeks,
  anchor,
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
  const bodyRef = useRef<HTMLDivElement>(null)
  const [cellH, setCellH] = useState(0)
  const nowDate = new Date(now)

  // Zellhöhe beobachten → Anzahl sichtbarer Einträge
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = (): void => setCellH(el.clientHeight / weeks.length)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [weeks.length])

  const perCell =
    cellH > 0 ? Math.max(1, Math.floor((cellH - DAY_HEAD_H - 4) / CHIP_H)) : FALLBACK_ROWS
  const byDay = useMemo(() => eventsByDay(events, weeks.flat()), [events, weeks])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="cal-month-head">
        {weeks[0].map((d) => (
          <div key={dayKey(d)} className="cal-month-head__cell">
            {weekdayShort(lang, d)}
          </div>
        ))}
      </div>
      <div
        ref={bodyRef}
        className="cal-month-body min-h-0 flex-1"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((d) => {
          const key = dayKey(d)
          const list = byDay.get(key) ?? []
          // „+k weitere" nimmt selbst eine Zeile ein → eine Zeile weniger anzeigen
          const overflow = list.length > perCell
          const shown = overflow ? list.slice(0, Math.max(0, perCell - 1)) : list
          const hidden = list.length - shown.length
          const today = isSameDay(d, nowDate)
          return (
            <div
              key={key}
              className="cal-cell"
              data-today={today}
              data-outside={d.getMonth() !== anchor.getMonth()}
              data-creatable={canCreate}
              onClick={(e) => {
                if (!canCreate) return
                const rect = e.currentTarget.getBoundingClientRect()
                onCreate({
                  startMs: d.getTime(),
                  endMs: addDays(d, 1).getTime(),
                  allDay: true,
                  rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                })
              }}
            >
              <button
                type="button"
                className="cal-cell__num"
                data-today={today}
                aria-label={d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long'
                })}
                onClick={(e) => {
                  e.stopPropagation()
                  onDayClick(d)
                }}
              >
                {d.getDate()}
              </button>
              {shown.map((ev) => (
                <MonthChip
                  key={ev.key}
                  event={ev}
                  banner={isBanner(ev)}
                  color={colors.get(ev.calendarId) ?? 'var(--ac)'}
                  selected={selKey === instanceKey(ev.objectId, ev.recurrenceId)}
                  onOpen={onOpen}
                  onSelect={onSelect}
                />
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  className="cal-more"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDayClick(d)
                  }}
                >
                  {t('cvMore', { n: hidden })}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
