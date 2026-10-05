import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { deleteSecret, getSecret, hasSecret, setSecret } from '../../auth/secrets'
import { getDb, getSetting, setSetting } from '../../db'
import { isLocalOnly } from '../../privacy'
import { isBudgetExceeded } from '../budget'
import { OPENROUTER_DEFAULT_MODELS } from '../openrouter'
import { createChatCompletionsClient } from './chat-completions'
import { createResponsesClient } from './responses'
import {
  OPENROUTER_PROFILE_ID,
  type AiProfile,
  type AiTask,
  type ApiStyle,
  type LlmClient,
  type ResolvedTask
} from './types'

// Profil-Registry: CRUD über die Tabelle ai_profiles, Keys im Vault, und
// resolveTask() — die einzige Stelle, die entscheidet, welcher Client eine
// Aufgabe bedient (inkl. „Local only").

interface ProfileRow {
  id: string
  name: string
  base_url: string
  api_style: ApiStyle
  is_local: number
  preset: 'openrouter' | 'custom'
  managed: number
}

/** Vault-Key eines Profils; das OpenRouter-Preset behält den Upstream-Key. */
export function profileSecretKey(profile: Pick<AiProfile, 'id' | 'preset'>): string {
  return profile.preset === 'openrouter' ? 'openrouter.apiKey' : `ai.profile.${profile.id}.apiKey`
}

function toProfile(row: ProfileRow): AiProfile {
  const base = { id: row.id, preset: row.preset }
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiStyle: row.api_style,
    isLocal: row.is_local === 1,
    preset: row.preset,
    managed: row.managed === 1,
    hasKey: hasSecret(profileSecretKey(base))
  }
}

export function listProfiles(db: Database.Database = getDb()): AiProfile[] {
  return (
    db
      .prepare('SELECT * FROM ai_profiles ORDER BY sort_order, created_at, id')
      .all() as ProfileRow[]
  ).map(toProfile)
}

export function getProfile(id: string, db: Database.Database = getDb()): AiProfile | null {
  const row = db.prepare('SELECT * FROM ai_profiles WHERE id = ?').get(id) as ProfileRow | undefined
  return row ? toProfile(row) : null
}

export interface ProfileInput {
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  isLocal: boolean
}

/** Basis-URL normalisieren: nur http(s), ohne Slash am Ende. Wirft bei Unsinn. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('Ungültige Basis-URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Basis-URL muss mit http:// oder https:// beginnen')
  }
  return url.toString().replace(/\/+$/, '')
}

function cleanName(raw: string): string {
  const name = raw.trim().slice(0, 60)
  if (!name) throw new Error('Name fehlt')
  return name
}

export function createProfile(input: ProfileInput, db: Database.Database = getDb()): AiProfile {
  const id = `p_${randomUUID().replace(/-/g, '').slice(0, 10)}`
  const { n } = db
    .prepare('SELECT coalesce(max(sort_order), 0) + 1 AS n FROM ai_profiles')
    .get() as {
    n: number
  }
  db.prepare(
    `INSERT INTO ai_profiles (id, name, base_url, api_style, is_local, preset, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 'custom', ?, ?)`
  ).run(
    id,
    cleanName(input.name),
    normalizeBaseUrl(input.baseUrl),
    input.apiStyle,
    input.isLocal ? 1 : 0,
    n,
    Date.now()
  )
  return getProfile(id, db)!
}

/**
 * Profil ändern. Beim OpenRouter-Preset sind nur Name und lokal-Flag fix bzw.
 * unveränderlich: URL und API-Stil gehören zum Preset (Header, ZDR, Katalog).
 * Von der Organisation bereitgestellte Profile (managed) sind komplett gesperrt;
 * nur der Key (setProfileKey) bleibt änderbar.
 */
export function updateProfile(
  id: string,
  patch: Partial<ProfileInput>,
  db: Database.Database = getDb()
): AiProfile {
  const current = getProfile(id, db)
  if (!current) throw new Error('Anbieter nicht gefunden')
  const builtin = current.preset === 'openrouter'
  if (current.managed) return current
  const next = {
    name: patch.name !== undefined ? cleanName(patch.name) : current.name,
    baseUrl:
      !builtin && patch.baseUrl !== undefined ? normalizeBaseUrl(patch.baseUrl) : current.baseUrl,
    apiStyle: !builtin && patch.apiStyle !== undefined ? patch.apiStyle : current.apiStyle,
    isLocal: !builtin && patch.isLocal !== undefined ? patch.isLocal : current.isLocal
  }
  db.prepare(
    'UPDATE ai_profiles SET name = ?, base_url = ?, api_style = ?, is_local = ? WHERE id = ?'
  ).run(next.name, next.baseUrl, next.apiStyle, next.isLocal ? 1 : 0, id)
  clientCache.delete(id)
  return getProfile(id, db)!
}

