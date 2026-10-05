import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { InvokeOutput } from '@shared/ipc-contract'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import { useAppleFm, useOrKeyStatus } from '@renderer/queries/intel'
import { pickLocalModels } from '@shared/local-models'
import { suggestIsLocal } from '@shared/local-host'
import {
  aiStepCta,
  localOnlyDefault,
  type AiChoice,
  type AiStepState,
  type CloudKind
} from '@renderer/features/paper/onboarding-steps'

// Zustand und Aktionen des KI-Schritts im Onboarding („Wo soll die KI laufen?").
// Nutzt dieselben IPC-Kanäle wie Einstellungen → Intelligenz (ai:profiles:*,
// ai:tasks:*, ai:profileModels, privacy:setLocalOnly). Eingerichtet wird erst
// beim Weiter-Klick (commit) — bis dahin entstehen keine Profile außer durch
// den ausdrücklichen „Testen"-Knopf (der Test läuft gegen ein gespeichertes Profil).

type ApiStyle = 'chat' | 'responses'

/** Ein OpenAI-kompatibler Endpunkt (lokaler Server oder eigener Cloud-Endpunkt). */
export interface Endpoint {
  url: string
  key: string
  style: ApiStyle
  /** Server erreichbar und Modellliste bekannt (erkannt oder getestet) */
  verified: boolean
  models: string[]
  triage: string
  draft: string
  testing: boolean
  error: string | null
  /** Anzeigename des erkannten Servers (z. B. „Ollama") */
  label: string
}

const EMPTY_ENDPOINT: Endpoint = {
  url: '',
  key: '',
  style: 'chat',
  verified: false,
  models: [],
  triage: '',
  draft: '',
  testing: false,
  error: null,
  label: ''
}

function errText(err: unknown): string {
  return cleanIpcError(err instanceof Error ? err.message : String(err))
}

export interface EndpointApi {
  ep: Endpoint
  patch: (p: Partial<Endpoint>) => void
  edit: (p: Partial<Pick<Endpoint, 'url' | 'key' | 'style'>>) => void
  setModels: (models: string[], label?: string) => void
  test: () => Promise<void>
  ensureProfile: () => Promise<string>
}

function useEndpoint(profileName: string, autoPick: boolean): EndpointApi {
  const queryClient = useQueryClient()
  const [ep, setEp] = useState<Endpoint>(EMPTY_ENDPOINT)
  const profileId = useRef<string | null>(null)

  const patch = (p: Partial<Endpoint>): void => setEp((e) => ({ ...e, ...p }))
  /** Eingaben geändert: Verifikation und Fehler verfallen. */
  const edit = (p: Partial<Pick<Endpoint, 'url' | 'key' | 'style'>>): void =>
    setEp((e) => ({ ...e, ...p, verified: false, models: [], error: null }))

  const setModels = (models: string[], label = ''): void => {
    const picked = autoPick ? pickLocalModels(models) : { triage: '', draft: '' }
    patch({
      models,
      triage: picked.triage,
      draft: picked.draft,
      verified: true,
      error: null,
      label
    })
  }

  /** Profil anlegen bzw. aktualisieren (Name, URL, Stil, Key); liefert die Profil-ID. */
  const ensureProfile = async (): Promise<string> => {
    const fields = {
      name: ep.label || profileName,
      baseUrl: ep.url.trim(),
      apiStyle: ep.style,
      // Bestehende Heuristik wie in Einstellungen → Intelligenz
      isLocal: suggestIsLocal(ep.url.trim())
    }
    const { profile } = profileId.current
      ? await invoke('ai:profiles:update', { id: profileId.current, ...fields })
      : await invoke('ai:profiles:create', fields)
    profileId.current = profile.id
    if (ep.key.trim()) await invoke('ai:profiles:setKey', { id: profile.id, key: ep.key.trim() })
    void queryClient.invalidateQueries({ queryKey: ['ai'] })
    return profile.id
  }

  /** „Testen": Profil sichern, Verbindung prüfen, Modelle holen. */
  const test = async (): Promise<void> => {
    if (!ep.url.trim() || ep.testing) return
    patch({ testing: true, error: null })
    try {
      const id = await ensureProfile()
      const r = await invoke('ai:profiles:test', { id })
      if (!r.ok) {
        patch({ testing: false, verified: false, error: cleanIpcError(r.detail ?? '') })
        return
      }
      const list = await invoke('ai:profileModels', { profileId: id, manual: true })
      setModels(list.models.map((m) => m.id))
      patch({ testing: false })
    } catch (err) {
      patch({ testing: false, verified: false, error: errText(err) })
    }
  }

  return { ep, patch, edit, setModels, test, ensureProfile }
}

