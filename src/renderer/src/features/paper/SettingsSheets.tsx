import { useEffect, useMemo, useRef, useState } from 'react'
import { DraftCalendarToggle } from '@renderer/features/settings/DraftCalendarToggle'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useAccounts } from '@renderer/queries/accounts'
import { CalendarAccountsSection } from '@renderer/features/settings/CalendarAccountsSection'
import { TasksSyncSection } from '@renderer/features/settings/TasksSyncSection'
import {
  useOrKeyStatus,
  useProfileModels,
  useProfiles,
  useTaskAssignments,
  type AiTaskName
} from '@renderer/queries/intel'
import {
  LocalOnlyCard,
  OnDemandCard,
  ProfileModelPicker,
  ProvidersCard,
  TaskProviderPicker,
  DecisionCard
} from '@renderer/features/settings/AiProvidersSection'
import { usePaper } from '@renderer/stores/paper'
import { rowTime, useI18n, useT } from '@renderer/lib/i18n'
import { useStyleMeta, useStyleProfile } from '@renderer/features/paper/useVoiceTag'
import {
  cleanIpcError,
  confirmAfter,
  DISCONNECT_CONFIRM_WINDOW_MS,
  freshnessOf,
  syncErrorLine,
  type ConfirmEvent
} from '@renderer/features/paper/account-states'
import { contrastOn, PASTEL_COLORS, type AccountSummary } from '@shared/types'
import { RulesSection } from '@renderer/features/settings/RulesSection'
import { OwlGlyph } from '@renderer/components/paper/OwlGlyph'

function SheetShell({
  title,
  sub,
  children
}: {
  title: string
  sub: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="sheet-card min-w-0 flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div style={{ font: '500 21px var(--serif)' }}>{title}</div>
      <div className="mmeta" style={{ marginTop: 5, letterSpacing: '.5px' }}>
        {sub}
      </div>
      {children}
    </div>
  )
}

function glyphStyle(color: string): React.CSSProperties {
  return {
    width: 15,
    height: 15,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    font: '600 8px var(--mono)',
    background: color,
    color: contrastOn(color),
    border: '1px solid color-mix(in oklab, ' + color + ' 60%, var(--ink))'
  }
}

const PROVIDER_GLYPH: Record<string, string> = {
  gmail: 'G',
  microsoft: 'M',
  imap: '@',
  proton: 'P'
}