/** Löscht ein eigenes Profil samt Key; Aufgaben darauf fallen auf OpenRouter zurück. */
export function deleteProfile(id: string, db: Database.Database = getDb()): void {
  const current = getProfile(id, db)
  if (!current) return
  if (current.preset === 'openrouter')
    throw new Error('Der OpenRouter-Anbieter kann nicht gelöscht werden')
  if (current.managed)
    throw new Error('Ein von der Organisation bereitgestellter Anbieter kann nicht gelöscht werden')
  db.transaction(() => {
    for (const task of TASKS) {
      if (getTaskProfileId(task) === id) {
        if (task === 'decision') {
          // Entscheidungen sind optional: ohne Profil einfach aus
          db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(
            profileKey(task),
            modelKey(task)
          )
          continue
        }
        setSetting(profileKey(task), OPENROUTER_PROFILE_ID)
        // Modell gehörte zum gelöschten Profil — OpenRouter-Default greift wieder
        db.prepare('DELETE FROM settings WHERE key = ?').run(modelKey(task))
      }
    }
    db.prepare('DELETE FROM ai_profiles WHERE id = ?').run(id)
  })()
  deleteSecret(profileSecretKey(current))
  clientCache.delete(id)
}

export function setProfileKey(id: string, key: string): void {
  const profile = getProfile(id)
  if (!profile) throw new Error('Anbieter nicht gefunden')
  setSecret(profileSecretKey(profile), key)
  clientCache.delete(id)
}

export function clearProfileKey(id: string): void {
  const profile = getProfile(id)
  if (!profile) throw new Error('Anbieter nicht gefunden')
  deleteSecret(profileSecretKey(profile))
  clientCache.delete(id)
}

// --- Aufgaben-Zuordnung -------------------------------------------------------

export const TASKS: readonly AiTask[] = ['triage', 'draft', 'stt', 'decision']

function profileKey(task: AiTask): string {
  return `ai.${task}Profile`
}
function modelKey(task: AiTask): string {
  return `ai.${task}Model`
}

/**
 * Profil-ID einer Aufgabe. Triage kennt zusätzlich die Pseudo-ID 'apple'
 * (On-Device-Modell, Legacy-Setting ai.triageProvider); 'apple' gilt später auch
 * für stt. Solche Pseudo-Profile liefert resolveTask() nicht — die Aufrufer
 * behandeln sie vorher selbst.
 */
export function getTaskProfileId(task: AiTask): string {
  // Entscheidungen sind optional: nicht gesetzt = leere ID (kein Standard-Profil)
  if (task === 'decision') return getSetting(profileKey(task))?.trim() ?? ''
  if (task === 'triage' && getSetting('ai.triageProvider') === 'apple') return 'apple'
  const id = getSetting(profileKey(task))?.trim() || OPENROUTER_PROFILE_ID
  // stt: Apple-Spracherkennung als Pseudo-Profil (ai.sttProfile = 'apple')
  return task === 'stt' && id === 'apple' ? 'apple' : id
}

/** Modell der Aufgabe: ausdrücklich gesetzt, sonst nur beim OpenRouter-Profil ein Default. */
export function getTaskModel(task: AiTask, profile: Pick<AiProfile, 'preset'>): string | null {
  const configured = getSetting(modelKey(task))?.trim()
  if (configured) return configured
  if (task === 'decision') return null
  return profile.preset === 'openrouter' ? OPENROUTER_DEFAULT_MODELS[task] : null
}

export function setTaskAssignment(task: AiTask, profileId: string, model: string): void {
  if (task === 'decision') {
    if (!profileId) {
      // „Aus": Zuordnung entfernen
      getDb()
        .prepare('DELETE FROM settings WHERE key IN (?, ?)')
        .run(profileKey(task), modelKey(task))
      return
    }
    const target = getProfile(profileId)
    if (!target) throw new Error('Anbieter nicht gefunden')
    if (target.preset === 'openrouter') {
      throw new Error(
        'Entscheidungsmodelle laufen nur auf lokalen Ollama-Servern, nicht über OpenRouter'
      )
    }
    setSetting(profileKey(task), profileId)
    setSetting(modelKey(task), model.trim())
    return
  }
  if (profileId !== 'apple' && !getProfile(profileId)) throw new Error('Anbieter nicht gefunden')
  if (profileId === 'apple' && task === 'draft') {
    throw new Error('Apple On-Device ist nur für Vorsortierung und Diktat verfügbar')
  }
  if (task === 'triage') {
    setSetting('ai.triageProvider', profileId === 'apple' ? 'apple' : 'openrouter')
  }
  if (task === 'stt' && profileId === 'apple') {
    setSetting(profileKey(task), 'apple')
  } else if (profileId !== 'apple') {
    setSetting(profileKey(task), profileId)
    setSetting(modelKey(task), model.trim())
  }
}

export type BlockReason = 'local-only' | 'no-key' | 'no-profile' | 'no-model'

function buildClient(profile: AiProfile, apiKey: string | null): LlmClient {
  return profile.apiStyle === 'responses'
    ? createResponsesClient({ profile, apiKey })
    : createChatCompletionsClient({ profile, apiKey })
}

