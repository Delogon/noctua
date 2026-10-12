import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'

/**
 * Settings → Intelligenz: Dürfen Antwortentwürfe die freien Zeitfenster des
 * Kalenders nutzen (ai.draftUseCalendar, Standard an)? '0' = aus.
 */
export function DraftCalendarToggle(): React.JSX.Element {
  const t = useT()
  const [on, setOn] = useState(true)
  const accounts = useQuery({
    queryKey: ['calendar:accounts'],
    queryFn: () => invoke('calendar:accounts:list', undefined),
    staleTime: 60_000,
    retry: false
  })
  useEffect(() => {
    void invoke('settings:get', { key: 'ai.draftUseCalendar' }).then((r) => setOn(r.value !== '0'))
  }, [])
  const toggle = (): void => {
    const next = !on
    setOn(next)
    void invoke('settings:set', { key: 'ai.draftUseCalendar', value: next ? '1' : '0' })
  }
  const hasAccount = (accounts.data?.accounts.length ?? 0) > 0
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('draftCalendarHead')}
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('draftCalendarSub')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 12 }}>
        <span onClick={toggle} className="flex cursor-pointer items-center gap-1.5">
          <span className="toggle-track" style={{ background: on ? 'var(--ink)' : 'transparent' }}>
            <span
              className="toggle-dot"
              style={{ background: on ? '#F4F1EA' : 'var(--ink)', marginLeft: on ? 12 : 0 }}
            />
          </span>
          <span style={{ font: '400 10px var(--mono)', color: 'var(--ink)' }}>
            {t('draftCalendarToggle')}
          </span>
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {on ? t('draftCalendarNoteOn') : t('draftCalendarNoteOff')}
          {on && !hasAccount && ` ${t('draftCalendarNoAccount')}`}
        </span>
      </div>
    </>
  )
}
