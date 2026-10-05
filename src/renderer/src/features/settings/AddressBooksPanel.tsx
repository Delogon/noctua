import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { hhmm } from '@renderer/features/calendar/format'
import { useDavContacts } from '@renderer/queries/contacts'
import { cleanIpcError } from '@renderer/features/paper/account-states'

// Settings -> Konten -> Kalender-Konto: Kontakte (CardDAV) ein-/ausschalten und
// Adressbuecher einzeln aktivieren. Nur lesend; es gibt keinen Kontakt-Editor.

function Toggle({
  on,
  label,
  onClick,
  disabled
}: {
  on: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn-bare flex items-center gap-1.5"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="toggle-track" style={{ background: on ? 'var(--ink)' : 'transparent' }}>
        <span
          className="toggle-dot"
          style={{ background: on ? '#F4F1EA' : 'var(--ink)', marginLeft: on ? 12 : 0 }}
        />
      </span>
    </button>
  )
}

export function AddressBooksPanel({ accountId }: { accountId: number }): React.JSX.Element | null {
  const t = useT()
  const queryClient = useQueryClient()
  const status = useDavContacts(accountId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!status.data) return null
  const data = status.data
  const reload = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['contacts', 'dav'] })
  }
  const fail = (err: unknown): void =>
    setError(cleanIpcError(err instanceof Error ? err.message : String(err)))

  const toggleSync = (): void => {
    setBusy(true)
    setError(null)
    invoke('contacts:dav:setSync', { accountId, enabled: !data.enabled })
      .then(reload)
      .catch(fail)
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="flex items-center gap-2">
        <Toggle on={data.enabled} label={t('cardSync')} onClick={toggleSync} disabled={busy} />
        <span style={{ font: '400 11px var(--mono)', color: 'var(--ink)' }}>{t('cardSync')}</span>
        {data.enabled && data.lastSync && (
          <span style={{ font: '500 9px var(--mono)', color: 'var(--muted)' }}>
            {t('cardSynced', {
              time: hhmm(data.lastSync)
            })}
          </span>
        )}
      </div>
      {data.enabled && (
        <div style={{ marginLeft: 4 }}>
          {data.addressBooks.map((b) => (
            <div key={b.id} className="flex items-center gap-2" style={{ padding: '2px 0' }}>
              <Toggle
                on={b.enabled}
                label={`${b.displayName}: ${b.enabled ? t('cardOn') : t('cardOff')}`}
                onClick={() =>
                  void invoke('contacts:dav:setAddressBook', {
                    addressBookId: b.id,
                    enabled: !b.enabled
                  })
                    .then(reload)
                    .catch(fail)
                }
              />
              <span style={{ font: '400 11px var(--mono)', color: 'var(--ink)' }}>
                {b.displayName}
              </span>
              {b.enabled && (
                <span style={{ font: '500 8.5px var(--mono)', color: 'var(--faint)' }}>
                  {t('cardCount', { n: b.contactCount })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {(error ?? (data.enabled ? data.error : null)) && (
        <div
          style={{ font: '400 12px var(--serif)', fontStyle: 'italic', color: 'var(--ac)' }}
          role="alert"
        >
          {error ?? data.error}
        </div>
      )}
      <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 2 }}>
        {t('cardNote')}
      </div>
    </div>
  )
}