export type DictationMode = 'apple' | 'whisper' | 'none'

export interface OnboardingAi {
  choice: AiChoice
  setChoice: (c: AiChoice) => void
  localOnly: boolean
  toggleLocalOnly: () => void
  appleAvailable: boolean
  cloudKind: CloudKind
  setCloudKind: (k: CloudKind) => void
  local: EndpointApi
  custom: EndpointApi
  detect: UseQueryResult<{ found: DetectedServer[] }>
  found: DetectedServer[]
  /** baseUrl des gewählten erkannten Servers, 'manual' bei eigener Adresse */
  selectedServer: string | null
  setSelectedServer: (v: string | null) => void
  pickServer: (url: string, models: string[], label: string) => void
  kindLabel: (kind: string) => string
  dictMode: DictationMode
  setDictation: (m: DictationMode) => void
  whisperUrl: string
  setWhisperUrl: (v: string) => void
  whisperKey: string
  setWhisperKey: (v: string) => void
  whisperModel: string
  setWhisperModel: (v: string) => void
  key: string
  setKey: (v: string) => void
  keyErr: string | null
  keyBusy: boolean
  saveKey: (onSaved?: () => void) => void
  state: AiStepState
  ready: boolean
  trains: boolean
  commit: () => Promise<boolean>
  commitError: string | null
}

type DetectedServer = InvokeOutput<'ai:detectLocal'>['found'][number]

