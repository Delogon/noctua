import { useState } from 'react'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { suggestIsLocal } from '@shared/local-host'
import type { AiChoice } from '@renderer/features/paper/onboarding-steps'
import type { Endpoint, OnboardingAi } from '@renderer/features/paper/useOnboardingAi'

// Onboarding-Schritt 3 („Wo soll die KI laufen?"): vier Optionen als
// Letterpress-Karten — lokaler Server (empfohlen), Apple On-Device, Cloud,
// Überspringen — plus „Nur lokal"-Schalter. Zustand und IPC liegen in
// useOnboardingAi; hier steht nur das Rendering.

const SMALL_BTN: React.CSSProperties = {
  font: '500 10px var(--mono)',
  letterSpacing: 1,
  color: 'var(--paper)',
  background: 'var(--ink)',
  padding: '8px 14px'
}
const SMALL_BTN_GHOST: React.CSSProperties = {
  font: '500 10px var(--mono)',
  letterSpacing: 1,
  color: 'var(--ink)',
  border: '1px solid var(--hairline)',
  padding: '7px 13px'
}
const LABEL: React.CSSProperties = { color: 'var(--muted)', display: 'block', marginBottom: 5 }
const NOTE: React.CSSProperties = { font: '400 9.5px/1.5 var(--mono)', color: 'var(--muted)' }