export function AccountsSheet(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const accounts = useAccounts()
  const { toastNow } = usePaper()
  const [addForm, setAddForm] = useState<'gmail' | 'microsoft' | 'imap' | null>(null)
  const [accountName, setAccountName] = useState('')
  const [addr, setAddr] = useState('')
  const [host, setHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [oauthWaiting, setOauthWaiting] = useState<'microsoft' | 'gmail' | null>(null)
  // Ein per CANCEL abgebrochener Login verwirft sein invoke — dieser Marker
  // unterscheidet den stillen Abbruch von echten Fehlern (Design 3b).
  const oauthCanceled = useRef(false)
  // '' = Standard (90 Tage Liste / 183 Tage Suche), '0' = alles, sonst Tage
  const [syncDays, setSyncDays] = useState('')
  const parsedSyncDays = (): number | undefined => (syncDays === '' ? undefined : Number(syncDays))

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }

  // Gmail und Microsoft melden sich im System-Browser an — kein Passwort in der App
  const addOauth = (provider: 'microsoft' | 'gmail'): void => {
    if (!accountName.trim()) {
      toastNow(t('toastAccountNameRequired'))
      return
    }
    oauthCanceled.current = false
    setOauthWaiting(provider)
    const channel = provider === 'microsoft' ? 'accounts:addMicrosoft' : 'accounts:addGoogle'
    void invoke(channel, { accountName: accountName.trim(), syncDays: parsedSyncDays() })
      .then(({ email }) => {
        toastNow(t('toastConnected', { addr: email }))
        setAddForm(null)
        setAccountName('')
        refresh()
      })
      .catch((err) => {
        // Selbst abgebrochen: die verschwundene Wartezeile ist Feedback genug
        if (oauthCanceled.current) return
        toastNow(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setOauthWaiting(null))
  }

  /** CANCEL beendet den OAuth-Roundtrip wirklich — Loopback-Server inklusive. */
  const cancelOauth = (): void => {
    if (!oauthWaiting) return
    oauthCanceled.current = true
    void invoke('accounts:cancelOAuth', { provider: oauthWaiting }).catch(() => {})
  }

  const connectImapish = (provider: 'gmail' | 'imap'): void => {
    if (!accountName.trim()) {
      toastNow(t('toastAccountNameRequired'))
      return
    }
    if (!addr.includes('@') || !pass || (provider === 'imap' && !host)) {
      toastNow(t('toastImapFields'))
      return
    }
    setBusy(true)
    void invoke('accounts:add', {
      email: addr.trim(),
      accountName: accountName.trim(),
      password: pass,
      provider,
      syncDays: parsedSyncDays(),
      ...(provider === 'imap'
        ? {
            imapHost: host.trim(),
            imapPort: Number(imapPort) || 993,
            // Leer = wie bisher aus dem IMAP-Host abgeleitet (imap. → smtp.)
            smtpHost: smtpHost.trim() || host.trim().replace(/^imap\./, 'smtp.'),
            smtpPort: Number(smtpPort) || 587
          }
        : {})
    })
      .then(() => {
        toastNow(t('toastConnected', { addr: addr.trim() }))
        setAddForm(null)
        setAccountName('')
        setAddr('')
        setHost('')
        setImapPort('993')
        setSmtpHost('')
        setSmtpPort('587')
        setPass('')
        refresh()
      })
      .catch((err) => toastNow(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  const remove = (a: AccountSummary): void => {
    void invoke('accounts:remove', { accountId: a.id }).then(() => {
      toastNow(t('toastDisconnected', { addr: a.email }))
      refresh()
    })
  }

  return (
    <SheetShell title={t('connectedAddresses')} sub={t('accountsSub')}>
      <div className="flex flex-col gap-2" style={{ marginTop: 16 }}>
        {(accounts.data ?? []).map((a) => (
          <AccountCard key={a.id} account={a} onRemove={() => remove(a)} />
        ))}
      </div>
      <div className="double-rule" style={{ marginTop: 20 }} />
      <div className="mlabel" style={{ color: 'var(--ac)', marginTop: 16 }}>
        {t('addAddress')}
      </div>
      <div className="flex gap-2" style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setAddForm(addForm === 'gmail' ? null : 'gmail')}
          disabled={oauthWaiting !== null}
          className="btn-bare"
          aria-expanded={addForm === 'gmail'}
          style={{
            font: '500 10px var(--mono)',
            color: 'var(--paper)',
            background: 'var(--ink)',
            padding: '6px 12px',
            opacity: oauthWaiting ? 0.55 : 1
          }}
        >
          G GOOGLE
        </button>
        <button
          type="button"
          onClick={() => setAddForm(addForm === 'microsoft' ? null : 'microsoft')}
          disabled={oauthWaiting !== null}
          className="btn-bare"
          aria-expanded={addForm === 'microsoft'}
          style={{
            font: '500 10px var(--mono)',
            color: 'var(--paper)',
            background: 'var(--ink)',
            padding: '6px 12px',
            opacity: oauthWaiting ? 0.55 : 1
          }}
        >
          M MICROSOFT
        </button>
        <button
          type="button"
          onClick={() => setAddForm(addForm === 'imap' ? null : 'imap')}
          disabled={oauthWaiting !== null}
          className="btn-bare"
          aria-expanded={addForm === 'imap'}
          style={{
            font: '500 10px var(--mono)',
            color: 'var(--ink)',
            border: '1px solid var(--ink)',
            padding: '5px 12px',
            opacity: oauthWaiting ? 0.55 : 1
          }}
        >
          @ IMAP
        </button>
      </div>
      {oauthWaiting && (
        // Warten auf den Browser-Login (Design 3b) — statt eines nackten „···"
        <div className="tint-card" style={{ padding: '11px 13px', marginTop: 12 }}>
          <div className="flex items-center gap-3">
            <span
              className="flex flex-none items-center justify-center"
              style={{
                width: 15,
                height: 15,
                boxSizing: 'border-box',
                font: '600 8px var(--mono)',
                border: '1px solid var(--ink)',
                background: 'var(--sheet)'
              }}
            >
              {oauthWaiting === 'gmail' ? 'G' : 'M'}
            </span>
            <div className="min-w-0 flex-1">
              <div style={{ font: '500 13px var(--serif)' }}>
                {accountName.trim() || (oauthWaiting === 'gmail' ? 'Google Mail' : 'Microsoft')}
              </div>
              <div style={{ font: '400 9.5px var(--mono)', marginTop: 3 }}>
                <span style={{ color: 'var(--ac)' }}>{t('waitingForBrowser')}</span>{' '}
                <span style={{ color: 'var(--muted)' }}>{t('waitingForBrowserHint')}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={cancelOauth}
              className="ghost-btn flex-none"
              style={{ padding: '4px 10px' }}
            >
              {t('cancelCaps')}
            </button>
          </div>
        </div>
      )}
      {addForm && !oauthWaiting && (
        <div className="ink-card flex flex-col gap-2" style={{ padding: 14, marginTop: 12 }}>
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder={t('accountNamePh')}
            className="paper-input"
            maxLength={40}
            autoFocus
          />
          <select
            value={syncDays}
            onChange={(e) => setSyncDays(e.target.value)}
            className="paper-input"
            aria-label={t('syncRangeLabel')}
          >
            <option value="">{t('syncRangeStd')}</option>
            <option value="30">{t('syncRange30')}</option>
            <option value="90">{t('syncRange90')}</option>
            <option value="365">{t('syncRange365')}</option>
            <option value="0">{t('syncRangeAll')}</option>
          </select>
          {addForm === 'imap' && (
            <>
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder={t('imapAddrPh')}
                className="paper-input"
              />
              <div className="flex gap-2">
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={t('imapHostPh')}
                  className="paper-input flex-1"
                />
                <input
                  value={imapPort}
                  onChange={(e) => setImapPort(e.target.value)}
                  placeholder="993"
                  inputMode="numeric"
                  className="paper-input"
                  style={{ width: 70 }}
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder={t('smtpHostOptionalPh')}
                  className="paper-input flex-1"
                />
                <input
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                  inputMode="numeric"
                  className="paper-input"
                  style={{ width: 70 }}
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  type="password"
                  placeholder={t('imapPassPh')}
                  className="paper-input flex-1"
                />
              </div>
            </>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (addForm === 'imap' ? connectImapish('imap') : addOauth(addForm))}
              disabled={busy}
              className="btn-bare"
              style={{
                font: '500 10px var(--mono)',
                color: 'var(--paper)',
                background: 'var(--ink)',
                padding: '5px 12px'
              }}
            >
              {busy ? '···' : t('connect')}
            </button>
            <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
              {addForm === 'microsoft'
                ? t('microsoftBrowserNote')
                : addForm === 'gmail'
                  ? t('googleBrowserNote')
                  : t('imapNote')}
            </span>
          </div>
        </div>
      )}
      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--faint)',
          marginTop: 14
        }}
      >
        {t('accountsFootnote')}
      </div>
      <div className="double-rule" style={{ marginTop: 18 }} />
      <CalendarAccountsSection />
      <TasksSyncSection />
      <div className="double-rule" style={{ marginTop: 18 }} />
      <RemoteImagesPrivacy />
    </SheetShell>
  )
}

/**
 * Eine Konto-Karte im Konten-Sheet. Im Fehlerzustand steht der GESPEICHERTE
 * Fehlertext inline unter der Adresse („IMAP: connection refused (993) —
 * seit 11:42") — ein Accent-Wort allein ist keine Diagnose (Design 3b).
 */
function AccountCard({
  account: a,
  onRemove
}: {
  account: AccountSummary
  onRemove: () => void
}): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const failed = a.syncState === 'error' || a.syncState === 'needs-reauth'
  const errLine = failed
    ? (syncErrorLine(
        a.lastError,
        a.errorSince ? t('sinceTime', { time: rowTime(lang, a.errorSince) }) : null
      ) ?? t(a.syncState === 'needs-reauth' ? 'syncNeedsReauthHint' : 'errorState'))
    : null
  return (
    <div className="tint-card" style={{ padding: '11px 13px' }}>
      <div className="flex items-center gap-3">
        <span style={glyphStyle(a.color)}>{PROVIDER_GLYPH[a.provider] ?? '@'}</span>
        <div className="min-w-0 flex-1">
          <AccountNameEditor account={a} />
          <div
            className="truncate"
            style={{ font: '400 9px var(--mono)', color: 'var(--muted)', marginTop: 2 }}
          >
            {a.email}
          </div>
          <div
            style={{
              font: '400 11.5px var(--serif)',
              fontStyle: 'italic',
              color: 'var(--secondary)',
              marginTop: 2
            }}
          >
            {a.provider} · {t('mailCount', { n: a.messageCount.toLocaleString('de-DE') })}
          </div>
          {errLine && (
            <div
              style={{
                font: '400 12px var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                marginTop: 3
              }}
            >
              {errLine}
            </div>
          )}
        </div>
        <AccountRowActions account={a} failed={failed} onRemove={onRemove} />
      </div>
      <ColorRow account={a} />
      <SyncRangeRow account={a} />
      <CredentialsRow account={a} failed={failed} />
    </div>
  )
}

/**
 * Zugangsdaten erneuern: bei Passwort-/Bridge-Konten ein Inline-Feld (der
 * Server-Login wird vor dem Speichern geprüft), bei Google/Microsoft der
 * Browser-Login erneut. Im Fehlerzustand hervorgehoben, sonst dezent.
 */
function CredentialsRow({
  account,
  failed
}: {
  account: AccountSummary
  failed: boolean
}): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const oauth = account.credentialType === 'oauth-google' || account.credentialType === 'oauth-ms'
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = (toast: string): void => {
    setBusy(false)
    setOpen(false)
    setPassword('')
    toastNow(toast)
    void queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }
  const fail = (err: unknown): void => {
    setBusy(false)
    setError(err instanceof Error ? err.message : String(err))
  }

  const savePassword = (): void => {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    invoke('accounts:updatePassword', { accountId: account.id, password })
      .then(() => done(t('toastCredUpdated')))
      .catch(fail)
  }
  const signInAgain = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    invoke('accounts:reauthorize', { accountId: account.id })
      .then(() => done(t('toastReauthorized')))
      .catch(fail)
  }

  const buttonStyle: React.CSSProperties = {
    font: '500 9px var(--mono)',
    letterSpacing: '.5px',
    border: failed ? '1px solid var(--ink)' : '1px solid var(--rule, var(--faint))',
    color: failed ? 'var(--ink)' : 'var(--muted)',
    padding: '4px 10px'
  }

  return (
    <div style={{ marginTop: 8 }}>
      {oauth ? (
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            className="btn-bare"
            style={buttonStyle}
            disabled={busy}
            onClick={signInAgain}
          >
            {busy ? t('waitingForBrowser') : t('credSignInAgain')}
          </button>
          {busy && (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                void invoke('accounts:cancelOAuth', {
                  provider: account.credentialType === 'oauth-ms' ? 'microsoft' : 'gmail'
                }).catch(() => {})
              }}
            >
              {t('credCancel')}
            </button>
          )}
        </div>
      ) : open ? (
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
                setOpen(false)
                setPassword('')
                setError(null)
              }
            }}
            className="paper-input"
            style={{ flex: 1, padding: '3px 8px', font: '500 10px var(--mono)' }}
          />
          <button
            type="submit"
            className="btn-bare"
            style={buttonStyle}
            disabled={busy || !password}
          >
            {busy ? t('credChecking') : t('credSave')}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn-bare"
          style={buttonStyle}
          onClick={() => setOpen(true)}
        >
          {t('credReenter')}
        </button>
      )}
      {error && (
        <div
          style={{
            font: '400 12px var(--serif)',
            fontStyle: 'italic',
            color: 'var(--ac)',
            marginTop: 4
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

/**
 * Rechte Seite einer Konto-Karte: Status/RETRY plus Trennen mit
 * Zweitklick-Bestätigung — der erste Klick spannt YES, DISCONNECT / KEEP,
 * Esc, Blur oder 5 s ohne Entscheidung entspannen wieder (Design 3b).
 */
function AccountRowActions({
  account,
  failed,
  onRemove
}: {
  account: AccountSummary
  failed: boolean
  onRemove: () => void
}): React.JSX.Element {
  const t = useT()
  const [armed, setArmed] = useState(false)
  const yesRef = useRef<HTMLButtonElement | null>(null)
  const disarm = (event: ConfirmEvent): void => setArmed(confirmAfter(event))

  // 5-s-Fenster: ohne Entscheidung fällt die Bestätigung von selbst zurück
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(confirmAfter('timeout')), DISCONNECT_CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [armed])

  // Fokus auf YES — damit Esc und Blur natürlich greifen
  useEffect(() => {
    if (armed) yesRef.current?.focus()
  }, [armed])

  const retry = (): void => {
    // RETRY weckt genau dieses Konto — refreshNow bricht auch den Backoff ab
    void invoke('sync:trigger', { accountId: account.id }).catch(() => {})
  }

  if (armed) {
    return (
      <div
        className="flex flex-none items-center gap-3"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            disarm('esc')
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) disarm('blur')
        }}
      >
        <span
          style={{ font: '400 12px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }}
        >
          {t('disconnectHint')}
        </span>
        <button
          ref={yesRef}
          type="button"
          onClick={() => {
            disarm('confirm')
            onRemove()
          }}
          className="btn-bare"
          style={{
            font: '500 9px var(--mono)',
            letterSpacing: '.5px',
            border: '1px solid var(--ac)',
            color: 'var(--ac)',
            padding: '5px 10px'
          }}
        >
          {t('disconnectYes')}
        </button>
        <button
          type="button"
          onClick={() => disarm('keep')}
          className="btn-bare"
          style={{
            font: '500 9px var(--mono)',
            letterSpacing: '.5px',
            color: 'var(--paper)',
            background: 'var(--ink)',
            padding: '6px 12px'
          }}
        >
          {t('disconnectKeep')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-none items-center gap-3">
      {failed ? (
        <>
          <span style={{ font: '500 9px var(--mono)', color: 'var(--ac)' }}>
            {t(account.syncState === 'needs-reauth' ? 'syncNeedsReauth' : 'syncFailed')}
          </span>
          <button
            type="button"
            onClick={retry}
            className="btn-bare"
            style={{
              font: '500 9px var(--mono)',
              letterSpacing: '.5px',
              border: '1px solid var(--ink)',
              color: 'var(--ink)',
              padding: '4px 10px'
            }}
          >
            {t('obRetry')}
          </button>
        </>
      ) : (
        <span
          style={{
            font: '500 9px var(--mono)',
            color:
              account.syncState === 'syncing' || account.syncState === 'connecting'
                ? 'var(--ac)'
                : 'var(--ink)'
          }}
        >
          {account.syncState === 'syncing' || account.syncState === 'connecting'
            ? t('indexing')
            : t('synced')}
        </span>
      )}
      <button
        type="button"
        onClick={() => setArmed(confirmAfter('arm'))}
        className="ghost-btn"
        style={{ color: 'var(--faint)' }}
      >
        {t('disconnect')}
      </button>
    </div>
  )
}

/** Sync-Zeitraum eines bestehenden Kontos ändern — der Syncer startet danach neu. */
function SyncRangeRow({ account }: { account: AccountSummary }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const value = account.syncDays === null ? '' : String(account.syncDays)
  const known = ['', '30', '90', '365', '0'].includes(value)

  const change = (raw: string): void => {
    const syncDays = raw === '' ? null : Number(raw)
    void invoke('accounts:update', { accountId: account.id, syncDays })
      .then(() => {
        toastNow(t('toastSyncRange'))
        void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      })
      .catch((err) => toastNow(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="flex items-baseline gap-2" style={{ marginTop: 8 }}>
      <span className="mlabel flex-none" style={{ color: 'var(--muted)' }}>
        {t('syncRangeLabel')}
      </span>
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        className="paper-input"
        style={{ width: 'auto', padding: '3px 8px', font: '500 10px var(--mono)' }}
      >
        {!known && <option value={value}>{t('syncRangeDays', { n: value })}</option>}
        <option value="">{t('syncRangeStd')}</option>
        <option value="30">{t('syncRange30')}</option>
        <option value="90">{t('syncRange90')}</option>
        <option value="365">{t('syncRange365')}</option>
        <option value="0">{t('syncRangeAll')}</option>
      </select>
    </div>
  )
}

function AccountNameEditor({ account }: { account: AccountSummary }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const initialName = account.accountName ?? ''
  const [value, setValue] = useState(initialName)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const latestValue = useRef(initialName)
  const savedValue = useRef(initialName)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)

  const persist = (rawName: string): void => {
    const accountName = rawName.trim()
    if (!accountName || accountName === savedValue.current) return
    if (mounted.current) setSaveState('saving')
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const result = await invoke('accounts:update', { accountId: account.id, accountName })
        const confirmedName = result.accountName ?? accountName
        savedValue.current = confirmedName
        queryClient.setQueryData<{ accounts: AccountSummary[] }>(['accounts'], (current) =>
          current
            ? {
                accounts: current.accounts.map((item) =>
                  item.id === account.id ? { ...item, accountName: confirmedName } : item
                )
              }
            : current
        )
        if (mounted.current && latestValue.current.trim() === accountName) {
          setSaveState('saved')
        }
      } catch (error) {
        if (mounted.current) {
          setValue(savedValue.current)
          latestValue.current = savedValue.current
          setSaveState('idle')
          toastNow(error instanceof Error ? error.message : String(error))
        }
      }
    })
  }

  const scheduleSave = (nextValue: string): void => {
    latestValue.current = nextValue
    setValue(nextValue)
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (!nextValue.trim()) return
    saveTimer.current = setTimeout(() => persist(latestValue.current), 220)
  }

  const flushSave = (): void => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const accountName = latestValue.current.trim()
    if (!accountName) {
      setValue(savedValue.current)
      latestValue.current = savedValue.current
      setSaveState('idle')
      toastNow(t('toastAccountNameRequired'))
      return
    }
    persist(accountName)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
      const accountName = latestValue.current.trim()
      if (accountName && accountName !== savedValue.current) {
        void saveQueue.current.then(() =>
          invoke('accounts:update', { accountId: account.id, accountName }).then(() => undefined)
        )
      }
    }
  }, [account.id])

  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <input
        value={value}
        onChange={(event) => scheduleSave(event.target.value)}
        onBlur={flushSave}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            if (saveTimer.current) clearTimeout(saveTimer.current)
            setValue(savedValue.current)
            latestValue.current = savedValue.current
            setSaveState('idle')
            event.currentTarget.blur()
          }
          event.stopPropagation()
        }}
        aria-label={t('accountName')}
        title={t('accountNameEditHint')}
        maxLength={40}
        className="min-w-0 flex-1"
        style={{
          border: 'none',
          borderBottom: '1px solid var(--hairline-light)',
          outline: 'none',
          background: 'transparent',
          font: '500 13px var(--serif)',
          color: 'var(--ink)',
          padding: '0 0 2px'
        }}
      />
      {saveState !== 'idle' && (
        <span
          className="flex-none"
          style={{
            font: '400 8px var(--mono)',
            color: saveState === 'saved' ? 'var(--ac)' : 'var(--faint)'
          }}
        >
          {saveState === 'saved' ? t('accountNameSaved') : t('accountNameSaving')}
        </span>
      )}
    </div>
  )
}

