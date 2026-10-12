import { useMemo, useState } from 'react'
import type { CalendarSummary } from '@shared/calendar-types'
import { invoke } from '@renderer/lib/ipc'
import { useI18n, useT } from '@renderer/lib/i18n'
import { useCalendar } from '@renderer/stores/calendar'
import {
  useCalendarAccounts,
  useCalendarListActions,
  useCalendars
} from '@renderer/queries/calendar'
import { addMonths, dayKey, isSameDay, monthGrid, parseDayKey, viewDays } from './dates'
import { CALENDAR_PALETTE, colorMapOf } from './palette'
import { locale, weekdayShort } from './format'

// Seitenleiste der Kalenderansicht (linke Spalte): Mini-Monat zum Navigieren und die
// Kalender-Legende mit Sichtbarkeit und Farbwahl. Die Farbe kommt aus einer kleinen
// festen Palette; „Standard" gibt die Serverfarbe wieder frei.

function MiniMonth(): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const { anchor, mode, setAnchor } = useCalendar()
  const anchorDate = useMemo(() => parseDayKey(anchor), [anchor])
  // Angezeigter Monat folgt dem Anker, lässt sich aber unabhängig blättern
  const [shown, setShown] = useState<{ key: string; offset: number }>({ key: anchor, offset: 0 })
  const offset = shown.key === anchor ? shown.offset : 0
  const monthDate = addMonths(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1), offset)
  const weeks = monthGrid(monthDate)
  const inView = new Set(mode === 'month' ? [] : viewDays(mode, anchorDate).map(dayKey))
  const today = new Date()

  return (
    <div style={{ padding: '12px 18px 10px' }}>
      <div className="flex items-center gap-1" style={{ marginBottom: 6 }}>
        <span className="min-w-0 flex-1 truncate" style={{ font: '500 13.5px var(--serif)' }}>
          {monthDate.toLocaleDateString(locale(lang), { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          className="cal-nav-btn"
          aria-label={t('cvPrevMonth')}
          onClick={() => setShown({ key: anchor, offset: offset - 1 })}
        >
          ‹
        </button>
        <button
          type="button"
          className="cal-nav-btn"
          aria-label={t('cvNextMonth')}
          onClick={() => setShown({ key: anchor, offset: offset + 1 })}
        >
          ›
        </button>
      </div>
      <div className="cal-mini" role="grid" aria-label={t('cvMiniLabel')}>
        {weeks[0].map((d) => (
          <div key={dayKey(d)} className="cal-mini__wd" role="columnheader">
            {weekdayShort(lang, d).slice(0, 2)}
          </div>
        ))}
        {weeks.flat().map((d) => (
          <button
            key={dayKey(d)}
            type="button"
            role="gridcell"
            className="cal-mini__day"
            data-today={isSameDay(d, today)}
            data-outside={d.getMonth() !== monthDate.getMonth()}
            data-inview={mode !== 'month' && inView.has(dayKey(d))}
            aria-selected={dayKey(d) === anchor}
            aria-label={d.toLocaleDateString(locale(lang), {
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            })}
            onClick={() => setAnchor(dayKey(d))}
          >
            {d.getDate()}
          </button>
        ))}
      </div>
    </div>
  )
}

function CalendarRow({
  cal,
  color,
  onToggle,
  onColor
}: {
  cal: CalendarSummary
  color: string
  onToggle: () => void
  onColor: (color: string | null) => void
}): React.JSX.Element {
  const t = useT()
  const [picking, setPicking] = useState(false)
  return (
    <div style={{ padding: '6px 18px' }}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          className="cal-check"
          role="checkbox"
          aria-checked={cal.visible}
          aria-label={`${cal.displayName} — ${cal.visible ? t('calVisible') : t('calHidden')}`}
          data-on={cal.visible}
          style={{ ['--cal-c' as string]: color }}
          onClick={onToggle}
        />
        <span
          className="min-w-0 flex-1 truncate"
          style={{
            font: '400 13px var(--serif)',
            color: cal.visible ? 'var(--ink)' : 'var(--faint)'
          }}
        >
          {cal.displayName}
        </span>
        {cal.readOnly && (
          <span
            className="mchip"
            style={{ border: '1px solid var(--hairline)', color: 'var(--muted)' }}
          >
            {t('calReadOnly')}
          </span>
        )}
        <button
          type="button"
          className="cal-swatch-btn"
          aria-label={t('cvColorFor', { name: cal.displayName })}
          aria-expanded={picking}
          title={t('cvColor')}
          style={{ ['--cal-c' as string]: color }}
          onClick={() => setPicking(!picking)}
        />
      </div>
      {picking && (
        <div className="flex flex-wrap items-center gap-1.5" style={{ margin: '8px 0 2px 22px' }}>
          {CALENDAR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="cal-swatch"
              aria-label={c}
              aria-pressed={cal.color?.toLowerCase() === c.toLowerCase()}
              data-on={cal.color?.toLowerCase() === c.toLowerCase()}
              style={{ ['--cal-c' as string]: c }}
              onClick={() => {
                onColor(c)
                setPicking(false)
              }}
            />
          ))}
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              onColor(null)
              setPicking(false)
            }}
          >
            {t('cvColorDefault')}
          </button>
        </div>
      )}
    </div>
  )
}

