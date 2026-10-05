import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { usePaper } from '@renderer/stores/paper'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import {
  useAppleFm,
  useEmbeddingStatus,
  useLocalOnly,
  useProfileModels,
  useProfiles,
  useTaskAssignments,
  type AiProfile,
  type AiTaskName
} from '@renderer/queries/intel'
import { suggestIsLocal } from '@shared/local-host'

// Settings → Intelligence: Provider-Profile, Aufgaben-Zuordnung, Local only und
// Dinge, die nur auf Anforderung ins Netz gehen. (Phase 1.1/1.2)

const BTN_PRIMARY: React.CSSProperties = {
  font: '500 10px var(--mono)',
  color: 'var(--paper)',
  background: 'var(--ink)',
  padding: '6px 14px'
}
const BTN_GHOST: React.CSSProperties = {
  font: '500 10px var(--mono)',
  color: 'var(--ink)',
  border: '1px solid var(--hairline)',
  padding: '6px 14px'
}

function errText(err: unknown): string {
  return cleanIpcError(err instanceof Error ? err.message : String(err))
}

/** Tag „LOKAL"/„EXTERN" am Profil. */
function LocalTag({ isLocal }: { isLocal: boolean }): React.JSX.Element {
  const t = useT()
  return (
    <span
      className="flex-none"
      style={{
        font: '500 8.5px var(--mono)',
        letterSpacing: '.6px',
        padding: '1px 5px',
        border: `1px solid ${isLocal ? 'var(--ac)' : 'var(--hairline)'}`,
        color: isLocal ? 'var(--ac)' : 'var(--muted)'
      }}
    >
      {isLocal ? t('profileLocal') : t('profileExternal')}
    </span>
  )
}

// ── Local only ──────────────────────────────────────────────────────────────

export function LocalOnlyCard(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const localOnly = useLocalOnly()
  const on = localOnly.data === true

  const toggle = (): void => {
    void invoke('privacy:setLocalOnly', { localOnly: !on })
      .then(({ localOnly: next }) => {
        toastNow(next ? t('toastLocalOnlyOn') : t('toastLocalOnlyOff'))
        // betrifft KI-Zuordnung, Modelllisten, Remote-Bilder und die Suche
        void queryClient.invalidateQueries({ queryKey: ['privacy'] })
        void queryClient.invalidateQueries({ queryKey: ['ai'] })
        void queryClient.invalidateQueries({ queryKey: ['thread'] })
        void queryClient.invalidateQueries({ queryKey: ['search'] })
      })
      .catch((err) => toastNow(errText(err)))
  }

  return (
    <>
      <div className="mlabel" style={{ color: 'var(--ac)' }}>
        {t('localOnlyHead')}
      </div>
      <button
        type="button"
        className="reply-scope-toggle"
        onClick={toggle}
        aria-pressed={on}
        style={{ marginTop: 10 }}
      >
        <span className="reply-scope-toggle__label">{t('localOnlyLabel')}</span>
        <span className="reply-scope-toggle__track" aria-hidden="true">
          <span className="reply-scope-toggle__knob" />
        </span>
      </button>
      <div className="mmeta" style={{ marginTop: 8 }}>
        {t('localOnlyNote')}
      </div>
    </>
  )
}

// ── Profile ─────────────────────────────────────────────────────────────────

interface Draft {
  id: string | null
  name: string
  baseUrl: string
  apiStyle: 'chat' | 'responses'
  isLocal: boolean
  /** Nutzer hat das Flag selbst gesetzt — dann schlägt die URL-Heuristik nichts mehr vor */
  localTouched: boolean
  key: string
}

const NEW_DRAFT: Draft = {
  id: null,
  name: '',
  baseUrl: 'http://localhost:11434/v1',
  apiStyle: 'chat',
  isLocal: true,
  localTouched: false,
  key: ''
}