/** Kopfzeile einer Option: Radio-Glyph, Titel, optional Badge, eine Zeile Beschreibung. */
function OptionCard({
  id,
  selected,
  onSelect,
  title,
  badge,
  sub,
  children
}: {
  id: AiChoice
  selected: boolean
  onSelect: (c: AiChoice) => void
  title: string
  badge?: string
  sub: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={selected ? 'ink-card' : 'tint-card'}
      style={{ padding: '10px 14px', marginTop: 8 }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-ai-option={id}
        onClick={() => onSelect(id)}
        className="btn-bare flex w-full items-start gap-3 text-left"
        style={{ cursor: 'pointer' }}
      >
        <span
          aria-hidden="true"
          className="flex-none"
          style={{
            width: 12,
            height: 12,
            marginTop: 3,
            borderRadius: '50%',
            border: '1.5px solid var(--ink)',
            background: selected ? 'var(--ink)' : 'transparent',
            boxShadow: selected ? 'inset 0 0 0 2px var(--card-tint)' : 'none'
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span style={{ font: '500 13.5px var(--serif)', color: 'var(--ink)' }}>{title}</span>
            {badge && (
              <span
                className="flex-none"
                style={{
                  font: '500 8.5px var(--mono)',
                  letterSpacing: '.6px',
                  padding: '1px 5px',
                  border: '1px solid var(--ac)',
                  color: 'var(--ac)'
                }}
              >
                {badge}
              </span>
            )}
          </span>
          <span
            className="block"
            style={{
              font: '400 12px/1.5 var(--serif)',
              fontStyle: 'italic',
              color: 'var(--secondary)',
              marginTop: 1
            }}
          >
            {sub}
          </span>
        </span>
      </button>
      {selected && children && <div style={{ marginTop: 10, paddingLeft: 24 }}>{children}</div>}
    </div>
  )
}

/** Modellwahl: Auswahlliste, solange der Server welche kennt, sonst Freitext. */
function ModelField({
  label,
  value,
  models,
  onChange
}: {
  label: string
  value: string
  models: string[]
  onChange: (v: string) => void
}): React.JSX.Element {
  const t = useT()
  const options = value && !models.includes(value) ? [value, ...models] : models
  return (
    <label className="min-w-0 flex-1" style={{ display: 'block' }}>
      <span className="mlabel" style={LABEL}>
        {label}
      </span>
      {options.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="paper-input"
          style={{ font: '500 11px var(--mono)', width: '100%' }}
        >
          {!value && <option value="">{t('modelPick')}</option>}
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={t('modelFreeText')}
          className="paper-input"
          style={{ width: '100%' }}
        />
      )}
    </label>
  )
}

/** Adresse + optionaler Key + TESTEN; danach (wenn verifiziert) die zwei Modellwahlen. */
function EndpointForm({
  ep,
  edit,
  patch,
  test,
  showStyle,
  urlPlaceholder,
  keyLabel,
  autoPickNote
}: {
  ep: Endpoint
  edit: (p: Partial<Pick<Endpoint, 'url' | 'key' | 'style'>>) => void
  patch: (p: Partial<Endpoint>) => void
  test: () => Promise<void>
  showStyle: boolean
  urlPlaceholder: string
  keyLabel: string
  autoPickNote: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-2.5">
      <label style={{ display: 'block' }}>
        <span className="mlabel" style={LABEL}>
          {t('obAiUrlLabel')}
        </span>
        <input
          value={ep.url}
          onChange={(e) => edit({ url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void test()
            e.stopPropagation()
          }}
          placeholder={urlPlaceholder}
          spellCheck={false}
          className="paper-input"
          style={{ width: '100%' }}
        />
      </label>
      <label style={{ display: 'block' }}>
        <span className="mlabel" style={LABEL}>
          {keyLabel}
        </span>
        <input
          value={ep.key}
          onChange={(e) => edit({ key: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void test()
            e.stopPropagation()
          }}
          type="password"
          autoComplete="off"
          className="paper-input"
          style={{ width: '100%' }}
        />
      </label>
      {showStyle && (
        <label style={{ display: 'block' }}>
          <span className="mlabel" style={LABEL}>
            {t('profileStyle')}
          </span>
          <select
            value={ep.style}
            onChange={(e) => edit({ style: e.target.value as 'chat' | 'responses' })}
            className="paper-input"
            style={{ width: 'auto', font: '500 11px var(--mono)' }}
          >
            <option value="chat">{t('profileStyleChat')}</option>
            <option value="responses">{t('profileStyleResponses')}</option>
          </select>
        </label>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-bare flex-none"
          disabled={!ep.url.trim() || ep.testing}
          onClick={() => void test()}
          style={ep.url.trim() ? SMALL_BTN : { ...SMALL_BTN_GHOST, color: 'var(--faint)' }}
        >
          {ep.testing ? '···' : t('obAiTest')}
        </button>
        {ep.verified && (
          <span style={{ font: '400 9.5px var(--mono)', color: 'var(--ink)' }}>
            {t('obAiTestOk', { n: ep.models.length })}
          </span>
        )}
        {ep.error && (
          <span role="alert" style={{ font: '400 9.5px var(--mono)', color: 'var(--ac)' }}>
            ✗ {ep.error}
          </span>
        )}
      </div>
      {ep.verified && (
        <ModelPair ep={ep} patch={patch} note={autoPickNote} nonLocalWarn={autoPickNote} />
      )}
      {ep.verified && autoPickNote && <DecisionHint ep={ep} patch={patch} />}
    </div>
  )
}

/** Zwei Modellwahlen (Sortieren / Schreiben) mit Hinweis auf die automatische Vorwahl. */
function ModelPair({
  ep,
  patch,
  note,
  nonLocalWarn
}: {
  ep: Endpoint
  patch: (p: Partial<Endpoint>) => void
  note: boolean
  nonLocalWarn: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        <ModelField
          label={t('obAiScanLabel')}
          value={ep.triage}
          models={ep.models}
          onChange={(v) => patch({ triage: v })}
        />
        <ModelField
          label={t('obAiWriteLabel')}
          value={ep.draft}
          models={ep.models}
          onChange={(v) => patch({ draft: v })}
        />
      </div>
      {note && ep.models.length > 0 && <div style={NOTE}>{t('obAiModelsAuto')}</div>}
      {nonLocalWarn && !suggestIsLocal(ep.url) && (
        <div style={{ ...NOTE, color: 'var(--ac)' }}>{t('obAiNotLocal')}</div>
      )}
    </div>
  )
}

/**
 * Entscheidungsmodell (Ollama System One): vorgewählt, wenn der Server eines hat,
 * sonst ein kleiner Tipp. Nur für Ollama — andere Server kennen die API nicht.
 */
function DecisionHint({
  ep,
  patch
}: {
  ep: Endpoint
  patch: (p: Partial<Endpoint>) => void
}): React.JSX.Element | null {
  const t = useT()
  if (!ep.verified) return null
  if (ep.decisionModels.length > 0) {
    return (
      <div className="flex flex-col gap-1" data-ai-decision="found">
        <div className="flex gap-3">
          <label className="min-w-0 flex-1" style={{ display: 'block' }}>
            <span className="mlabel" style={LABEL}>
              {t('obAiDecisionLabel')}
            </span>
            <select
              value={ep.decision}
              onChange={(e) => patch({ decision: e.target.value })}
              className="paper-input"
              style={{ font: '500 11px var(--mono)', width: '100%' }}
            >
              <option value="">{t('decisionOff')}</option>
              {ep.decisionModels.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={NOTE}>{t('obAiDecisionFound')}</div>
      </div>
    )
  }
  if (ep.label === 'Ollama' || /:11434\b/.test(ep.url)) {
    return (
      <div style={NOTE} data-ai-decision="tip">
        {t('obAiDecisionTip')}
      </div>
    )
  }
  return null
}

function LocalBody({ ai }: { ai: OnboardingAi }): React.JSX.Element {
  const t = useT()
  const [dictOpen, setDictOpen] = useState(false)
  const manual = ai.selectedServer === 'manual' || (!ai.detect.isLoading && ai.found.length === 0)
  const modelsLabel = (n: number): string =>
    n === 1 ? t('obAiModelOne') : t('obAiModelMany', { n })

  return (
    <div className="flex flex-col gap-3">
      {ai.detect.isLoading && <div style={NOTE}>{t('obAiDetecting')}</div>}

      {ai.found.length > 0 && (
        <div>
          <span className="mlabel" style={LABEL}>
            {t('obAiFoundLabel')}
          </span>
          <div className="flex flex-col gap-1.5">
            {ai.found.map((s) => {
              const on = ai.selectedServer === s.baseUrl
              return (
                <button
                  key={s.baseUrl}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-ai-server={s.kind}
                  onClick={() =>
                    ai.pickServer(s.baseUrl, s.models, ai.kindLabel(s.kind), s.decisionModels)
                  }
                  className="btn-bare flex items-baseline gap-2 text-left"
                  style={{
                    padding: '6px 10px',
                    border: `1px solid ${on ? 'var(--ink)' : 'var(--hairline)'}`,
                    background: on ? 'var(--sheet)' : 'transparent'
                  }}
                >
                  <span style={{ font: '500 11.5px var(--mono)', color: 'var(--ink)' }}>
                    {on ? '● ' : '○ '}
                    {ai.kindLabel(s.kind)}
                  </span>
                  <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>
                    {s.baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '')}
                  </span>
                  <span
                    className="ml-auto"
                    style={{ font: '400 9.5px var(--mono)', color: 'var(--muted)' }}
                  >
                    {modelsLabel(s.models.length)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!manual && ai.selectedServer && (
        <>
          <ModelPair ep={ai.local.ep} patch={ai.local.patch} note nonLocalWarn={false} />
          <DecisionHint ep={ai.local.ep} patch={ai.local.patch} />
        </>
      )}

      {ai.found.length === 0 && !ai.detect.isLoading && (
        <div className="flex items-baseline gap-3">
          <span style={NOTE}>{t('obAiNoneFound')}</span>
          <button
            type="button"
            className="text-btn flex-none"
            onClick={() => void ai.detect.refetch()}
          >
            {t('obAiSearchAgain')}
          </button>
        </div>
      )}

      {manual ? (
        <EndpointForm
          ep={ai.local.ep}
          edit={(p) => {
            ai.setSelectedServer('manual')
            ai.local.edit(p)
          }}
          patch={ai.local.patch}
          test={ai.local.test}
          showStyle={false}
          urlPlaceholder="http://127.0.0.1:11434/v1"
          keyLabel={t('obAiKeyOptional')}
          autoPickNote
        />
      ) : (
        <button
          type="button"
          className="text-btn self-start"
          style={{ borderBottom: '1px solid var(--hairline)' }}
          onClick={() => {
            ai.setSelectedServer('manual')
            ai.local.edit({ url: '' })
          }}
        >
          {t('obAiOtherAddress')}
        </button>
      )}

      {/* Diktat: optional, standardmäßig eingeklappt */}
      <div style={{ borderTop: '1px dashed var(--hairline)', paddingTop: 8 }}>
        <button
          type="button"
          className="text-btn"
          aria-expanded={dictOpen}
          onClick={() => setDictOpen(!dictOpen)}
        >
          {dictOpen ? '▾ ' : '▸ '}
          {t('obAiDictation')}
        </button>
        {dictOpen && (
          <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ...(ai.appleAvailable ? [['apple', t('obAiAppleTitle')] as const] : []),
                  ['whisper', t('obAiDictWhisper')] as const,
                  ['none', t('obAiDictNone')] as const
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={ai.dictMode === mode}
                  onClick={() => ai.setDictation(mode)}
                  className="btn-bare"
                  style={{
                    ...SMALL_BTN_GHOST,
                    ...(ai.dictMode === mode
                      ? {
                          color: 'var(--paper)',
                          background: 'var(--ink)',
                          borderColor: 'var(--ink)'
                        }
                      : {})
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {ai.dictMode === 'whisper' && (
              <div className="flex flex-col gap-2">
                <input
                  value={ai.whisperUrl}
                  onChange={(e) => ai.setWhisperUrl(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="http://127.0.0.1:8000/v1"
                  aria-label={t('obAiWhisperUrl')}
                  spellCheck={false}
                  className="paper-input"
                />
                <div className="flex gap-2">
                  <input
                    value={ai.whisperKey}
                    onChange={(e) => ai.setWhisperKey(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    type="password"
                    autoComplete="off"
                    placeholder={t('obAiKeyOptional')}
                    aria-label={t('obAiKeyOptional')}
                    className="paper-input flex-1"
                  />
                  <input
                    value={ai.whisperModel}
                    onChange={(e) => ai.setWhisperModel(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label={t('obAiWhisperModel')}
                    className="paper-input flex-1"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CloudBody({
  ai,
  keyInputRef
}: {
  ai: OnboardingAi
  keyInputRef: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const t = useT()
  const orReady = ai.state.openrouterKey
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(['openrouter', 'custom'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={ai.cloudKind === k}
            onClick={() => ai.setCloudKind(k)}
            className="btn-bare"
            style={{
              ...SMALL_BTN_GHOST,
              ...(ai.cloudKind === k
                ? { color: 'var(--paper)', background: 'var(--ink)', borderColor: 'var(--ink)' }
                : {})
            }}
          >
            {k === 'openrouter' ? 'OpenRouter' : t('obAiCloudOther')}
          </button>
        ))}
      </div>

      {ai.cloudKind === 'openrouter' ? (
        <div>
          <span className="mlabel" style={LABEL}>
            {t('obKeyLabel')}
          </span>
          <div className="flex gap-2">
            <input
              ref={keyInputRef}
              value={ai.key}
              onChange={(e) => ai.setKey(e.target.value)}
              onKeyDown={(e) => {
                // Enter im Input = speichern, nie Schritt-Weiter (Design 1b)
                if (e.key === 'Enter') ai.saveKey(() => keyInputRef.current?.blur())
                e.stopPropagation()
              }}
              type="password"
              placeholder="sk-or-v1-…"
              className="paper-input flex-1"
              aria-label={t('obKeyLabel')}
            />
            <button
              type="button"
              onClick={() => ai.saveKey(() => keyInputRef.current?.blur())}
              className="btn-bare flex-none"
              style={SMALL_BTN}
            >
              {ai.keyBusy ? '···' : t('obKeySave')}
            </button>
          </div>
          {ai.keyErr ? (
            <div
              role="alert"
              style={{ font: '400 9px var(--mono)', color: 'var(--ac)', marginTop: 8 }}
            >
              {ai.keyErr}
            </div>
          ) : (
            <div
              style={{
                font: '400 9px var(--mono)',
                color: orReady ? 'var(--ink)' : 'var(--muted)',
                marginTop: 8
              }}
            >
              {orReady ? t('orSaved') : t('orNoKey')}
            </div>
          )}
          <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 4 }}>
            {t('obKeyFootnotePre')}
            <button
              type="button"
              onClick={() => void invoke('app:openExternal', { url: 'https://openrouter.ai/keys' })}
              className="btn-bare"
              style={{ color: 'var(--faint)', borderBottom: '1px solid var(--hairline)' }}
            >
              openrouter.ai/keys
            </button>
            {t('obKeyFootnotePost')}
          </div>
        </div>
      ) : (
        <EndpointForm
          ep={ai.custom.ep}
          edit={ai.custom.edit}
          patch={ai.custom.patch}
          test={ai.custom.test}
          showStyle
          urlPlaceholder="https://api.example.com/v1"
          keyLabel={t('profileKey')}
          autoPickNote={false}
        />
      )}

      <div style={{ ...NOTE, color: 'var(--ink)' }}>{t('obAiCloudPrivacy')}</div>
    </div>
  )
}

export function OnboardingAiStep({
  ai,
  keyInputRef
}: {
  ai: OnboardingAi
  keyInputRef: React.RefObject<HTMLInputElement | null>
}): React.JSX.Element {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t('obAiHead')} style={{ marginTop: 14 }}>
      <OptionCard
        id="local"
        selected={ai.choice === 'local'}
        onSelect={ai.setChoice}
        title={t('obAiLocalTitle')}
        badge={t('obAiRecommended')}
        sub={t('obAiLocalSub')}
      >
        <LocalBody ai={ai} />
      </OptionCard>

      {ai.appleAvailable && (
        <OptionCard
          id="apple"
          selected={ai.choice === 'apple'}
          onSelect={ai.setChoice}
          title={t('obAiAppleTitle')}
          sub={t('obAiAppleSub')}
        >
          <div style={NOTE}>{t('obAiAppleNote')}</div>
        </OptionCard>
      )}

      <OptionCard
        id="cloud"
        selected={ai.choice === 'cloud'}
        onSelect={ai.setChoice}
        title={t('obAiCloudTitle')}
        sub={t('obAiCloudSub')}
      >
        <CloudBody ai={ai} keyInputRef={keyInputRef} />
      </OptionCard>

      <OptionCard
        id="skip"
        selected={ai.choice === 'skip'}
        onSelect={ai.setChoice}
        title={t('obAiSkipTitle')}
        sub={t('obAiSkipSub')}
      />

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className="reply-scope-toggle"
          onClick={ai.toggleLocalOnly}
          aria-pressed={ai.localOnly}
        >
          <span className="reply-scope-toggle__label">{t('obAiLocalOnly')}</span>
          <span className="reply-scope-toggle__track" aria-hidden="true">
            <span className="reply-scope-toggle__knob" />
          </span>
        </button>
        <div style={{ ...NOTE, marginTop: 6 }}>
          {ai.localOnly && ai.choice === 'cloud' ? t('obAiLocalOnlyCloud') : t('obAiLocalOnlyNote')}
        </div>
      </div>

      {ai.commitError && (
        <div
          role="alert"
          style={{ font: '400 9.5px var(--mono)', color: 'var(--ac)', marginTop: 10 }}
        >
          ✗ {ai.commitError}
        </div>
      )}
    </div>
  )
}
