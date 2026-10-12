import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { usePaper } from '@renderer/stores/paper'
import { useTasksSyncSettings } from '@renderer/queries/tasks'
import { cleanIpcError } from '@renderer/features/paper/account-states'

// Settings → Accounts: „Aufgaben synchronisieren mit …“ (Phase 3.2). One
// CalDAV task list (VTODO) overall; off by default.

export function TasksSyncSection(): React.JSX.Element | null {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const settings = useTasksSyncSettings()
  const [busy, setBusy] = useState(false)
  const lists = settings.data?.lists ?? []
  // Without a calendar account with a VTODO list there's nothing to choose
  if (lists.length === 0 && settings.data?.calendarId == null) return null

  const choose = (value: string): void => {
    setBusy(true)
    invoke('tasks:sync:set', { calendarId: value === '' ? null : Number(value) })
      .catch((err: unknown) =>
        toastNow(cleanIpcError(err instanceof Error ? err.message : String(err)))
      )
      .finally(() => {
        setBusy(false)
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      })
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div className="mlabel" style={{ color: 'var(--muted)' }}>
        {t('taskSyncHead')}
      </div>
      <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 4 }}>
        {t('taskSyncNote')}
      </div>
      <select
        className="paper-input"
        style={{ marginTop: 8 }}
        value={settings.data?.calendarId ?? ''}
        disabled={busy}
        aria-label={t('taskSyncHead')}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">{t('taskSyncOff')}</option>
        {lists.map((l) => (
          <option key={l.calendarId} value={l.calendarId}>
            {l.accountName} / {l.name}
          </option>
        ))}
      </select>
    </div>
  )
}
