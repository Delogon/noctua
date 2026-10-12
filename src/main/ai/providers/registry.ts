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

// Profile registry: CRUD over the ai_profiles table, keys in the vault, and
// resolveTask() — the only place that decides which client serves a
// task (incl. "Local only").

interface ProfileRow {
  id: string
  name: string
  base_url: string
  api_style: ApiStyle
  is_local: number
  preset: 'openrouter' | 'custom'
  managed: number
}

/** Vault key of a profile; the OpenRouter preset keeps the upstream key. */
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

/** Normalize the base URL: http(s) only, no trailing slash. Throws on nonsense. */
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
 * Update a profile. For the OpenRouter preset only name and local flag are fixed or
 * immutable: URL and API style belong to the preset (headers, ZDR, catalog).
 * Profiles provided by the organization (managed) are fully locked;
 * only the key (setProfileKey) remains editable.
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
  // SEC: The vault key applies to the base URL it was entered for. When
  // the base URL changes it is discarded — the key never leaves the
  // main process toward another endpoint (protection against renderer-driven
  // redirection of a profiled endpoint to an attacker host).
  const nextUrl = next.baseUrl !== current.baseUrl
  if (nextUrl && current.hasKey) {
    deleteSecret(profileSecretKey(current))
    clientCache.delete(id)
  }
  db.prepare(
    'UPDATE ai_profiles SET name = ?, base_url = ?, api_style = ?, is_local = ? WHERE id = ?'
  ).run(next.name, next.baseUrl, next.apiStyle, next.isLocal ? 1 : 0, id)
  clientCache.delete(id)
  return getProfile(id, db)!
}

/** Deletes a custom profile with its key; tasks on it fall back to OpenRouter. */
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
          // Decisions are optional: without a profile simply off
          db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(
            profileKey(task),
            modelKey(task)
          )
          continue
        }
        setSetting(profileKey(task), OPENROUTER_PROFILE_ID)
        // Model belonged to the deleted profile — OpenRouter default applies again
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

// --- Task assignment ---------------------------------------------------------

export const TASKS: readonly AiTask[] = ['triage', 'draft', 'stt', 'decision']

function profileKey(task: AiTask): string {
  return `ai.${task}Profile`
}
function modelKey(task: AiTask): string {
  return `ai.${task}Model`
}

/**
 * Profile ID of a task. Triage additionally knows the pseudo ID 'apple'
 * (on-device model, legacy setting ai.triageProvider); 'apple' later also applies
 * to stt. resolveTask() doesn't return such pseudo profiles — the callers
 * handle them themselves beforehand.
 */
export function getTaskProfileId(task: AiTask): string {
  // Decisions are optional: not set = empty ID (no default profile)
  if (task === 'decision') return getSetting(profileKey(task))?.trim() ?? ''
  if (task === 'triage' && getSetting('ai.triageProvider') === 'apple') return 'apple'
  const id = getSetting(profileKey(task))?.trim() || OPENROUTER_PROFILE_ID
  // stt: Apple speech recognition as pseudo profile (ai.sttProfile = 'apple')
  return task === 'stt' && id === 'apple' ? 'apple' : id
}

/** Model of the task: explicitly set, otherwise a default only for the OpenRouter profile. */
export function getTaskModel(task: AiTask, profile: Pick<AiProfile, 'preset'>): string | null {
  const configured = getSetting(modelKey(task))?.trim()
  if (configured) return configured
  if (task === 'decision') return null
  return profile.preset === 'openrouter' ? OPENROUTER_DEFAULT_MODELS[task] : null
}

export function setTaskAssignment(task: AiTask, profileId: string, model: string): void {
  if (task === 'decision') {
    if (!profileId) {
      // "Off": remove the assignment
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

/** Cache the client per profile+key; changes to URL/style/key rebuild it. */
export function getClient(profile: AiProfile): LlmClient {
  const apiKey = getSecret(profileSecretKey(profile))
  const signature = [profile.baseUrl, profile.apiStyle, profile.preset, apiKey ?? ''].join('\n')
  const cached = clientCache.get(profile.id)
  if (cached && cached.signature === signature) return cached.client
  const client = buildClient(profile, apiKey)
  clientCache.set(profile.id, { signature, client })
  return client
}

/** Why a task can't run right now — null if it runs. */
export function taskBlockReason(task: AiTask): BlockReason | null {
  const profile = getProfile(getTaskProfileId(task))
  if (!profile) return 'no-profile'
  if (isLocalOnly() && !profile.isLocal) return 'local-only'
  // OpenRouter is useless without a key; local/custom servers may be keyless
  if (profile.preset === 'openrouter' && !profile.hasKey) return 'no-key'
  if (!getTaskModel(task, profile)) return 'no-model'
  return null
}

/** Client + model + profile of the task, or null (Local only, no key, no model). */
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
 * Decision model (System One) or null: not set up, Local only with an
 * external profile, no model. No chat client needed – systemone.ts talks to
 * the server directly.
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

/** Understandable error message for a blocked task (main throws it to the renderer). */
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

/** Like resolveTask, but throws with a clear message (for callers that answer the user). */
export function requireTask(task: AiTask): ResolvedTask {
  const reason = taskBlockReason(task)
  if (reason) throw new Error(blockMessage(task, reason))
  return resolveTask(task)!
}

/** Budget gate applies only to external, priced profiles (OpenRouter preset). */
export function budgetBlocks(db: Database.Database, resolved: ResolvedTask): boolean {
  return (
    resolved.profile.preset === 'openrouter' && !resolved.profile.isLocal && isBudgetExceeded(db)
  )
}

/** Like requireTask, additionally checks the budget (error text as before). */
export function requireTaskWithBudget(
  db: Database.Database,
  task: AiTask,
  budgetMessage = 'KI-Budget aufgebraucht'
): ResolvedTask {
  const resolved = requireTask(task)
  if (budgetBlocks(db, resolved)) throw new Error(budgetMessage)
  return resolved
}

/** Does background triage pause at the budget? Never for Apple/local/blocked profiles. */
export function triageBudgetBlocked(db: Database.Database): boolean {
  if (getTaskProfileId('triage') === 'apple') return false
  // With a decision model triage keeps running locally; the budget only throttles the text model
  if (resolveDecision() !== null) return false
  const profile = getProfile(getTaskProfileId('triage'))
  if (!profile) return false
  return profile.preset === 'openrouter' && !profile.isLocal && isBudgetExceeded(db)
}