function ProfileEditor({
  profile,
  onClose
}: {
  profile: AiProfile | null
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const builtin = profile?.preset === 'openrouter'
  const [draft, setDraft] = useState<Draft>(
    profile
      ? {
          id: profile.id,
          name: profile.name,
          baseUrl: profile.baseUrl,
          apiStyle: profile.apiStyle,
          isLocal: profile.isLocal,
          localTouched: true,
          key: ''
        }
      : NEW_DRAFT
  )
  const [saved, setSaved] = useState<AiProfile | null>(profile)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{
    ok: boolean
    latencyMs: number
    modelCount: number
    detail: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patch = (next: Partial<Draft>): void => {
    setDraft((d) => ({ ...d, ...next }))
    setTest(null)
  }
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['ai'] })
  }

  const save = async (): Promise<AiProfile | null> => {
    setBusy(true)
    setError(null)
    try {
      let result: AiProfile
      if (draft.id) {
        result = (
          await invoke('ai:profiles:update', {
            id: draft.id,
            name: draft.name,
            ...(builtin
              ? {}
              : { baseUrl: draft.baseUrl, apiStyle: draft.apiStyle, isLocal: draft.isLocal })
          })
        ).profile
      } else {
        result = (
          await invoke('ai:profiles:create', {
            name: draft.name,
            baseUrl: draft.baseUrl,
            apiStyle: draft.apiStyle,
            isLocal: draft.isLocal
          })
        ).profile
      }
      if (draft.key.trim()) {
        await invoke('ai:profiles:setKey', { id: result.id, key: draft.key.trim() })
        result = { ...result, hasKey: true }
      }
      setSaved(result)
      setDraft((d) => ({ ...d, id: result.id, key: '', localTouched: true }))
      refresh()
      toastNow(t('toastProfileSaved', { name: result.name }))
      return result
    } catch (err) {
      setError(errText(err))
      return null
    } finally {
      setBusy(false)
    }
  }

  const runTest = async (): Promise<void> => {
    // Test läuft gegen das gespeicherte Profil — ungespeicherte Änderungen erst sichern
    const target = await save()
    if (!target) return
    setTesting(true)
    setTest(null)
    try {
      setTest(await invoke('ai:profiles:test', { id: target.id }))
      // Modellliste des Profils ist jetzt evtl. anders
      void queryClient.invalidateQueries({ queryKey: ['ai', 'profileModels', target.id] })
    } catch (err) {
      setTest({ ok: false, latencyMs: 0, modelCount: 0, detail: errText(err) })
    } finally {
      setTesting(false)
    }
  }

  const clearKey = (): void => {
    if (!saved) return
    void invoke('ai:profiles:clearKey', { id: saved.id }).then(() => {
      setSaved({ ...saved, hasKey: false })
      refresh()
    })
  }

  const remove = (): void => {
    if (!saved || builtin) return
    void invoke('ai:profiles:delete', { id: saved.id })
      .then(() => {
        refresh()
        onClose()
      })
      .catch((err) => setError(errText(err)))
  }

  const field: React.CSSProperties = { display: 'grid', gap: 4 }
  return (
    <div
      className="flex flex-col gap-2.5"
      style={{ border: '1px dashed var(--hairline)', padding: 12, marginTop: 10 }}
    >
      <label style={field}>
        <span className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('profileName')}
        </span>
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          maxLength={60}
          placeholder="Ollama"
          className="paper-input"
        />
      </label>
      <label style={field}>
        <span className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('profileUrl')}
        </span>
        <input
          value={draft.baseUrl}
          disabled={builtin}
          onChange={(e) => {
            const baseUrl = e.target.value
            patch({
              baseUrl,
              // Vorschlag fürs lokal-Flag, solange der Nutzer es nicht selbst gesetzt hat
              ...(draft.localTouched ? {} : { isLocal: suggestIsLocal(baseUrl) })
            })
          }}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="http://localhost:11434/v1"
          className="paper-input"
        />
      </label>
      <label style={field}>
        <span className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('profileStyle')}
        </span>
        <select
          value={draft.apiStyle}
          disabled={builtin}
          onChange={(e) => patch({ apiStyle: e.target.value as 'chat' | 'responses' })}
          className="paper-input"
          style={{ width: 'auto', alignSelf: 'start' }}
        >
          <option value="chat">{t('profileStyleChat')}</option>
          <option value="responses">{t('profileStyleResponses')}</option>
        </select>
      </label>
      <label style={field}>
        <span className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('profileKey')}
        </span>
        <div className="flex items-center gap-2">
          <input
            value={draft.key}
            onChange={(e) => patch({ key: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            type="password"
            autoComplete="off"
            placeholder={saved?.hasKey ? t('profileKeySaved') : t('profileKeyPh')}
            className="paper-input flex-1"
          />
          {saved?.hasKey && !builtin && (
            <button type="button" className="text-btn flex-none" onClick={clearKey}>
              {t('profileKeyRemove')}
            </button>
          )}
        </div>
      </label>
      {!builtin && (
        <label
          className="flex cursor-pointer items-start gap-2"
          style={{ font: '400 10px var(--mono)', color: 'var(--ink)' }}
        >
          <input
            type="checkbox"
            checked={draft.isLocal}
            onChange={(e) => patch({ isLocal: e.target.checked, localTouched: true })}
            style={{ marginTop: 2 }}
          />
          <span style={{ display: 'grid', gap: 2 }}>
            <strong style={{ font: '500 10px var(--mono)' }}>{t('profileIsLocal')}</strong>
            <span style={{ color: 'var(--faint)', font: '400 9px var(--mono)' }}>
              {t('profileIsLocalNote')}
            </span>
          </span>
        </label>
      )}
      {error && (
        <div style={{ font: '400 9.5px var(--mono)', color: 'var(--muted)' }}>✗ {error}</div>
      )}
      {test && (
        <div
          style={{ font: '400 9.5px var(--mono)', color: test.ok ? 'var(--ac)' : 'var(--muted)' }}
        >
          {test.ok
            ? t('profileTestOk', { n: test.modelCount, ms: test.latencyMs.toLocaleString('de-DE') })
            : `✗ ${test.detail ?? t('customModelFailed')}`}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-bare"
          disabled={busy || !draft.name.trim() || !draft.baseUrl.trim()}
          onClick={() => void save()}
          style={BTN_PRIMARY}
        >
          {t('save')}
        </button>
        <button
          type="button"
          className="btn-bare"
          disabled={busy || testing || !draft.name.trim() || !draft.baseUrl.trim()}
          onClick={() => void runTest()}
          style={BTN_GHOST}
        >
          {testing ? '···' : t('profileTest')}
        </button>
        <button type="button" className="text-btn" onClick={onClose}>
          {saved ? t('profileClose') : t('cancel')}
        </button>
        {saved && !builtin && (
          <button type="button" className="text-btn ml-auto" onClick={remove}>
            {t('profileDelete')}
          </button>
        )}
      </div>
    </div>
  )
}

export function ProvidersCard(): React.JSX.Element {
  const t = useT()
  const profiles = useProfiles()
  const localOnly = useLocalOnly().data === true
  // 'new' = Editor für ein neues Profil, sonst die ID des bearbeiteten
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('profilesHead')}
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
          {t('profilesSub')}
        </span>
      </div>
      <div className="flex flex-col gap-1.5" style={{ marginTop: 10 }}>
        {(profiles.data ?? []).map((p) => {
          const blocked = localOnly && !p.isLocal
          return (
            <div key={p.id}>
              <div
                className="flex items-center gap-2.5"
                style={{
                  padding: '7px 10px',
                  border: '1px solid var(--hairline)',
                  opacity: blocked ? 0.55 : 1
                }}
              >
                <span style={{ font: '500 11.5px var(--mono)', color: 'var(--ink)' }}>
                  {p.name}
                </span>
                <LocalTag isLocal={p.isLocal} />
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}
                  title={p.baseUrl}
                >
                  {p.baseUrl.replace(/^https?:\/\//, '')} ·{' '}
                  {p.apiStyle === 'responses' ? 'responses' : 'chat'}
                </span>
                {blocked && (
                  <span style={{ font: '400 8.5px var(--mono)', color: 'var(--muted)' }}>
                    {t('profileBlockedLocalOnly')}
                  </span>
                )}
                <span
                  className="flex-none"
                  style={{
                    font: '400 9px var(--mono)',
                    color: p.hasKey ? 'var(--ac)' : 'var(--faint)'
                  }}
                  title={p.hasKey ? t('profileKeySaved') : t('profileNoKey')}
                >
                  {p.hasKey ? '✓ KEY' : '— KEY'}
                </span>
                <button
                  type="button"
                  className="text-btn flex-none"
                  onClick={() => setEditing(editing === p.id ? null : p.id)}
                >
                  {t('profileEdit')}
                </button>
              </div>
              {editing === p.id && <ProfileEditor profile={p} onClose={() => setEditing(null)} />}
            </div>
          )
        })}
      </div>
      {editing === 'new' ? (
        <ProfileEditor profile={null} onClose={() => setEditing(null)} />
      ) : (
        <button
          type="button"
          className="text-btn"
          style={{ marginTop: 8, borderBottom: '1px solid var(--hairline)' }}
          onClick={() => setEditing('new')}
        >
          {t('profileAdd')}
        </button>
      )}
    </>
  )
}

// ── Aufgaben-Zuordnung ──────────────────────────────────────────────────────

/**
 * Profil-Auswahl einer Aufgabe. Bei Local only sind externe Profile ausgegraut;
 * für die Triage kommt Apple On-Device als zusätzliche Wahl dazu.
 */
export function TaskProviderPicker({ task }: { task: AiTaskName }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const profiles = useProfiles()
  const assignments = useTaskAssignments()
  const localOnly = useLocalOnly().data === true
  const appleFm = useAppleFm()
  const current = assignments.data?.[task]
  const appleAvailable = appleFm.data?.state === 'available'
  const showApple =
    task === 'triage' && appleFm.data !== undefined && appleFm.data.state !== 'device-unsupported'

  const change = (profileId: string): void => {
    if (!current || profileId === current.profileId) return
    // Das Modell gehört zum Profil: beim Wechsel zurücksetzen (OpenRouter → Default)
    void invoke('ai:tasks:set', { task, profileId, model: '' })
      .then(() => {
        const name =
          profileId === 'apple'
            ? t('fmProviderApple')
            : (profiles.data?.find((p) => p.id === profileId)?.name ?? profileId)
        toastNow(t('toastTaskProfile', { name }))
        void queryClient.invalidateQueries({ queryKey: ['ai'] })
      })
      .catch((err) => toastNow(errText(err)))
  }

  const blockedNote = {
    'local-only': t('taskBlockedLocalOnly'),
    'no-key': t('taskBlockedNoKey'),
    'no-model': t('taskBlockedNoModel'),
    'no-profile': t('taskBlockedNoProfile')
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="flex items-baseline gap-2">
        <span className="mlabel flex-none" style={{ color: 'var(--muted)' }}>
          {t('taskProvider')}
        </span>
        <select
          value={current?.profileId ?? ''}
          onChange={(e) => change(e.target.value)}
          className="paper-input"
          style={{ width: 'auto', padding: '3px 8px', font: '500 10px var(--mono)' }}
        >
          {(profiles.data ?? []).map((p) => (
            <option key={p.id} value={p.id} disabled={localOnly && !p.isLocal}>
              {p.name} · {p.isLocal ? t('profileLocal') : t('profileExternal')}
            </option>
          ))}
          {showApple && (
            <option value="apple" disabled={!appleAvailable}>
              {t('fmProviderApple')}
            </option>
          )}
        </select>
      </div>
      {current?.blocked && (
        <div className="mmeta" style={{ marginTop: 6, color: 'var(--ac)' }}>
          {blockedNote[current.blocked]}
        </div>
      )}
    </div>
  )
}

/**
 * Modellwahl für eigene (Nicht-OpenRouter-)Profile: Liste aus GET /models mit
 * Freitext-Fallback. Bei Local only holt Main externe Listen nicht automatisch —
 * dann gibt es einen ausdrücklichen „Liste laden"-Knopf.
 */
export function ProfileModelPicker({
  task,
  profile,
  current,
  onPick
}: {
  task: AiTaskName
  profile: AiProfile
  current: string
  onPick: (id: string) => void
}): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const list = useProfileModels(profile.id)
  const [text, setText] = useState('')
  const [testing, setTesting] = useState(false)
  const [rawResult, setResult] = useState<{
    ok: boolean
    detail: string | null
    forModel: string
  } | null>(null)
  // Testergebnis gilt nur für das getestete Modell
  const result = rawResult?.forModel === `${profile.id}/${current}` ? rawResult : null

  const loadManually = (): void => {
    void invoke('ai:profileModels', { profileId: profile.id, manual: true })
      .then((data) => queryClient.setQueryData(['ai', 'profileModels', profile.id], data))
      .catch((err) => toastNow(errText(err)))
  }
  const ids = list.data?.models.map((m) => m.id) ?? []
  const options = current && !ids.includes(current) ? [current, ...ids] : ids

  const runTest = (): void => {
    if (!current || testing) return
    setTesting(true)
    setResult(null)
    void invoke('ai:testModel', { profileId: profile.id, model: current })
      .then((r) => setResult({ ok: r.ok, detail: r.detail, forModel: `${profile.id}/${current}` }))
      .catch((err) =>
        setResult({ ok: false, detail: errText(err), forModel: `${profile.id}/${current}` })
      )
      .finally(() => setTesting(false))
  }

  return (
    <div className="flex flex-col gap-2" style={{ marginTop: 10 }}>
      <div className="mmeta">{t('modelsFrom', { name: profile.name })}</div>
      {list.data?.skipped ? (
        <div className="flex items-center gap-2">
          <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>
            {t('modelListSkipped')}
          </span>
          <button
            type="button"
            className="btn-bare flex-none"
            style={BTN_GHOST}
            onClick={loadManually}
          >
            {t('modelListLoad')}
          </button>
        </div>
      ) : list.isError ? (
        <div style={{ font: '400 9.5px var(--mono)', color: 'var(--muted)' }}>
          ✗ {errText(list.error)}
        </div>
      ) : (
        options.length > 0 && (
          <select
            value={current}
            onChange={(e) => onPick(e.target.value)}
            className="paper-input"
            style={{ font: '500 11px var(--mono)' }}
          >
            {!current && <option value="">{t('modelPick')}</option>}
            {options.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        )
      )}
      {list.isLoading && (
        <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>…</span>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              onPick(text.trim())
              setText('')
            }
            e.stopPropagation()
          }}
          placeholder={t('modelFreeText')}
          className="paper-input flex-1"
        />
        <button
          type="button"
          className="btn-bare flex-none"
          disabled={!text.trim()}
          onClick={() => {
            onPick(text.trim())
            setText('')
          }}
          style={text.trim() ? BTN_PRIMARY : { ...BTN_GHOST, color: 'var(--faint)' }}
        >
          {t('customModelApply')}
        </button>
      </div>
      {/* Der Test schickt eine Beispiel-Mail durch den Scanner-Prompt — für Diktat unpassend */}
      {task !== 'stt' && current && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-bare flex-none"
            disabled={testing}
            onClick={runTest}
            style={BTN_GHOST}
          >
            {testing ? '···' : t('customModelTest')}
          </button>
          {result && (
            <span
              style={{
                font: '400 9.5px var(--mono)',
                color: result.ok ? 'var(--ac)' : 'var(--muted)'
              }}
            >
              {result.ok ? '✓' : `✗ ${result.detail ?? t('customModelFailed')}`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Auf Anforderung (Updates, Suchmodell) ───────────────────────────────────

export function OnDemandCard(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const { toastNow } = usePaper()
  const localOnly = useLocalOnly().data === true
  const embedding = useEmbeddingStatus()
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const checkNow = (): void => {
    setChecking(true)
    setUpdate(null)
    void invoke('updates:checkNow', undefined)
      .then((r) =>
        setUpdate(
          r.updateAvailable
            ? t('updateAvailable', { v: r.latest ?? '' })
            : (r.note ?? t('updateUpToDate'))
        )
      )
      .catch((err) => setUpdate(errText(err)))
      .finally(() => setChecking(false))
  }

  const download = (): void => {
    setDownloading(true)
    void invoke('embeddings:downloadModel', undefined)
      .then(() => toastNow(t('toastEmbedReady')))
      .catch((err) => toastNow(errText(err)))
      .finally(() => {
        setDownloading(false)
        void queryClient.invalidateQueries({ queryKey: ['ai', 'embeddings'] })
        void queryClient.invalidateQueries({ queryKey: ['search'] })
      })
  }

  const status = embedding.data
  const loading = downloading || status?.state === 'loading'
  const stateLine = !status
    ? '…'
    : status.cached && status.state !== 'error'
      ? t('embedReady', { n: status.indexed, total: status.eligible })
      : status.state === 'error'
        ? `✗ ${status.error ?? ''}`
        : localOnly
          ? t('embedMissingLocal')
          : t('embedMissing')

  return (
    <>
      <div className="mlabel" style={{ color: 'var(--ac)' }}>
        {t('onDemandHead')}
      </div>
      <div className="mmeta" style={{ marginTop: 6 }}>
        {localOnly ? t('onDemandNoteLocal') : t('onDemandNote')}
      </div>

      <div className="flex flex-wrap items-center gap-2.5" style={{ marginTop: 10 }}>
        <span className="mlabel flex-none" style={{ color: 'var(--muted)' }}>
          {t('updatesHead')}
        </span>
        <button
          type="button"
          className="btn-bare"
          disabled={checking}
          onClick={checkNow}
          style={BTN_GHOST}
        >
          {checking ? '···' : t('updateCheckBtn')}
        </button>
        {update && (
          <span style={{ font: '400 9.5px var(--mono)', color: 'var(--muted)' }}>{update}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5" style={{ marginTop: 10 }}>
        <span className="mlabel flex-none" style={{ color: 'var(--muted)' }}>
          {t('embedHead')}
        </span>
        <span style={{ font: '400 9.5px var(--mono)', color: 'var(--muted)' }}>{stateLine}</span>
        {status && !status.cached && (
          <button
            type="button"
            className="btn-bare"
            disabled={loading}
            onClick={download}
            style={localOnly ? BTN_PRIMARY : BTN_GHOST}
          >
            {loading ? t('embedDownloading') : t('embedDownload')}
          </button>
        )}
      </div>
    </>
  )
}
