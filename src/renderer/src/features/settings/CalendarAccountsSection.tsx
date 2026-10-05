import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { hhmm } from '@renderer/features/calendar/format'
import { usePaper } from '@renderer/stores/paper'
import { useAccounts } from '@renderer/queries/accounts'
import { useCalendarAccounts, useCalendars } from '@renderer/queries/calendar'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import { AddressBooksPanel } from './AddressBooksPanel'
import type { InvokeOutput } from '@shared/ipc-contract'

// Settings → Konten: Kalender-Konten (CalDAV). Bewusst minimal (Phase 2.1):
// einrichten per URL oder aus einem Mail-Konto, Verbindung testen, Kalender mit
// Sichtbarkeit auflisten, Passwort neu eingeben. Die Kalenderansicht kommt in 2.2.

type CalendarAccount = InvokeOutput<'calendar:accounts:list'>['accounts'][number]
type Discovered = InvokeOutput<'calendar:accounts:discover'>

const BTN_PRIMARY: React.CSSProperties = {
  font: '500 10px var(--mono)',
  color: 'var(--paper)',
  background: 'var(--ink)',
  padding: '5px 12px'
}
const BTN_GHOST: React.CSSProperties = {
  font: '500 9px var(--mono)',
  letterSpacing: '.5px',
  border: '1px solid var(--rule, var(--faint))',
  color: 'var(--muted)',
  padding: '4px 10px'
}

function errText(err: unknown): string {
  return cleanIpcError(err instanceof Error ? err.message : String(err))
}

function host(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function CalendarAccountsSection(): React.JSX.Element {
  const t = useT()
  const accounts = useCalendarAccounts()
  const calendars = useCalendars()
  const [adding, setAdding] = useState(false)

  return (
    <div style={{ marginTop: 16 }}>
      <div className="flex items-baseline justify-between">
        <div className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('calHead')}
        </div>
        <button
          type="button"
          className="btn-bare"
          style={BTN_GHOST}
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? t('cancel') : t('calAdd')}
        </button>
      </div>
      <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 4 }}>
        {t('calNote')}
      </div>

      {adding && <AddCalendarForm onDone={() => setAdding(false)} />}

      {(accounts.data ?? []).map((account) => (
        <CalendarAccountCard
          key={account.id}
          account={account}
          calendars={(calendars.data ?? []).filter((c) => c.accountId === account.id)}
        />
      ))}
      {accounts.data?.length === 0 && !adding && (
        <div
          style={{
            font: '400 11.5px/1.6 var(--serif)',
            fontStyle: 'italic',
            color: 'var(--faint)',
            marginTop: 8
          }}
        >
          {t('calEmpty')}
        </div>
      )}
    </div>
  )
}

function AddCalendarForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const mailAccounts = useAccounts()
  const [name, setName] = useState('')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mailAccountId, setMailAccountId] = useState<number | null>(null)
  const [canReuse, setCanReuse] = useState(false)
  const [reuse, setReuse] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<Discovered | null>(null)

  const request = (): Parameters<typeof invoke<'calendar:accounts:discover'>>[1] => ({
    serverInput: server.trim(),
    username: username.trim(),
    password: reuse ? undefined : password,
    ...(mailAccountId !== null ? { mailAccountId, reuseMailPassword: reuse } : {})
  })
  const ready =
    server.trim() !== '' && username.trim() !== '' && (reuse || password !== '') && !busy

  const pickMail = (value: string): void => {
    setFound(null)
    setError(null)
    if (value === '') {
      setMailAccountId(null)
      setCanReuse(false)
      setReuse(false)
      return
    }
    const id = Number(value)
    setMailAccountId(id)
    void invoke('calendar:accounts:suggest', { mailAccountId: id })
      .then((s) => {
        setUsername(s.username)
        setServer(s.serverInput)
        setCanReuse(s.canReusePassword)
        setReuse(s.canReusePassword)
        const mail = mailAccounts.data?.find((a) => a.id === id)
        if (mail && !name) setName(mail.accountName)
      })
      .catch((err) => setError(errText(err)))
  }

  const test = (): void => {
    setBusy(true)
    setError(null)
    invoke('calendar:accounts:discover', request())
      .then(setFound)
      .catch((err) => {
        setFound(null)
        setError(errText(err))
      })
      .finally(() => setBusy(false))
  }

  const connect = (): void => {
    setBusy(true)
    setError(null)
    invoke('calendar:accounts:add', {
      ...request(),
      name: name.trim() || host(server.includes('://') ? server : `https://${server}`)
    })
      .then((res) => {
        toastNow(t('calConnected', { n: res.calendarCount }))
        void queryClient.invalidateQueries({ queryKey: ['calendar'] })
        onDone()
      })
      .catch((err) => setError(errText(err)))
      .finally(() => setBusy(false))
  }

  return (
    <form
      className="flex flex-col gap-2"
      style={{ marginTop: 10 }}
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) connect()
      }}
    >
      {(mailAccounts.data?.length ?? 0) > 0 && (
        <select
          className="paper-input"
          value={mailAccountId ?? ''}
          onChange={(e) => pickMail(e.target.value)}
          aria-label={t('calFromMail')}
        >
          <option value="">{t('calFromMail')}</option>
          {mailAccounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountName} · {a.email}
            </option>
          ))}
        </select>
      )}
      <input
        className="paper-input"
        value={name}
        maxLength={60}
        placeholder={t('calNamePh')}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="paper-input"
        value={server}
        maxLength={500}
        placeholder={t('calServerPh')}
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setServer(e.target.value)
          setFound(null)
        }}
      />
      <input
        className="paper-input"
        value={username}
        maxLength={320}
        placeholder={t('calUserPh')}
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setUsername(e.target.value)
          setFound(null)
        }}
      />
      {canReuse && (
        <label className="flex items-center gap-2" style={{ font: '400 10px var(--mono)' }}>
          <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
          {t('calReusePassword')}
        </label>
      )}
      {!reuse && (
        <input
          className="paper-input"
          type="password"
          value={password}
          maxLength={1000}
          autoComplete="off"
          placeholder={t('calPassPh')}
          onChange={(e) => {
            setPassword(e.target.value)
            setFound(null)
          }}
        />
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-bare"
          style={BTN_GHOST}
          disabled={!ready}
          onClick={test}
        >
          {busy ? '···' : t('calTest')}
        </button>
        <button type="submit" className="btn-bare" style={BTN_PRIMARY} disabled={!ready}>
          {busy ? '···' : t('connect')}
        </button>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('calHttpsNote')}
        </span>
      </div>
      {found && (
        <div style={{ font: '400 10px/1.6 var(--mono)', color: 'var(--ink)' }}>
          {t('calFound', { n: found.calendars.length, host: host(found.serverUrl) })}
          {found.autoSchedule ? ` · ${t('calScheduling')}` : ''}
          <div style={{ color: 'var(--muted)' }}>
            {found.calendars.map((c) => c.displayName).join(' · ')}
          </div>
        </div>
      )}
      {error && (
        <div
          style={{ font: '400 12px var(--serif)', fontStyle: 'italic', color: 'var(--ac)' }}
          role="alert"
        >
          {error}
        </div>
      )}
    </form>
  )
}

