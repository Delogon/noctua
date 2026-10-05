import { useEffect, useMemo, useRef, useState } from 'react'
import type { CalendarInstance, CalendarSummary } from '@shared/calendar-types'
import { useI18n, useT } from '@renderer/lib/i18n'
import { usePaper } from '@renderer/stores/paper'
import { toast } from '@renderer/stores/toast'
import { instanceKey, useCalendar, type QuickDraft } from '@renderer/stores/calendar'
import {
  useCalendarAccounts,
  useCalendarEvents,
  useCalendars,
  usePrefetchEvents
} from '@renderer/queries/calendar'
import { OwlGlyph } from '@renderer/components/paper/OwlGlyph'
import {
  dayKey,
  isSameDay,
  monthGrid,
  nextFullHour,
  parseDayKey,
  shiftAnchor,
  viewDays,
  visibleRange,
  type CalView
} from './dates'
import { defaultSlot, formFromSlot } from './event-form'
import { colorMapOf } from './palette'
import { periodTitle, weekLabel } from './format'
import { useNow } from './useNow'
import { TimeGrid } from './TimeGrid'
import { MonthGrid } from './MonthGrid'
import { EventEditor } from './EventEditor'
import { QuickCreate } from './QuickCreate'
import { DeleteDialog } from './DeleteDialog'

// Kalenderansicht (Center-Sheet): Toolbar, Tages-/Wochen-/Monatsraster, Editor-Blatt,
// Schnell-Anlegen und Löschen-Dialog. Tastenaktionen kommen aus der Keymap als
// `paper:calendar`-Events.

const EMPTY_CALENDARS: CalendarSummary[] = []
/** Ab dieser Breite steht der Editor neben dem Raster, sonst darüber. */
const DOCK_MIN_WIDTH = 900
const MODES: CalView[] = ['day', 'week', 'month']

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** `n`/„Neu": Editor für einen neuen Termin ab der nächsten vollen Stunde (heute) bzw. 09:00. */
function startNewEvent(
  writable: readonly CalendarSummary[],
  anchor: string,
  noWritableText: string
): void {
  if (writable.length === 0) {
    toast.info(noWritableText)
    return
  }
  const today = new Date()
  const day = parseDayKey(anchor)
  const startMs = isSameDay(day, today)
    ? nextFullHour(today).getTime()
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).getTime()
  const slot = defaultSlot(startMs)
  useCalendar.getState().openNew(formFromSlot(slot.startMs, slot.endMs, false, writable[0].id))
}