const clientCache = new Map<string, { signature: string; client: LlmClient }>()

/** Client pro Profil+Key cachen; Änderungen an URL/Stil/Key bauen ihn neu. */
export function getClient(profile: AiProfile): LlmClient {
  const apiKey = getSecret(profileSecretKey(profile))
  const signature = [profile.baseUrl, profile.apiStyle, profile.preset, apiKey ?? ''].join('\n')
  const cached = clientCache.get(profile.id)
  if (cached && cached.signature === signature) return cached.client
  const client = buildClient(profile, apiKey)
  clientCache.set(profile.id, { signature, client })
  return client
}

/** Warum eine Aufgabe gerade nicht laufen kann — null, wenn sie läuft. */
export function taskBlockReason(task: AiTask): BlockReason | null {
  const profile = getProfile(getTaskProfileId(task))
  if (!profile) return 'no-profile'
  if (isLocalOnly() && !profile.isLocal) return 'local-only'
  // OpenRouter ist ohne Key nutzlos; lokale/eigene Server dürfen keylos sein
  if (profile.preset === 'openrouter' && !profile.hasKey) return 'no-key'
  if (!getTaskModel(task, profile)) return 'no-model'
  return null
}

/** Client + Modell + Profil der Aufgabe, oder null (Local only, kein Key, kein Modell). */
export function resolveTask(task: AiTask): ResolvedTask | null {
  if (taskBlockReason(task) !== null) return null
  const profile = getProfile(getTaskProfileId(task))!
  return { client: getClient(profile), model: getTaskModel(task, profile)!, profile }
}

const TASK_LABEL: Record<AiTask, string> = {
  triage: 'Vorsortierung',
  draft: 'Entwürfe',
  stt: 'Diktat',
  decision: 'Entscheidungen'
}

/**
 * Entscheidungsmodell (System One) oder null: nicht eingerichtet, Local only mit
 * externem Profil, kein Modell. Kein Chat-Client nötig – systemone.ts spricht
 * den Server direkt.
 */
export interface ResolvedDecision {
  profile: AiProfile
  model: string
  apiKey: string | null
}

export function resolveDecision(): ResolvedDecision | null {
  if (taskBlockReason('decision') !== null) return null
  const profile = getProfile(getTaskProfileId('decision'))!
  if (profile.preset === 'openrouter') return null
  return {
    profile,
    model: getTaskModel('decision', profile)!,
    apiKey: getSecret(profileSecretKey(profile))
  }
}

/** Verständliche Fehlermeldung für ein blockiertes Task (Main wirft sie an den Renderer). */
export function blockMessage(task: AiTask, reason: BlockReason): string {
  switch (reason) {
    case 'local-only':
      return `„Nur lokal“ ist aktiv – „${TASK_LABEL[task]}“ nutzt einen externen Anbieter (⌘, Einstellungen → KI)`
    case 'no-key':
      return 'Kein OpenRouter-Schlüssel hinterlegt (⌘, Einstellungen)'
    case 'no-model':
      return `Für „${TASK_LABEL[task]}“ ist kein Modell gewählt (⌘, Einstellungen → KI)`
    case 'no-profile':
      return `Für „${TASK_LABEL[task]}“ ist kein gültiger Anbieter gewählt (⌘, Einstellungen → KI)`
  }
}

/** Wie resolveTask, wirft aber mit klarer Meldung (für Aufrufer, die dem Nutzer antworten). */
export function requireTask(task: AiTask): ResolvedTask {
  const reason = taskBlockReason(task)
  if (reason) throw new Error(blockMessage(task, reason))
  return resolveTask(task)!
}

/** Budget-Gate gilt nur für externe, bepreiste Profile (OpenRouter-Preset). */
export function budgetBlocks(db: Database.Database, resolved: ResolvedTask): boolean {
  return (
    resolved.profile.preset === 'openrouter' && !resolved.profile.isLocal && isBudgetExceeded(db)
  )
}

/** Wie requireTask, prüft zusätzlich das Budget (Fehlertext wie bisher). */
export function requireTaskWithBudget(
  db: Database.Database,
  task: AiTask,
  budgetMessage = 'KI-Budget aufgebraucht'
): ResolvedTask {
  const resolved = requireTask(task)
  if (budgetBlocks(db, resolved)) throw new Error(budgetMessage)
  return resolved
}

/** Pausiert die Hintergrund-Triage am Budget? Apple/lokale/geblockte Profile nie. */
export function triageBudgetBlocked(db: Database.Database): boolean {
  if (getTaskProfileId('triage') === 'apple') return false
  // Mit Entscheidungsmodell läuft die Triage lokal weiter; das Budget bremst nur das Textmodell
  if (resolveDecision() !== null) return false
  const profile = getProfile(getTaskProfileId('triage'))
  if (!profile) return false
  return profile.preset === 'openrouter' && !profile.isLocal && isBudgetExceeded(db)
}
