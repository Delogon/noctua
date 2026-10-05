import { Fragment, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useAccounts } from '@renderer/queries/accounts'
import { useOrKeyStatus } from '@renderer/queries/intel'
import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import { OwlGlyph } from '@renderer/components/paper/OwlGlyph'
import {
  enterAction,
  finishCtaEnabled,
  rowState,
  trainCtaEnabled,
  type ObStep,
  type TrainRowState
} from '@renderer/features/paper/onboarding-steps'

// 4-Schritte-Onboarding nach Design 1b (welcome → connect → key → training)
// — mit ECHTEN Flows: Google und Microsoft öffnen den Browser-OAuth (M46),
// IMAP nimmt Host + App-Passwort inline, Schritt 3 speichert den OpenRouter-Schlüssel
// über denselben Kanal wie das Intelligenz-Sheet (secrets:set), und das
// Stil-Training in Schritt 4 zeigt ehrlich, ob es läuft, pausiert oder
// gescheitert ist — nie ein erfundenes 100 %.

interface TrainRow {
  accountId: number
  accountName: string
  email: string
  pct: number
  traits: string
  running: boolean
  failed: boolean
}

export function Onboarding(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const accounts = useAccounts()
  const orStatus = useOrKeyStatus()
  const { setOnboarding, toastNow } = usePaper()
  const [step, setStep] = useState<ObStep>(1)
  const [form, setForm] = useState<'gmail' | 'microsoft' | 'imap' | null>(null)
  const [accountName, setAccountName] = useState('')
  const [addr, setAddr] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [train, setTrain] = useState<TrainRow[]>([])
  // Schritt 4 im Pausen-Modus: Schlüssel übersprungen, Spuren bleiben leer
  const [paused, setPaused] = useState(false)
  // Schlüssel-Schritt: Eingabe, Inline-Fehler, lokal bestätigter Save
  const [key, setKey] = useState('')
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const keyInputRef = useRef<HTMLInputElement | null>(null)

  const connected = accounts.data ?? []
  // Replay-Fall: existiert schon ein Schlüssel (ai:usage), ist der CTA sofort aktiv
  const keyReady = keySaved || orStatus.data?.hasKey === true

  const finish = (): void => {
    void invoke('settings:set', { key: 'noctua.onboarded', value: '1' })
    setOnboarding(false)
    setTimeout(() => toastNow(t('toastWelcome')), 600)
  }

  const saveKey = (): void => {
    const k = key.trim()
    // Gleiche Prüfung wie im Intelligenz-Sheet — Fehler inline, kein Toast (Design 1b)
    if (!k.startsWith('sk-or-') || k.length <= 14) {
      setKeyErr(t('toastKeyInvalid'))
      return
    }
    if (keyBusy) return
    setKeyBusy(true)
    void invoke('secrets:set', { key: 'openrouter.apiKey', value: k })
      .then(() => {
        setKey('')
        setKeyErr(null)
        setKeySaved(true)
        // Fokus raus aus dem Input, damit ↵ jetzt den CTA (Training) auslöst
        keyInputRef.current?.blur()
        void queryClient.invalidateQueries({ queryKey: ['ai'] })
      })
      .catch((err) => setKeyErr(err instanceof Error ? err.message : String(err)))
      .finally(() => setKeyBusy(false))
  }

  /** Trainiert EIN Konto: Fortschritts-Intervall bis 92 %, dann ehrliches Ende. */
  const runRow = (accountId: number): void => {
    setTrain((prev) =>
      prev.map((x) =>
        x.accountId === accountId ? { ...x, running: true, failed: false, pct: 0, traits: '' } : x
      )
    )
    const iv = setInterval(() => {
      setTrain((prev) =>
        prev.map((x) =>
          x.accountId === accountId && x.running && x.pct < 92 ? { ...x, pct: x.pct + 4 } : x
        )
      )
    }, 90)
    void invoke('ai:refreshStyle', { accountId })
      .then(async ({ ok }) => {
        clearInterval(iv)
        let traits = ''
        if (ok) {
          const r = await invoke('settings:get', { key: `ai.styleProfile.${accountId}` })
          try {
            const p = JSON.parse(r.value ?? '{}') as {
              style_notes?: string[]
              languages?: string[]
            }
            traits = [...(p.style_notes ?? []).slice(0, 3), (p.languages ?? []).join('/')]
              .filter(Boolean)
              .join(' · ')
          } catch {
            traits = ''
          }
        }
        setTrain((prev) =>
          prev.map((x) =>
            x.accountId === accountId
              ? { ...x, pct: 100, running: false, failed: false, traits }
              : x
          )
        )
      })
      .catch(() => {
        clearInterval(iv)
        // Ehrlich scheitern: leere Spur + FAILED — RETRY statt still 100 % (Design 1b)
        setTrain((prev) =>
          prev.map((x) =>
            x.accountId === accountId ? { ...x, pct: 0, running: false, failed: true } : x
          )
        )
      })
  }

  /** Wechsel zu Schritt 4 — mit Schlüssel läuft das Training, ohne pausiert es. */
  const goTraining = (withKey: boolean): void => {
    const rows: TrainRow[] = connected.map((a) => ({
      accountId: a.id,
      accountName: a.accountName,
      email: a.email,
      pct: 0,
      traits: '',
      running: false,
      failed: false
    }))
    setPaused(!withKey)
    setTrain(rows)
    setStep(4)
    if (withKey) rows.forEach((row, i) => setTimeout(() => runRow(row.accountId), i * 500))
  }

  const rowStates: TrainRowState[] = train.map((r) => rowState(r, paused))
  const finishEnabled = finishCtaEnabled(rowStates)
  const trainEnabled = trainCtaEnabled(keyReady)

  // Enter steuert die Schritte (Spec) — Gating liegt in onboarding-steps.ts.
  // Buttons sind ausgenommen: dort feuert Enter schon den nativen Klick.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      if (e.key !== 'Enter') return
      const action = enterAction(step, { connectedCount: connected.length, keyReady, rowStates })
      if (!action) return
      if (action.kind === 'to-connect') setStep(2)
      else if (action.kind === 'toast-connect-one') toastNow(t('toastConnectOne'))
      else if (action.kind === 'to-key') setStep(3)
      else if (action.kind === 'to-training') goTraining(true)
      else if (action.kind === 'finish') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Schritt 3 ohne Schlüssel: Input fokussieren — auch beim Rücksprung über ADD KEY
  useEffect(() => {
    if (step === 3 && !keyReady) keyInputRef.current?.focus()
  }, [step, keyReady])

  // Laufenden Flow markieren: Ein Neustart mittendrin setzt das Onboarding
  // dann fort, statt verbundene Konten als „Bestandsinstallation" zu werten
  // (App.tsx, onboardingBootDecision) — sonst entfiele der Schlüssel-Schritt.
  useEffect(() => {
    void invoke('settings:set', { key: 'noctua.onboardingStarted', value: '1' })
  }, [])

  // Wiederaufnahme nach Unterbrechung: Sind schon Konten verbunden, ist der
  // Willkommens-Schritt erledigt — direkt bei VERBINDEN weitermachen.
  if (step === 1 && connected.length > 0) setStep(2)

  // Erst-Sync live verfolgen: Solange ein Konto lädt, die Kontenliste alle
  // 2,5 s neu ziehen — Mail-Zähler und Puls-Punkt bleiben so ehrlich.
  const anySyncing = connected.some(
    (a) => a.syncState === 'connecting' || a.syncState === 'syncing'
  )
  useEffect(() => {
    if (!anySyncing) return
    const iv = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      2500
    )
    return () => clearInterval(iv)
  }, [anySyncing, queryClient])

  // Google und Microsoft laufen über den Browser-OAuth — identischer Ablauf,
  // nur der IPC-Kanal unterscheidet sich. Kein App-Passwort mehr (M46).
  const addOauth = (provider: 'gmail' | 'microsoft'): void => {
    if (!accountName.trim()) {
      toastNow(t('toastAccountNameRequired'))
      return
    }
    setBusy(provider)
    void invoke(provider === 'gmail' ? 'accounts:addGoogle' : 'accounts:addMicrosoft', {
      accountName: accountName.trim()
    })
      .then(({ email }) => {
        toastNow(t('toastConnected', { addr: email }))
        setForm(null)
        setAccountName('')
        void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      })
      .catch((err) => toastNow(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }

  const connectForm = (): void => {
    if (!accountName.trim()) {
      toastNow(t('toastAccountNameRequired'))
      return
    }
    if (!addr.includes('@') || !pass || !host) {
      toastNow(t('toastImapFields'))
      return
    }
    // Proton Bridge läuft auf dem Loopback mit eigenen Ports (1143/1025) —
    // ohne Port-Angabe die richtigen Defaults wählen statt stur 993/587.
    const cleanHost = host.trim()
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(cleanHost.toLowerCase())
    setBusy(form)
    void invoke('accounts:add', {
      email: addr.trim(),
      accountName: accountName.trim(),
      password: pass,
      provider: 'imap',
      imapHost: cleanHost,
      imapPort: Number(port) || (loopback ? 1143 : 993),
      smtpHost: loopback ? cleanHost : cleanHost.replace(/^imap\./, 'smtp.'),
      smtpPort: loopback ? 1025 : 587
    })
      .then(() => {
        toastNow(t('toastConnected', { addr: addr.trim() }))
        setForm(null)
        setAccountName('')
        setAddr('')
        setHost('')
        setPort('')
        setPass('')
        void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      })
      .catch((err) => toastNow(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null))
  }

  const ctaStyle = (enabled: boolean): React.CSSProperties => ({
    cursor: enabled ? 'pointer' : 'default',
    font: '500 11px var(--mono)',
    letterSpacing: 1,
    padding: '9px 18px',
    ...(enabled
      ? { color: 'var(--paper)', background: 'var(--ink)' }
      : { color: 'var(--faint)', border: '1px solid var(--hairline)' })
  })

  const providers: Array<{ key: 'gmail' | 'microsoft' | 'imap'; glyph: string; name: string }> = [
    { key: 'gmail', glyph: 'G', name: 'Google Mail' },
    { key: 'microsoft', glyph: 'O', name: 'Outlook / Hotmail' },
    { key: 'imap', glyph: 'I', name: 'IMAP' }
  ]
  const providerConnected = (key: string): boolean =>
    connected.some((a) =>
      key === 'imap' ? a.provider === 'imap' || a.provider === 'proton' : a.provider === key
    )

  return (
    <div className="flex flex-1 items-center justify-center" style={{ padding: 24 }}>
      <div
        className="overlay-card"
        style={{
          width: 620,
          boxShadow: '8px 8px 0 rgba(23,21,15,.1)',
          padding: '40px 44px',
          boxSizing: 'border-box'
        }}
      >
        {step === 1 && (
          <div>
            <div className="flex justify-center" style={{ marginBottom: 14 }}>
              <OwlGlyph pose="awake" size={64} />
            </div>
            <div style={{ font: '500 34px var(--serif)', fontStyle: 'italic', marginTop: 22 }}>
              Noctua
            </div>
            <div
              style={{
                font: '400 12px var(--mono)',
                color: 'var(--muted)',
                letterSpacing: 1,
                marginTop: 6
              }}
            >
              {t('obTagline')}
            </div>
            <div
              style={{
                font: '400 16px/1.7 var(--serif)',
                color: 'var(--body-text)',
                marginTop: 22,
                maxWidth: 460
              }}
            >
              {t('obIntro')}
            </div>
            <div className="flex items-center gap-4" style={{ marginTop: 30 }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-bare"
                style={ctaStyle(true)}
              >
                {t('obConnectCta')}
              </button>
              <button
                type="button"
                onClick={finish}
                className="btn-bare"
                style={{
                  font: '400 10px var(--mono)',
                  color: 'var(--faint)',
                  borderBottom: '1px solid var(--hairline)'
                }}
              >
                {t('obSkip')}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="mlabel" style={{ letterSpacing: 2, color: 'var(--ac)' }}>
              {t('obStep2')}
            </div>
            <div style={{ font: '500 24px var(--serif)', marginTop: 8 }}>{t('obConnectHead')}</div>
            <div
              style={{
                font: '400 13.5px/1.6 var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                marginTop: 4
              }}
            >
              {t('obConnectSub')}
            </div>
            <div className="flex flex-col gap-2.5" style={{ marginTop: 22 }}>
              {providers.map((p) => {
                const done = providerConnected(p.key)
                const acc = connected.find((a) =>
                  p.key === 'imap' ? a.provider === 'imap' : a.provider === p.key
                )
                return (
                  <Fragment key={p.key}>
                    <div
                      className="tint-card flex items-center gap-3"
                      style={{ padding: '12px 14px' }}
                    >
                      <div
                        className="flex flex-none items-center justify-center"
                        style={{
                          width: 26,
                          height: 26,
                          border: '1px solid var(--ink)',
                          font: '600 10px var(--mono)'
                        }}
                      >
                        {p.glyph}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div style={{ font: '500 14px var(--serif)' }}>{p.name}</div>
                        <div className="mmeta" style={{ marginTop: 1 }}>
                          {acc ? `${acc.accountName} · ${acc.email}` : ''}
                        </div>
                      </div>
                      <span
                        className="flex items-center gap-1.5"
                        style={{ font: '400 9px var(--mono)', color: 'var(--ac)' }}
                      >
                        {done && acc ? (
                          acc.syncState === 'connecting' || acc.syncState === 'syncing' ? (
                            <>
                              <span className="ob-sync-dot" aria-hidden="true" />
                              {t('obSyncingMails', { n: acc.messageCount.toLocaleString('de-DE') })}
                            </>
                          ) : (
                            `✓ ${t('mailCount', { n: acc.messageCount.toLocaleString('de-DE') })}`
                          )
                        ) : busy === p.key ? (
                          '···'
                        ) : (
                          ''
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (done) return
                          setForm(p.key)
                        }}
                        className="btn-bare flex-none"
                        style={{
                          font: '500 9px var(--mono)',
                          letterSpacing: 1,
                          padding: '5px 12px',
                          ...(done
                            ? { color: 'var(--muted)', border: '1px solid var(--hairline)' }
                            : { color: 'var(--paper)', background: 'var(--ink)' })
                        }}
                      >
                        {done ? t('obConnected') : busy === p.key ? '···' : t('obConnect')}
                      </button>
                    </div>
                    {/* Verbinden-Formular klappt direkt unter dem gewählten Anbieter auf */}
                    {form === p.key && (
                      <div className="ink-card flex flex-col gap-2" style={{ padding: 14 }}>
                        <input
                          value={accountName}
                          onChange={(e) => setAccountName(e.target.value)}
                          placeholder={t('accountNamePh')}
                          className="paper-input"
                          maxLength={40}
                          autoFocus
                        />
                        {form === 'imap' && (
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
                                value={port}
                                onChange={(e) => setPort(e.target.value)}
                                placeholder="993"
                                inputMode="numeric"
                                className="paper-input"
                                style={{ width: 70 }}
                              />
                            </div>
                            <input
                              value={pass}
                              onChange={(e) => setPass(e.target.value)}
                              type="password"
                              placeholder={t('imapPassPh')}
                              className="paper-input"
                            />
                          </>
                        )}
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={form === 'imap' ? connectForm : () => addOauth(form)}
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
                            {form === 'microsoft'
                              ? t('microsoftBrowserNote')
                              : form === 'gmail'
                                ? t('addGoogleNote')
                                : t('imapNote')}
                          </span>
                        </div>
                      </div>
                    )}
                  </Fragment>
                )
              })}
            </div>
            <div className="flex items-center gap-4" style={{ marginTop: 24 }}>
              <button
                type="button"
                onClick={() => (connected.length > 0 ? setStep(3) : toastNow(t('toastConnectOne')))}
                className="btn-bare"
                style={ctaStyle(connected.length > 0)}
              >
                {t('obContinue')}
              </button>
              <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>
                {connected.length > 0
                  ? anySyncing
                    ? t('obSyncNote')
                    : t('obNConnected', { n: connected.length })
                  : t('obNothingLeaves')}
              </span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div className="mlabel" style={{ letterSpacing: 2, color: 'var(--ac)' }}>
              {t('obStep3')}
            </div>
            <div style={{ font: '500 24px var(--serif)', marginTop: 8 }}>{t('obKeyHead')}</div>
            <div
              style={{
                font: '400 13.5px/1.6 var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                marginTop: 4
              }}
            >
              {t('obKeySub')}
            </div>

            <div className="tint-card" style={{ padding: 14, marginTop: 22 }}>
              <div className="mlabel" style={{ color: 'var(--muted)' }}>
                {t('obKeyLabel')}
              </div>
              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <input
                  ref={keyInputRef}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value)
                    setKeyErr(null)
                  }}
                  onKeyDown={(e) => {
                    // Enter im Input = speichern, nie Schritt-Weiter (Design 1b)
                    if (e.key === 'Enter') saveKey()
                    e.stopPropagation()
                  }}
                  type="password"
                  placeholder="sk-or-v1-…"
                  className="paper-input flex-1"
                  aria-label={t('obKeyLabel')}
                />
                <button
                  type="button"
                  onClick={saveKey}
                  className="btn-bare flex-none"
                  style={{
                    font: '500 10px var(--mono)',
                    letterSpacing: 1,
                    color: 'var(--paper)',
                    background: 'var(--ink)',
                    padding: '8px 14px'
                  }}
                >
                  {keyBusy ? '···' : t('obKeySave')}
                </button>
              </div>
              {keyErr ? (
                <div
                  role="alert"
                  style={{ font: '400 9px var(--mono)', color: 'var(--ac)', marginTop: 8 }}
                >
                  {keyErr}
                </div>
              ) : (
                <div
                  style={{
                    font: '400 9px var(--mono)',
                    color: keyReady ? 'var(--ink)' : 'var(--muted)',
                    marginTop: 8
                  }}
                >
                  {keyReady ? t('orSaved') : t('orNoKey')}
                </div>
              )}
              <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 4 }}>
                {t('obKeyFootnotePre')}
                <button
                  type="button"
                  onClick={() =>
                    void invoke('app:openExternal', { url: 'https://openrouter.ai/keys' })
                  }
                  className="btn-bare"
                  style={{ color: 'var(--faint)', borderBottom: '1px solid var(--hairline)' }}
                >
                  openrouter.ai/keys
                </button>
                {t('obKeyFootnotePost')}
              </div>
            </div>

            <div style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)', marginTop: 12 }}>
              {t('obKeyModelsNote')}
            </div>

            <div className="flex items-center gap-4" style={{ marginTop: 26 }}>
              <button
                type="button"
                onClick={() => (trainEnabled ? goTraining(true) : keyInputRef.current?.focus())}
                className="btn-bare"
                style={ctaStyle(trainEnabled)}
                aria-disabled={!trainEnabled}
              >
                {t('obTrainCta')}
              </button>
              <button
                type="button"
                onClick={() => goTraining(false)}
                className="btn-bare"
                style={{
                  font: '400 10px var(--mono)',
                  color: 'var(--faint)',
                  borderBottom: '1px solid var(--hairline)'
                }}
              >
                {t('obKeySkip')}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div className="mlabel" style={{ letterSpacing: 2, color: 'var(--ac)' }}>
              {t('obStep4')}
            </div>
            <div style={{ font: '500 24px var(--serif)', marginTop: 8 }}>{t('obVoiceHead')}</div>
            <div
              style={{
                font: '400 13.5px/1.6 var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                marginTop: 4
              }}
            >
              {t('obVoiceSub')}
            </div>
            <div className="flex flex-col gap-3" style={{ marginTop: 22 }}>
              {train.map((row) => {
                const state = rowState(row, paused)
                return (
                  <div key={row.accountId} className="tint-card" style={{ padding: '12px 14px' }}>
                    <div className="flex items-baseline gap-2.5">
                      <span style={{ font: '500 12px var(--serif)', color: 'var(--ink)' }}>
                        {row.accountName}
                      </span>
                      <span style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>
                        {row.email}
                      </span>
                      <span
                        className="ml-auto"
                        style={{ font: '500 9px var(--mono)', color: 'var(--ac)' }}
                      >
                        {state === 'paused' ? (
                          t('obPausedNoKey')
                        ) : state === 'failed' ? (
                          <>
                            {t('obFailed')}{' '}
                            <button
                              type="button"
                              onClick={() => runRow(row.accountId)}
                              className="btn-bare"
                              style={{ color: 'var(--ac)', borderBottom: '1px solid var(--ac)' }}
                            >
                              {t('obRetry')}
                            </button>
                          </>
                        ) : state === 'done' ? (
                          t('obDone')
                        ) : (
                          `${row.pct}%`
                        )}
                      </span>
                    </div>
                    <div style={{ height: 5, background: 'var(--hairline-light)', marginTop: 8 }}>
                      {state !== 'paused' && (
                        <div
                          style={{
                            height: 5,
                            background: 'var(--ac)',
                            width: `${row.pct}%`,
                            transition: 'width .08s linear'
                          }}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        font: '400 11.5px var(--serif)',
                        fontStyle: 'italic',
                        color: 'var(--secondary)',
                        marginTop: 8,
                        minHeight: 16
                      }}
                    >
                      {state === 'done'
                        ? row.traits
                        : state === 'running' && row.pct > 0
                          ? t('obReading')
                          : ''}
                    </div>
                  </div>
                )
              })}
            </div>
            {paused && (
              <div
                className="ink-card flex items-center gap-3"
                style={{ padding: '10px 14px', marginTop: 14 }}
              >
                <span
                  className="flex-1"
                  style={{
                    font: '400 13px var(--serif)',
                    fontStyle: 'italic',
                    color: 'var(--secondary)'
                  }}
                >
                  {t('obPausedCallout')}
                </span>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="btn-bare flex-none"
                  style={{
                    font: '500 9px var(--mono)',
                    letterSpacing: 1,
                    color: 'var(--paper)',
                    background: 'var(--ink)',
                    padding: '5px 12px'
                  }}
                >
                  {t('obAddKey')}
                </button>
              </div>
            )}
            <div className="flex items-center gap-4" style={{ marginTop: 26 }}>
              <button
                type="button"
                onClick={() => finishEnabled && finish()}
                className="btn-bare"
                style={ctaStyle(finishEnabled)}
                aria-disabled={!finishEnabled}
              >
                {t('obEnterCta')}
              </button>
              <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>
                {paused ? t('obPausedFootnote') : t('obRetrainNote')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