function NoAccount(): React.JSX.Element {
  const t = useT()
  const setView = usePaper((s) => s.setView)
  const setSetSel = usePaper((s) => s.setSetSel)
  return (
    <div className="sheet-card flex min-w-0 flex-1 flex-col items-center justify-center">
      <div style={{ marginBottom: 10 }}>
        <OwlGlyph pose="asleep" size={30} />
      </div>
      <div
        style={{ font: '400 16px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }}
      >
        {t('cvNoAccount')}
      </div>
      <div className="mmeta" style={{ color: 'var(--faint)', margin: '8px 0 14px' }}>
        {t('cvNoAccountSub')}
      </div>
      <button
        type="button"
        className="ink-btn"
        onClick={() => {
          setSetSel('accounts')
          setView('settings')
        }}
      >
        {t('cvOpenSettings')}
      </button>
    </div>
  )
}

export function CalendarSheet(): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const accounts = useCalendarAccounts()
  const calendarsQ = useCalendars()
  const cal = useCalendar()
  const now = useNow()
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(rootRef)

  const calendars = calendarsQ.data ?? EMPTY_CALENDARS
  const colors = useMemo(() => colorMapOf(calendars), [calendars])
  const visibleIds = useMemo(() => calendars.filter((c) => c.visible).map((c) => c.id), [calendars])
  const writable = useMemo(
    () => calendars.filter((c) => !c.readOnly && c.components.includes('VEVENT')),
    [calendars]
  )
  const anchorDate = useMemo(() => parseDayKey(cal.anchor), [cal.anchor])
  const range = useMemo(() => visibleRange(cal.mode, anchorDate), [cal.mode, anchorDate])
  const days = useMemo(() => viewDays(cal.mode, anchorDate), [cal.mode, anchorDate])
  const weeks = useMemo(
    () => (cal.mode === 'month' ? monthGrid(anchorDate) : []),
    [cal.mode, anchorDate]
  )
  const { events } = useCalendarEvents(range.start.getTime(), range.end.getTime(), visibleIds)

  const adjacent = useMemo(() => {
    const prev = visibleRange(cal.mode, shiftAnchor(cal.mode, anchorDate, -1))
    const next = visibleRange(cal.mode, shiftAnchor(cal.mode, anchorDate, 1))
    return [
      { start: prev.start.getTime(), end: prev.end.getTime() },
      { start: next.start.getTime(), end: next.end.getTime() }
    ]
  }, [cal.mode, anchorDate])
  usePrefetchEvents(adjacent, visibleIds)

  // Aktueller Stand für den Tasten-Handler (ohne ihn bei jedem Render neu zu binden)
  const live = useRef({ events, writable, anchor: cal.anchor })
  useEffect(() => {
    live.current = { events, writable, anchor: cal.anchor }
  })

  useEffect(() => {
    const onAction = (e: Event): void => {
      const action = (e as CustomEvent<string>).detail
      const st = useCalendar.getState()
      const { events: evs, writable: wr, anchor } = live.current
      const selected = st.selKey ? evs.find((x) => x.key === st.selKey) : undefined
      if (action === 'day' || action === 'week' || action === 'month') st.setMode(action)
      else if (action === 'today') st.goToday()
      else if (action === 'prev') st.shift(-1)
      else if (action === 'next') st.shift(1)
      else if (action === 'escape') {
        if (st.deleteTarget) st.setDeleteTarget(null)
        else if (st.quick) st.setQuick(null)
        else if (st.editor) st.closeEditor()
        else if (st.selKey) st.select(null)
      } else if (action === 'new') {
        startNewEvent(wr, anchor, t('cvNoWritable'))
      } else if (action === 'open' || action === 'edit') {
        if (selected) st.openExisting(selected.objectId, selected.recurrenceId)
      } else if (action === 'delete') {
        if (selected && !selected.readOnly) {
          st.setDeleteTarget({
            objectId: selected.objectId,
            recurrenceId: selected.recurrenceId,
            recurring: selected.recurring,
            summary: selected.summary
          })
        }
      }
    }
    window.addEventListener('paper:calendar', onAction)
    return () => window.removeEventListener('paper:calendar', onAction)
  }, [t])

  if (accounts.data && accounts.data.length === 0) return <NoAccount />

  const select = (e: CalendarInstance): void => cal.select(instanceKey(e.objectId, e.recurrenceId))
  const open = (e: CalendarInstance): void => cal.openExisting(e.objectId, e.recurrenceId)
  const create = (slot: QuickDraft): void => cal.setQuick(slot)
  const canCreate = writable.length > 0
  const docked = width >= DOCK_MIN_WIDTH
  const showEditor = cal.editor !== null
  const title = periodTitle(lang, cal.mode, anchorDate, days)
  const todayShown = days.some((d) => isSameDay(d, new Date(now)))

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-1 gap-3.5">
      <div
        className="sheet-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        onPointerDown={() => {
          if (cal.quick) cal.setQuick(null)
        }}
      >
        <div
          className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline"
          style={{ padding: '10px 16px' }}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="cal-nav-btn"
              aria-label={t('cvPrev')}
              title={`${t('cvPrev')} (k)`}
              onClick={() => cal.shift(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="cal-nav-btn"
              aria-label={t('cvNext')}
              title={`${t('cvNext')} (j)`}
              onClick={() => cal.shift(1)}
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className="ghost-btn"
            data-active={todayShown}
            title={`${t('cvToday')} (t)`}
            onClick={cal.goToday}
          >
            {t('cvToday')}
          </button>
          <div
            className="min-w-0 truncate"
            style={{ font: '500 18px var(--serif)' }}
            aria-live="polite"
          >
            {title}
          </div>
          {cal.mode === 'week' && <span className="mmeta">{weekLabel(lang, days[0])}</span>}
          <div className="ml-auto flex items-center gap-3">
            <div className="cal-seg" role="group" aria-label={t('cvViewSwitch')}>
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={cal.mode === m}
                  data-on={cal.mode === m}
                  title={`${t(m === 'day' ? 'cvDay' : m === 'week' ? 'cvWeek' : 'cvMonth')} (${m[0]})`}
                  onClick={() => cal.setMode(m)}
                >
                  {t(m === 'day' ? 'cvDay' : m === 'week' ? 'cvWeek' : 'cvMonth')}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ink-btn"
              disabled={!canCreate}
              title={canCreate ? `${t('cvNew')} (n)` : t('cvNoWritable')}
              onClick={() => startNewEvent(writable, cal.anchor, t('cvNoWritable'))}
            >
              {t('cvNew')}
              <span style={{ opacity: 0.6 }}>n</span>
            </button>
          </div>
        </div>

        {calendars.length === 0 && calendarsQ.isSuccess && (
          <div className="mmeta" style={{ padding: '8px 16px', color: 'var(--faint)' }}>
            {t('cvNoCalendars')}
          </div>
        )}

        {cal.mode === 'month' ? (
          <MonthGrid
            weeks={weeks}
            anchor={anchorDate}
            events={events}
            colors={colors}
            selKey={cal.selKey}
            canCreate={canCreate}
            now={now}
            onSelect={select}
            onOpen={open}
            onCreate={create}
            onDayClick={(d) => cal.showDay(dayKey(d))}
          />
        ) : (
          <TimeGrid
            key={cal.mode}
            days={days}
            events={events}
            colors={colors}
            selKey={cal.selKey}
            canCreate={canCreate}
            now={now}
            onSelect={select}
            onOpen={open}
            onCreate={create}
            onDayClick={(d) => cal.showDay(dayKey(d))}
          />
        )}
      </div>

      {showEditor && (
        <div className="cal-editor-slot" data-docked={docked}>
          <EventEditor calendars={calendars} />
        </div>
      )}
      {cal.quick && (
        <QuickCreate
          key={`${cal.quick.startMs}-${cal.quick.endMs}-${cal.quick.allDay}`}
          draft={cal.quick}
          calendars={writable}
          defaultCalendarId={writable[0]?.id ?? null}
        />
      )}
      {cal.deleteTarget && <DeleteDialog target={cal.deleteTarget} />}
    </div>
  )
}