export function CalendarSidebar(): React.JSX.Element {
  const t = useT()
  const accounts = useCalendarAccounts()
  const calendarsQ = useCalendars()
  const { setVisible, setColor } = useCalendarListActions()
  const calendars = useMemo(() => calendarsQ.data ?? [], [calendarsQ.data])
  const colors = useMemo(() => colorMapOf(calendars), [calendars])
  const groups = useMemo(() => {
    const names = new Map((accounts.data ?? []).map((a) => [a.id, a.name]))
    const byAccount = new Map<number, CalendarSummary[]>()
    for (const c of calendars) {
      const list = byAccount.get(c.accountId) ?? []
      list.push(c)
      byAccount.set(c.accountId, list)
    }
    return [...byAccount].map(([id, list]) => ({
      id,
      name: names.get(id) ?? '',
      list: [...list].sort((a, b) => a.order - b.order)
    }))
  }, [calendars, accounts.data])
  const syncing = (accounts.data ?? []).some(
    (a) => a.state === 'syncing' || a.state === 'connecting'
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mlabel flex flex-none items-center border-b border-hairline"
        style={{ padding: '9px 18px 7px', color: 'var(--muted)' }}
      >
        <span className="flex-1">{t('cvHead')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MiniMonth />
        <div className="border-t border-hairline" style={{ padding: '10px 0 6px' }}>
          <div className="mlabel" style={{ padding: '0 18px 4px', color: 'var(--muted)' }}>
            {t('cvCalendars')}
          </div>
          {groups.length === 0 && (
            <div
              style={{
                padding: '6px 18px',
                font: '400 12px var(--serif)',
                fontStyle: 'italic',
                color: 'var(--faint)'
              }}
            >
              {t('cvNoCalendars')}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id}>
              {groups.length > 1 && g.name && (
                <div className="mmeta" style={{ padding: '6px 18px 0', color: 'var(--faint)' }}>
                  {g.name}
                </div>
              )}
              {g.list.map((c) => (
                <CalendarRow
                  key={c.id}
                  cal={c}
                  color={colors.get(c.id) ?? 'var(--ac)'}
                  onToggle={() => void setVisible(c.id, !c.visible)}
                  onColor={(color) => void setColor(c.id, color)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div
        className="flex flex-none items-center border-t border-hairline"
        style={{ padding: '8px 18px', font: '400 9.5px var(--mono)', color: 'var(--muted)' }}
      >
        <button
          type="button"
          className="text-btn"
          disabled={syncing}
          onClick={() => void invoke('calendar:refresh', {})}
        >
          {syncing ? t('calSyncing') : `↻ ${t('calRefresh')}`}
        </button>
      </div>
    </div>
  )
}