export function useOnboardingAi(active: boolean): OnboardingAi {
  const t = useT()
  const queryClient = useQueryClient()
  const appleFm = useAppleFm()
  const orStatus = useOrKeyStatus()
  const appleAvailable = appleFm.data?.state === 'available'

  const [choice, setChoiceState] = useState<AiChoice>('local')
  const [localOnly, setLocalOnlyState] = useState(true)
  const [cloudKind, setCloudKind] = useState<CloudKind>('openrouter')
  const [commitError, setCommitError] = useState<string | null>(null)

  const local = useEndpoint('Local server', true)
  const custom = useEndpoint('Cloud endpoint', false)
  // Erkannter Server, der gerade gewählt ist (baseUrl) — sonst manuelle Eingabe
  const [selectedServer, setSelectedServer] = useState<string | null>(null)

  // Diktat (optional, nur bei lokalem Server)
  const [dictation, setDictation] = useState<DictationMode | null>(null)
  const [whisperUrl, setWhisperUrl] = useState('')
  const [whisperKey, setWhisperKey] = useState('')
  const [whisperModel, setWhisperModel] = useState('whisper-1')
  const whisperProfileId = useRef<string | null>(null)
  const dictMode: DictationMode = dictation ?? (appleAvailable ? 'apple' : 'none')

  // OpenRouter-Schlüssel
  const [key, setKey] = useState('')
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keySaved, setKeySaved] = useState(false)

  // Lokale Server erkennen (nur Loopback, Main-Prozess), einmal beim Betreten des Schritts
  const detect = useQuery({
    queryKey: ['detectLocal'],
    queryFn: () => invoke('ai:detectLocal', undefined),
    enabled: active,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false
  })
  const found = detect.data?.found ?? []

  const kindLabel = (kind: string): string =>
    ({
      ollama: 'Ollama',
      lmstudio: 'LM Studio',
      llamacpp: 'llama.cpp',
      localai: t('obAiKindOther')
    })[kind] ?? kind

  const pickServer = (url: string, models: string[], label: string): void => {
    setSelectedServer(url)
    local.patch({ url, key: '' })
    local.setModels(models, label)
  }

  // Erster Treffer ist vorgewählt, solange der Nutzer noch nichts anderes gewählt hat
  // (State-Anpassung beim Rendern statt im Effect, wie React es empfiehlt.)
  const first = found[0]
  if (first && selectedServer === null && !local.ep.url) {
    pickServer(first.baseUrl, first.models, kindLabel(first.kind))
  }

  const applyLocalOnly = (value: boolean): void => {
    void invoke('privacy:setLocalOnly', { localOnly: value })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['privacy'] })
        void queryClient.invalidateQueries({ queryKey: ['ai'] })
      })
      .catch(() => {})
  }

  // Beim Betreten gilt der Standard der vorgewählten Option
  const appliedDefault = useRef(false)
  useEffect(() => {
    if (!active || appliedDefault.current) return
    appliedDefault.current = true
    applyLocalOnly(localOnlyDefault(choice))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const setChoice = (next: AiChoice): void => {
    if (next === choice) return
    setChoiceState(next)
    setCommitError(null)
    const def = localOnlyDefault(next)
    setLocalOnlyState(def)
    applyLocalOnly(def)
  }
  const toggleLocalOnly = (): void => {
    setLocalOnlyState(!localOnly)
    applyLocalOnly(!localOnly)
  }

  const saveKey = (onSaved?: () => void): void => {
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
        onSaved?.()
        void queryClient.invalidateQueries({ queryKey: ['ai'] })
      })
      .catch((err) => setKeyErr(err instanceof Error ? err.message : String(err)))
      .finally(() => setKeyBusy(false))
  }

  const state: AiStepState = {
    appleAvailable,
    localProfile: local.ep.verified,
    localTriageModel: local.ep.triage.trim(),
    localDraftModel: local.ep.draft.trim(),
    cloudKind,
    openrouterKey: keySaved || orStatus.data?.hasKey === true,
    customProfile: custom.ep.verified,
    customTriageModel: custom.ep.triage.trim(),
    customDraftModel: custom.ep.draft.trim()
  }
  const cta = aiStepCta(choice, state)

  /** Zuordnung schreiben — erst beim Weiter-Klick. Liefert false bei Fehler. */
  const commit = async (): Promise<boolean> => {
    setCommitError(null)
    try {
      if (choice === 'local') {
        const id = await local.ensureProfile()
        await invoke('ai:tasks:set', {
          task: 'triage',
          profileId: id,
          model: state.localTriageModel
        })
        await invoke('ai:tasks:set', { task: 'draft', profileId: id, model: state.localDraftModel })
        if (dictMode === 'apple' && appleAvailable) {
          await invoke('ai:tasks:set', { task: 'stt', profileId: 'apple', model: '' })
        } else if (dictMode === 'whisper' && whisperUrl.trim()) {
          const fields = {
            name: 'Whisper',
            baseUrl: whisperUrl.trim(),
            apiStyle: 'chat' as const,
            isLocal: suggestIsLocal(whisperUrl.trim())
          }
          const { profile } = whisperProfileId.current
            ? await invoke('ai:profiles:update', { id: whisperProfileId.current, ...fields })
            : await invoke('ai:profiles:create', fields)
          whisperProfileId.current = profile.id
          if (whisperKey.trim()) {
            await invoke('ai:profiles:setKey', { id: profile.id, key: whisperKey.trim() })
          }
          await invoke('ai:tasks:set', {
            task: 'stt',
            profileId: profile.id,
            model: whisperModel.trim() || 'whisper-1'
          })
        }
      } else if (choice === 'apple') {
        await invoke('ai:tasks:set', { task: 'triage', profileId: 'apple', model: '' })
      } else if (choice === 'cloud' && cloudKind === 'openrouter') {
        await invoke('ai:tasks:set', { task: 'triage', profileId: 'openrouter', model: '' })
        await invoke('ai:tasks:set', { task: 'draft', profileId: 'openrouter', model: '' })
      } else if (choice === 'cloud') {
        const id = await custom.ensureProfile()
        await invoke('ai:tasks:set', {
          task: 'triage',
          profileId: id,
          model: state.customTriageModel
        })
        await invoke('ai:tasks:set', {
          task: 'draft',
          profileId: id,
          model: state.customDraftModel
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['ai'] })
      return true
    } catch (err) {
      setCommitError(errText(err))
      return false
    }
  }

  return {
    choice,
    setChoice,
    localOnly,
    toggleLocalOnly,
    appleAvailable,
    cloudKind,
    setCloudKind,
    local,
    custom,
    detect,
    found,
    selectedServer,
    setSelectedServer,
    pickServer,
    kindLabel,
    dictMode,
    setDictation,
    whisperUrl,
    setWhisperUrl,
    whisperKey,
    setWhisperKey,
    whisperModel,
    setWhisperModel,
    key,
    setKey: (v: string) => {
      setKey(v)
      setKeyErr(null)
    },
    keyErr,
    keyBusy,
    saveKey,
    state,
    ready: cta.enabled,
    trains: cta.train,
    commit,
    commitError
  }
}