/** Pastell-Farbwahl pro Konto — färbt die Badges in Liste und Glyphen. */
function ColorRow({ account }: { account: AccountSummary }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const pick = (color: string): void => {
    void invoke('accounts:update', { accountId: account.id, color }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
    })
  }
  return (
    <div className="flex items-center gap-1.5" style={{ marginTop: 9, paddingLeft: 27 }}>
      <span
        style={{
          font: '500 8px var(--mono)',
          letterSpacing: 1,
          color: 'var(--faint)',
          marginRight: 4
        }}
      >
        {t('accountColor')}
      </span>
      {PASTEL_COLORS.map((c) => {
        const active = account.color.toLowerCase() === c.toLowerCase()
        return (
          <span
            key={c}
            onClick={() => pick(c)}
            title={c}
            className="cursor-pointer"
            style={{
              width: 14,
              height: 14,
              background: c,
              boxSizing: 'border-box',
              border: active ? '2px solid var(--ink)' : '1px solid var(--hairline)'
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Privacy-Einstellung (Design 3b): Remote-Bilder sind standardmäßig BLOCKIERT,
 * bis der Nutzer sie erlaubt — als Schutz formuliert, Default entspricht dem
 * Privacy-Versprechen. Nur ein explizites '1' lädt automatisch; gespeicherte
 * Entscheidungen von Bestandsnutzern bleiben unangetastet.
 */
function RemoteImagesPrivacy(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const [blocked, setBlocked] = useState(true)
  useEffect(() => {
    void invoke('settings:get', { key: 'mail.remoteImagesDefault' }).then((r) =>
      setBlocked(r.value !== '1')
    )
  }, [])
  const toggle = (): void => {
    const next = !blocked
    setBlocked(next)
    void invoke('settings:set', { key: 'mail.remoteImagesDefault', value: next ? '0' : '1' }).then(
      () => {
        void queryClient.invalidateQueries({ queryKey: ['thread'] })
      }
    )
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div className="mlabel" style={{ color: 'var(--muted)' }}>
        {t('privacyHead')}
      </div>
      <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={blocked}
          className="btn-bare flex items-center gap-1.5"
        >
          <span
            className="toggle-track"
            style={{ background: blocked ? 'var(--ink)' : 'transparent' }}
          >
            <span
              className="toggle-dot"
              style={{
                background: blocked ? '#F4F1EA' : 'var(--ink)',
                marginLeft: blocked ? 12 : 0
              }}
            />
          </span>
          <span style={{ font: '400 10px var(--mono)', color: 'var(--ink)' }}>
            {t('imagesBlockToggle')}
          </span>
        </button>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('imagesBlockNote')}
        </span>
      </div>
    </div>
  )
}

function VoiceCard({ account }: { account: AccountSummary }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const profile = useStyleProfile(account.id)
  const meta = useStyleMeta(account.id)
  const { toastNow } = usePaper()
  const [training, setTraining] = useState(false)
  const [pct, setPct] = useState(0)
  // Ehrlich gescheitertes Nachlernen (Design 3e): echter Fehlertext, kein 100 %
  const [failure, setFailure] = useState<string | null>(null)
  const [learn, setLearn] = useState(true)
  const [rules, setRules] = useState('')
  const [rulesFlash, setRulesFlash] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  // Anweisungen: letzter Stand + zuletzt gespeicherter Stand — für Blur-Save
  // UND den Unmount-Flush (keine verlorenen Änderungen, Design 3e)
  const latestRules = useRef('')
  const savedRules = useRef('')

  useEffect(() => {
    void invoke('settings:get', { key: `ai.style.learn.${account.id}` }).then((r) =>
      setLearn(r.value !== '0')
    )
    void invoke('settings:get', { key: `ai.styleInstructions.${account.id}` }).then((r) => {
      const value = r.value ?? ''
      latestRules.current = value
      savedRules.current = value.trim()
      setRules(value)
    })
  }, [account.id])

  const saveRules = (): void => {
    const value = latestRules.current.trim()
    if (value === savedRules.current) return
    void invoke('settings:set', { key: `ai.styleInstructions.${account.id}`, value }).then(() => {
      savedRules.current = value
      setRulesFlash(true)
      setTimeout(() => setRulesFlash(false), 1800)
    })
  }

  // Unmount-Flush: Sheet-Wechsel mitten im Tippen verliert nichts (Design 3e)
  useEffect(() => {
    return () => {
      const value = latestRules.current.trim()
      if (value !== savedRules.current) {
        void invoke('settings:set', { key: `ai.styleInstructions.${account.id}`, value })
      }
    }
  }, [account.id])

  useEffect(() => {
    if (!training) return
    const iv = setInterval(() => setPct((p) => Math.min(96, p + 4)), 120)
    return () => clearInterval(iv)
  }, [training])

  const retrain = (): void => {
    if (training) return
    setTraining(true)
    setFailure(null)
    setPct(0)
    void invoke('ai:refreshStyle', { accountId: account.id })
      .then(async ({ ok }) => {
        if (ok) {
          setPct(100)
          toastNow(t('toastVoiceRefreshed'))
          void queryClient.invalidateQueries({ queryKey: ['styleProfile', account.id] })
          void queryClient.invalidateQueries({ queryKey: ['styleMeta', account.id] })
          setTimeout(() => {
            setTraining(false)
            setPct(0)
          }, 300)
          return
        }
        // ok:false heißt: kein Schlüssel oder kein Korpus — Balken einfrieren,
        // Grund inline sagen, RETRY anbieten. Nie still 100 % (Design 3e / M53).
        // Der Grund wird LIVE geprüft, nicht aus dem Query-Cache geraten.
        const { exists } = await invoke('secrets:exists', { key: 'openrouter.apiKey' })
        setFailure(exists ? t('voiceNoSent') : t('owlAskDisabled'))
        setTraining(false)
      })
      .catch((err) => {
        setFailure(cleanIpcError(err instanceof Error ? err.message : String(err)))
        setTraining(false)
      })
  }

  const runPreview = (): void => {
    if (previewing) return
    setPreviewing(true)
    setPreview(null)
    void invoke('ai:stylePreview', { accountId: account.id })
      .then(({ text }) => setPreview(text))
      .catch((err) => toastNow(err instanceof Error ? err.message : String(err)))
      .finally(() => setPreviewing(false))
  }

  const toggleLearn = (): void => {
    const next = !learn
    setLearn(next)
    void invoke('settings:set', { key: `ai.style.learn.${account.id}`, value: next ? '1' : '0' })
  }

  const traits = [
    ...(profile?.style_notes ?? []),
    profile?.formality ?? null,
    (profile?.languages ?? []).join('/')
  ].filter((x): x is string => !!x && x.length > 0)
  const sample = profile?.closings?.[0] ?? profile?.greetings?.[0] ?? null

  return (
    <div className="ink-card" style={{ padding: '13px 15px' }}>
      <div className="flex items-baseline gap-2">
        <span style={{ font: '500 12px var(--serif)' }}>{account.accountName}</span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>{account.email}</span>
        <span className="ml-auto" style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>
          {meta
            ? `${t('replies', { n: meta.replies.toLocaleString('de-DE') })} · ${freshnessLabel(t, meta.updatedAt)}`
            : t('mailCount', { n: account.messageCount.toLocaleString('de-DE') })}
        </span>
      </div>
      <div className="flex flex-wrap gap-[5px]" style={{ marginTop: 9 }}>
        {traits.length > 0 ? (
          traits.slice(0, 5).map((tr, i) => (
            <span
              key={i}
              style={{
                font: '400 9px var(--mono)',
                color: 'var(--secondary)',
                border: '1px solid var(--hairline)',
                padding: '1px 6px'
              }}
            >
              {tr}
            </span>
          ))
        ) : (
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('noProfileYet')}
          </span>
        )}
      </div>
      {sample && (
        <div
          style={{
            font: '400 12.5px var(--serif)',
            fontStyle: 'italic',
            color: 'var(--secondary)',
            marginTop: 9
          }}
        >
          “{sample}”
        </div>
      )}
      {(training || failure !== null) && (
        // Gescheitert friert der Balken ein — das Intervall stoppt mit training
        <div style={{ height: 4, background: 'var(--hairline-light)', marginTop: 11 }}>
          <div
            style={{
              height: 4,
              background: 'var(--ac)',
              width: `${pct}%`,
              transition: 'width .12s linear'
            }}
          />
        </div>
      )}
      {failure !== null && (
        <div className="flex items-center gap-2.5" style={{ marginTop: 8 }}>
          <span style={{ font: '500 9px var(--mono)', color: 'var(--ac)' }}>
            {t('obFailed')} {failure}
          </span>
          <button
            type="button"
            onClick={retrain}
            className="btn-bare ml-auto flex-none"
            style={{
              font: '500 9px var(--mono)',
              letterSpacing: '.5px',
              border: '1px solid var(--ink)',
              color: 'var(--ink)',
              padding: '4px 10px'
            }}
          >
            {t('obRetry')}
          </button>
        </div>
      )}
      <div style={{ marginTop: 11 }}>
        <div className="mlabel" style={{ fontSize: 8, color: 'var(--muted)' }}>
          {t('voiceRulesLabel')}
        </div>
        <textarea
          value={rules}
          onChange={(e) => {
            latestRules.current = e.target.value
            setRules(e.target.value)
          }}
          onBlur={saveRules}
          onKeyDown={(e) => e.stopPropagation()}
          rows={2}
          placeholder={t('voiceRulesPh')}
          className="paper-input"
          style={{ marginTop: 5, font: '400 11px var(--mono)', resize: 'vertical' }}
        />
        {rulesFlash && (
          <span style={{ font: '400 8.5px var(--mono)', color: 'var(--ac)' }}>
            {t('voiceRulesSaved')}
          </span>
        )}
      </div>
      {preview && (
        <div style={{ borderTop: '1px solid var(--hairline-light)', marginTop: 10, paddingTop: 9 }}>
          <div className="mlabel" style={{ fontSize: 8, color: 'var(--ac)' }}>
            {t('previewLabel')}
          </div>
          {preview.split('\n').map((line, i) => (
            <div
              key={i}
              style={{
                font: '400 12.5px/1.6 var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                minHeight: 6
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3" style={{ marginTop: 11 }}>
        <button
          type="button"
          onClick={toggleLearn}
          aria-pressed={learn}
          className="btn-bare flex items-center gap-1.5"
        >
          <span
            className="toggle-track"
            style={{ background: learn ? 'var(--ink)' : 'transparent' }}
          >
            <span
              className="toggle-dot"
              style={{ background: learn ? '#F4F1EA' : 'var(--ink)', marginLeft: learn ? 12 : 0 }}
            />
          </span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>
            {t('learnFromSends')}
          </span>
        </button>
        <button
          type="button"
          onClick={runPreview}
          className="ghost-btn ml-auto"
          style={{ color: 'var(--ac)', borderColor: 'var(--ac)' }}
        >
          {previewing ? t('previewRunning') : t('previewBtn')}
        </button>
        <button
          type="button"
          onClick={retrain}
          className="ghost-btn"
          style={{ color: 'var(--ink)', borderColor: 'var(--ink)' }}
        >
          {training ? t('reading') : t('retrain')}
        </button>
      </div>
    </div>
  )
}

/** Frische-Text der Voice-Card: „updated today / yesterday / {n} days ago". */
function freshnessLabel(t: ReturnType<typeof useT>, updatedAt: number): string {
  const fresh = freshnessOf(updatedAt, Date.now())
  if (fresh.kind === 'today') return t('updatedToday')
  if (fresh.kind === 'yesterday') return t('updatedYesterday')
  return t('updatedDaysAgo', { n: fresh.days })
}

export function StyleSheetView(): React.JSX.Element {
  const t = useT()
  const accounts = useAccounts()
  return (
    <SheetShell title={t('yourStyleHead')} sub={t('styleSub')}>
      <div
        style={{
          font: '400 14px/1.75 var(--serif)',
          color: 'var(--body-text)',
          marginTop: 14,
          maxWidth: 640
        }}
      >
        {t('styleIntro')}
      </div>
      <div className="flex flex-col gap-2.5" style={{ marginTop: 16, maxWidth: 640 }}>
        {(accounts.data ?? []).map((a) => (
          <VoiceCard key={a.id} account={a} />
        ))}
      </div>
      <div
        className="flex items-center gap-2.5"
        style={{
          border: '1px solid var(--hairline)',
          padding: '10px 12px',
          marginTop: 14,
          maxWidth: 640,
          boxSizing: 'border-box'
        }}
      >
        <span className="mlabel flex-none" style={{ color: 'var(--ac)' }}>
          {t('tryIt')}
        </span>
        <span
          style={{ font: '400 13px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }}
        >
          {t('tryItLine')
            .split('{v}')
            .map((part, i) => (
              <span key={i}>
                {i === 1 && <b style={{ fontStyle: 'normal' }}>v</b>}
                {part}
              </span>
            ))}
        </span>
      </div>
      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--faint)',
          marginTop: 14
        }}
      >
        {t('styleFootnote')}
      </div>
    </SheetShell>
  )
}

/**
 * Eigenes OpenRouter-Modell (M86): frei eintippen, per Beispiel-Mail testen,
 * erst nach bestandenem Test übernehmen. Die Modell-ID-Form prüft der
 * Contract; hier nur eine freundliche Vorab-Prüfung.
 */
function CustomModelRow({ onPick }: { onPick: (id: string) => void }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    latencyMs: number
    costUsd: number | null
    detail: string | null
  } | null>(null)

  const valid = /^[\w.:-]+\/[\w.:-]+$/.test(id.trim())
  const runTest = (): void => {
    if (!valid || testing) return
    setTesting(true)
    setResult(null)
    void invoke('ai:testModel', { profileId: 'openrouter', model: id.trim() })
      .then(setResult)
      .catch((err) =>
        setResult({
          ok: false,
          latencyMs: 0,
          costUsd: null,
          detail: err instanceof Error ? err.message : String(err)
        })
      )
      .finally(() => setTesting(false))
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-btn self-start"
        style={{ marginTop: 2, borderBottom: '1px solid var(--hairline)' }}
        onClick={() => setOpen(true)}
      >
        {t('customModelToggle')}
      </button>
    )
  }
  return (
    <div
      className="flex flex-col gap-2"
      style={{ border: '1px dashed var(--hairline)', padding: 10 }}
    >
      <div
        style={{
          font: '400 10.5px/1.5 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--secondary)'
        }}
      >
        {t('customModelNote')}
      </div>
      <div className="flex gap-2">
        <input
          value={id}
          onChange={(e) => {
            setId(e.target.value)
            setResult(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runTest()
            e.stopPropagation()
          }}
          placeholder={t('customModelPh')}
          className="paper-input flex-1"
        />
        <button
          type="button"
          className="btn-bare flex-none"
          onClick={runTest}
          disabled={!valid || testing}
          style={{
            font: '500 10px var(--mono)',
            padding: '6px 12px',
            ...(valid && !testing
              ? { color: 'var(--paper)', background: 'var(--ink)' }
              : { color: 'var(--faint)', border: '1px solid var(--hairline)' })
          }}
        >
          {testing ? '···' : t('customModelTest')}
        </button>
      </div>
      {result && (
        <div
          className="flex items-center gap-2.5"
          style={{
            font: '400 9.5px var(--mono)',
            color: result.ok ? 'var(--ac)' : 'var(--muted)'
          }}
        >
          <span className="min-w-0 flex-1">
            {result.ok
              ? t('customModelOk', {
                  ms: result.latencyMs.toLocaleString('de-DE'),
                  cost: result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : '?'
                })
              : `✗ ${result.detail ?? t('customModelFailed')}`}
          </span>
          {result.ok && (
            <button
              type="button"
              className="btn-bare flex-none"
              onClick={() => onPick(id.trim())}
              style={{
                font: '500 9px var(--mono)',
                color: 'var(--paper)',
                background: 'var(--ink)',
                padding: '4px 10px'
              }}
            >
              {t('customModelApply')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ModelList({
  kind,
  current,
  onPick
}: {
  kind: 'scan' | 'write' | 'stt'
  current: string
  onPick: (id: string) => void
}): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const catalog = useProfileModels('openrouter')
  const catalogModels = catalog.data?.models
  const rows = useMemo(() => {
    // Nischen-Varianten raus (Bild/Video/Realtime, Spezial-SKUs)
    const NICHE = /(image|video|realtime|tts|transcribe|search|-fast|computer-use)/
    const models =
      kind === 'stt'
        ? (catalogModels ?? []).filter((m) => m.audioIn && !/(image|video|realtime)/.test(m.id))
        : (catalogModels ?? []).filter(
            (m) =>
              !m.audioIn &&
              !/audio/.test(m.id) &&
              !NICHE.test(m.id) &&
              (kind === 'scan' || (m.promptPerM <= 25 && m.context >= 100_000))
          )
    const byProvider = new Map<string, typeof models>()
    for (const m of models) {
      const prov = m.id.split('/')[0]
      byProvider.set(prov, [...(byProvider.get(prov) ?? []), m])
    }
    let pick: typeof models = []
    if (kind === 'stt') {
      // günstigste Audio-Modelle, max 2 je Provider
      const perProv = new Map<string, number>()
      pick = [...models]
        .sort((a, b) => a.promptPerM - b.promptPerM)
        .filter((m) => {
          const prov = m.id.split('/')[0]
          const n = perProv.get(prov) ?? 0
          if (n >= 2) return false
          perProv.set(prov, n + 1)
          return true
        })
        .slice(0, 5)
    } else if (kind === 'scan') {
      // billigste pro Provider, dann global die 4 günstigsten
      for (const list of byProvider.values()) {
        pick.push([...list].sort((a, b) => a.promptPerM - b.promptPerM)[0])
      }
      pick = pick.sort((a, b) => a.promptPerM - b.promptPerM).slice(0, 4)
    } else {
      // Flaggschiff pro Provider (teuerstes), die 4 stärksten
      for (const list of byProvider.values()) {
        pick.push([...list].sort((a, b) => b.promptPerM - a.promptPerM)[0])
      }
      pick = pick.sort((a, b) => b.promptPerM - a.promptPerM).slice(0, 4)
    }
    // aktuelles Modell immer anbieten
    if (current && !pick.some((m) => m.id === current)) {
      const cur = models.find((m) => m.id === current)
      pick = [
        ...(cur
          ? [cur]
          : [{ id: current, promptPerM: 0, completionPerM: 0, context: 0, audioIn: false }]),
        ...pick
      ].slice(0, 5)
    }
    return pick
  }, [catalogModels, kind, current])

  return (
    <div className="flex flex-col gap-1.5" style={{ marginTop: 10 }}>
      {rows.map((m) => {
        const seld = m.id === current
        return (
          <div
            key={m.id}
            onClick={() => onPick(m.id)}
            className="flex cursor-pointer items-center gap-2.5"
            style={{
              padding: '7px 10px',
              border: `1px solid ${seld ? 'var(--ink)' : 'var(--hairline)'}`,
              background: seld ? 'var(--sheet)' : 'transparent'
            }}
          >
            <span
              className="flex flex-none items-center justify-center"
              style={{ width: 11, height: 11, border: '1.5px solid var(--ink)' }}
            >
              {seld && <span style={{ width: 5, height: 5, background: 'var(--ink)' }} />}
            </span>
            <span style={{ font: '500 11.5px var(--mono)', color: 'var(--ink)' }}>{m.id}</span>
            <span
              className="flex-1"
              style={{
                font: '400 11.5px var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)'
              }}
            >
              {m.context > 0 ? `${Math.round(m.context / 1000)}k context` : ''}
            </span>
            {m.promptPerM > 0 && (
              <span
                className="flex-none"
                style={{
                  font: '400 9px var(--mono)',
                  color: 'var(--muted)',
                  border: '1px solid var(--hairline)',
                  padding: '0 5px'
                }}
              >
                ${m.promptPerM}/M
              </span>
            )}
          </div>
        )
      })}
      {catalog.isLoading && (
        <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>…</span>
      )}
      {/* Local only: der Katalog kommt nie automatisch — nur auf Klick */}
      {catalog.data?.skipped && (
        <div className="flex items-center gap-2">
          <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>
            {t('modelListSkipped')}
          </span>
          <button
            type="button"
            className="text-btn"
            style={{ borderBottom: '1px solid var(--hairline)' }}
            onClick={() =>
              void invoke('ai:profileModels', {
                profileId: 'openrouter',
                manual: true,
                kind: 'chat'
              }).then((data) =>
                queryClient.setQueryData(['ai', 'profileModels', 'openrouter'], data)
              )
            }
          >
            {t('modelListLoad')}
          </button>
        </div>
      )}
      {kind !== 'stt' && <CustomModelRow onPick={onPick} />}
    </div>
  )
}

/** ZDR-Schalter (M86): Anfragen nur an Anbieter ohne Prompt-Speicherung. */
function ZdrCard(): React.JSX.Element {
  const t = useT()
  const [on, setOn] = useState(true)
  useEffect(() => {
    void invoke('settings:get', { key: 'ai.zdrOnly' }).then((r) => setOn(r.value !== '0'))
  }, [])
  const toggle = (): void => {
    const next = !on
    setOn(next)
    void invoke('settings:set', { key: 'ai.zdrOnly', value: next ? '1' : '0' })
  }
  return (
    <>
      <div className="mlabel" style={{ color: 'var(--ac)' }}>
        {t('zdrHead')}
      </div>
      {/* Track-Optik des Rules-/Reply-Scope-Toggles wiederverwendet */}
      <button
        type="button"
        className="reply-scope-toggle"
        onClick={toggle}
        aria-pressed={on}
        style={{ marginTop: 10 }}
      >
        <span className="reply-scope-toggle__label">{t('zdrLabel')}</span>
        <span className="reply-scope-toggle__track" aria-hidden="true">
          <span className="reply-scope-toggle__knob" />
        </span>
      </button>
      <div className="mmeta" style={{ marginTop: 8 }}>
        {t('zdrNote')}
      </div>
    </>
  )
}

export function IntelSheet(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const orStatus = useOrKeyStatus()
  const accounts = useAccounts()
  const [key, setKey] = useState('')

  // Auto-Resume (Design 1b): Wurde das Training im Onboarding übersprungen,
  // holt ein später gespeicherter Schlüssel es nach — für jedes Konto ohne
  // Stilprofil. Scheitert ein Lauf, bleibt das Profil leer und die VoiceCard
  // bietet weiterhin RETRAIN an — nichts wird still als fertig markiert.
  const resumeStyleTraining = async (): Promise<void> => {
    for (const a of accounts.data ?? []) {
      const r = await invoke('settings:get', { key: `ai.styleProfile.${a.id}` })
      if (r.value) continue
      void invoke('ai:refreshStyle', { accountId: a.id })
        .then(({ ok }) => {
          if (ok) void queryClient.invalidateQueries({ queryKey: ['styleProfile', a.id] })
        })
        .catch(() => {})
    }
  }

  const saveKey = (): void => {
    const k = key.trim()
    if (!k.startsWith('sk-or-') || k.length <= 14) {
      toastNow(t('toastKeyInvalid'))
      return
    }
    void invoke('secrets:set', { key: 'openrouter.apiKey', value: k }).then(() => {
      setKey('')
      toastNow(t('toastKeySaved'))
      void queryClient.invalidateQueries({ queryKey: ['ai'] })
      void resumeStyleTraining()
    })
  }

  const profiles = useProfiles()
  const assignments = useTaskAssignments()

  // Modell einer Aufgabe wählen: Profil bleibt, nur das Modell wechselt
  const TASK_OF = { scan: 'triage', write: 'draft', stt: 'stt' } as const
  const pick = (kind: 'scan' | 'write' | 'stt') => (id: string) => {
    const task = TASK_OF[kind]
    const profileId = assignments.data?.[task].profileId ?? 'openrouter'
    void invoke('ai:tasks:set', { task, profileId, model: id }).then(() => {
      const model = id.split('/')[1] ?? id
      toastNow(
        kind === 'scan'
          ? t('toastScanModel', { model })
          : kind === 'write'
            ? t('toastWriteModel', { model })
            : t('toastSttModel', { model })
      )
      void queryClient.invalidateQueries({ queryKey: ['ai'] })
    })
  }

  /** Modellwahl je nach Profil: OpenRouter kuratiert, eigene Profile aus /models. */
  const renderModels = (kind: 'scan' | 'write' | 'stt'): React.JSX.Element | null => {
    const task: AiTaskName = TASK_OF[kind]
    const a = assignments.data?.[task]
    if (!a) return null
    if (a.profileId === 'apple') {
      return (
        <div className="mmeta" style={{ marginTop: 8 }}>
          {kind === 'stt' ? t('taskAppleNote') : t('fmCloudDimmed')}
        </div>
      )
    }
    const profile = profiles.data?.find((p) => p.id === a.profileId)
    if (!profile) return null
    if (profile.preset === 'openrouter') {
      return <ModelList kind={kind} current={a.model} onPick={pick(kind)} />
    }
    return (
      <ProfileModelPicker task={task} profile={profile} current={a.model} onPick={pick(kind)} />
    )
  }

  return (
    <SheetShell title={t('intelligence')} sub={t('intelSub')}>
      <div className="ink-card" style={{ padding: 14, marginTop: 16 }}>
        <div className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('orKeyHead')}
        </div>
        <div className="flex gap-2" style={{ marginTop: 10 }}>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveKey()
              e.stopPropagation()
            }}
            type="password"
            placeholder="sk-or-v1-…"
            className="paper-input flex-1"
          />
          <span
            onClick={saveKey}
            className="cursor-pointer"
            style={{
              font: '500 10px var(--mono)',
              color: 'var(--paper)',
              background: 'var(--ink)',
              padding: '6px 14px'
            }}
          >
            {t('save')}
          </span>
        </div>
        <div
          className="mmeta"
          style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {/* Ohne Schlüssel schläft die Eule — sie wacht mit dem Speichern auf */}
          <OwlGlyph
            pose={orStatus.data?.hasKey ? 'awake' : 'asleep'}
            size={15}
            color="var(--muted)"
          />
          {orStatus.data?.hasKey ? t('orSaved') : t('orNoKey')}
        </div>
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <ZdrCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <LocalOnlyCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <ProvidersCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('modelScan')}
          </span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('modelScanSub')}
          </span>
        </div>
        <TaskProviderPicker task="triage" />
        {renderModels('scan')}
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('modelWrite')}
          </span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('modelWriteSub')}
          </span>
        </div>
        <TaskProviderPicker task="draft" />
        {renderModels('write')}
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('modelStt')}
          </span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('modelSttSub')}
          </span>
        </div>
        <TaskProviderPicker task="stt" />
        {renderModels('stt')}
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <DecisionCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <OnDemandCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <TasksAutoCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <DraftCalendarToggle />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <FollowupRadarCard />
      </div>

      <div className="ink-card" style={{ padding: 14, marginTop: 12 }}>
        <RulesSection />
      </div>

      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--faint)',
          marginTop: 14
        }}
      >
        {t('intelFootnote')}
      </div>
    </SheetShell>
  )
}

// Fenster des Follow-up-Radars (Design-Grafik 09: „Fenster 3–21 Tage")
const FOLLOWUP_MIN_DAYS = 3
const FOLLOWUP_MAX_DAYS = 21

/**
 * Schwelle des Follow-up-Radars (followup.waitDays): nach wie vielen Tagen
 * Stille eine gesendete Mail unter WARTET auftaucht. Das Backend las die
 * Einstellung schon immer — hier bekommt sie endlich ihre Tür.
 */
function FollowupRadarCard(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const [days, setDays] = useState(3)

  useEffect(() => {
    void invoke('settings:get', { key: 'followup.waitDays' }).then((r) => {
      const parsed = Number(r.value ?? '3')
      if (Number.isFinite(parsed)) {
        setDays(Math.min(FOLLOWUP_MAX_DAYS, Math.max(FOLLOWUP_MIN_DAYS, Math.round(parsed))))
      }
    })
  }, [])

  const apply = (next: number): void => {
    const clamped = Math.min(FOLLOWUP_MAX_DAYS, Math.max(FOLLOWUP_MIN_DAYS, next))
    setDays(clamped)
    void invoke('settings:set', { key: 'followup.waitDays', value: String(clamped) }).then(() => {
      // Die WARTET-Liste rechnet beim nächsten Radar-Scan mit der neuen Schwelle
      void queryClient.invalidateQueries({ queryKey: ['followups'] })
    })
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('followupRadarHead')}
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('followupRadarSub')}
        </span>
      </div>
      <div className="flex items-center gap-3" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="followup-step"
          onClick={() => apply(days - 1)}
          disabled={days <= FOLLOWUP_MIN_DAYS}
          aria-label={t('followupFewer')}
        >
          −
        </button>
        <span style={{ font: '500 12px var(--mono)', minWidth: 74, textAlign: 'center' }}>
          {t('followupDays', { n: days })}
        </span>
        <button
          type="button"
          className="followup-step"
          onClick={() => apply(days + 1)}
          disabled={days >= FOLLOWUP_MAX_DAYS}
          aria-label={t('followupMore')}
        >
          +
        </button>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('followupWindowNote')}
        </span>
      </div>
    </>
  )
}

/**
 * Steuert, ob die Eule gefundene Aufgaben automatisch anlegt (tasks.autoCreate)
 * oder nur in der Mail vorschlägt — übernehmen dann per T.
 */
function TasksAutoCard(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const [on, setOn] = useState(true)
  useEffect(() => {
    void invoke('settings:get', { key: 'tasks.autoCreate' }).then((r) => setOn(r.value !== '0'))
  }, [])
  const toggle = (): void => {
    const next = !on
    setOn(next)
    void invoke('settings:set', { key: 'tasks.autoCreate', value: next ? '1' : '0' }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    })
  }
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('tasksAutoHead')}
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('tasksAutoSub')}
        </span>
      </div>
      <div className="flex items-center gap-3" style={{ marginTop: 12 }}>
        <span onClick={toggle} className="flex cursor-pointer items-center gap-1.5">
          <span className="toggle-track" style={{ background: on ? 'var(--ink)' : 'transparent' }}>
            <span
              className="toggle-dot"
              style={{ background: on ? '#F4F1EA' : 'var(--ink)', marginLeft: on ? 12 : 0 }}
            />
          </span>
          <span style={{ font: '400 10px var(--mono)', color: 'var(--ink)' }}>
            {t('tasksAutoToggle')}
          </span>
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {on ? t('tasksAutoNoteOn') : t('tasksAutoNoteOff')}
        </span>
      </div>
    </>
  )
}