function CalendarAccountCard({
  account,
  calendars
}: {
  account: CalendarAccount
  calendars: InvokeOutput<'calendar:list'>['calendars']
}): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const [pwOpen, setPwOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const failed = account.state === 'error' || account.state === 'needs-reauth'

  const refreshAll = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }

  const savePassword = (): void => {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    invoke('calendar:accounts:updatePassword', { accountId: account.id, password })
      .then(() => {
        setPwOpen(false)
        setPassword('')
        toastNow(t('toastCredUpdated'))
        refreshAll()
      })
      .catch((err) => setError(errText(err)))
      .finally(() => setBusy(false))
  }

  const test = (): void => {
    setBusy(true)
    setError(null)
    invoke('calendar:accounts:test', { accountId: account.id })
      .then((r) => toastNow(t('calTestOk', { n: r.calendarCount })))
      .catch((err) => setError(errText(err)))
      .finally(() => setBusy(false))
  }

  const remove = (): void => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 5000)
      return
    }
    void invoke('calendar:accounts:remove', { accountId: account.id })
      .then(refreshAll)
      .catch((err) => setError(errText(err)))
  }

  const stateLabel =
    account.state === 'needs-reauth'
      ? t('syncNeedsReauth')
      : account.state === 'error'
        ? t('syncFailed')
        : account.state === 'syncing' || account.state === 'connecting'
          ? t('calSyncing')
          : account.lastSync
            ? t('calSynced', {
                time: hhmm(account.lastSync)
              })
            : ''

  return (
    <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 10, marginTop: 10 }}>
      <div className="flex items-baseline justify-between gap-2">
        <div style={{ font: '500 12px var(--serif)', color: 'var(--ink)' }}>
          {account.name}
          <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)', marginLeft: 8 }}>
            {account.username} · {host(account.serverUrl)}
          </span>
        </div>
        <span
          style={{
            font: '500 9px var(--mono)',
            color: failed ? 'var(--ac)' : 'var(--muted)',
            letterSpacing: '.5px'
          }}
        >
          {stateLabel}
          {account.pendingOps > 0 ? ` · ${t('calPending', { n: account.pendingOps })}` : ''}
          {account.deadOps > 0 ? ` · ${t('calDead', { n: account.deadOps })}` : ''}
        </span>
      </div>
      {failed && account.lastError && (
        <div
          style={{
            font: '400 12px var(--serif)',
            fontStyle: 'italic',
            color: 'var(--ac)',
            marginTop: 4
          }}
        >
          {account.lastError}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        {calendars.map((c) => (
          <div key={c.id} className="flex items-center gap-2" style={{ padding: '2px 0' }}>
            <button
              type="button"
              className="btn-bare flex items-center gap-1.5"
              aria-pressed={c.visible}
              aria-label={`${c.displayName}: ${c.visible ? t('calVisible') : t('calHidden')}`}
              onClick={() =>
                void invoke('calendar:setVisible', { calendarId: c.id, visible: !c.visible }).then(
                  refreshAll
                )
              }
            >
              <span
                className="toggle-track"
                style={{ background: c.visible ? 'var(--ink)' : 'transparent' }}
              >
                <span
                  className="toggle-dot"
                  style={{
                    background: c.visible ? '#F4F1EA' : 'var(--ink)',
                    marginLeft: c.visible ? 12 : 0
                  }}
                />
              </span>
            </button>
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: c.color ?? 'var(--faint)',
                flex: 'none'
              }}
            />
            <span style={{ font: '400 11px var(--mono)', color: 'var(--ink)' }}>
              {c.displayName}
            </span>
            {c.readOnly && (
              <span style={{ font: '500 8.5px var(--mono)', color: 'var(--faint)' }}>
                {t('calReadOnly')}
              </span>
            )}
          </div>
        ))}
      </div>

      <AddressBooksPanel accountId={account.id} />

      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 8 }}>
        {pwOpen ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              savePassword()
            }}
          >
            <input
              type="password"
              autoFocus
              autoComplete="off"
              maxLength={1000}
              value={password}
              placeholder={t('credNewPassword')}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setPwOpen(false)
                  setPassword('')
                  setError(null)
                }
              }}
              className="paper-input"
              style={{ padding: '3px 8px', font: '500 10px var(--mono)' }}
            />
            <button
              type="submit"
              className="btn-bare"
              style={BTN_GHOST}
              disabled={busy || !password}
            >
              {busy ? t('credChecking') : t('credSave')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="btn-bare"
            style={{
              ...BTN_GHOST,
              ...(failed ? { border: '1px solid var(--ink)', color: 'var(--ink)' } : {})
            }}
            onClick={() => setPwOpen(true)}
          >
            {t('credReenter')}
          </button>
        )}
        <button
          type="button"
          className="btn-bare"
          style={BTN_GHOST}
          onClick={() => void invoke('calendar:refresh', { accountId: account.id }).catch(() => {})}
        >
          {t('calRefresh')}
        </button>
        <button type="button" className="btn-bare" style={BTN_GHOST} disabled={busy} onClick={test}>
          {t('calTest')}
        </button>
        <button
          type="button"
          className="btn-bare"
          style={{ ...BTN_GHOST, ...(armed ? { color: 'var(--ac)' } : {}) }}
          onClick={remove}
          onBlur={() => setArmed(false)}
        >
          {armed ? t('calRemoveConfirm') : t('calRemove')}
        </button>
      </div>
      {error && (
        <div
          style={{
            font: '400 12px var(--serif)',
            fontStyle: 'italic',
            color: 'var(--ac)',
            marginTop: 4
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  )
}
