import type Database from 'better-sqlite3-multiple-ciphers'
import type { OrgConfig } from '@shared/org-config'
import { getDb, getSetting, setSetting } from './db'
import { normalizeBaseUrl, setTaskAssignment } from './ai/providers/registry'
import { TASKS } from './ai/providers/registry'
import { getOrgConfig } from './org-config'
import { LOCAL_ONLY_KEY } from './privacy'

// Org defaults and profile seeding at startup. Ground rule: never override a user
// choice — defaults only apply as long as the key is NOT set.

/** Org default for `ai_enabled` on new accounts (upstream: on). */
export function defaultAiEnabledForNewAccounts(config: OrgConfig | null = getOrgConfig()): 0 | 1 {
  return config?.defaults?.aiEnabledForNewAccounts === false ? 0 : 1
}

/** 'auto' follows the system language (de → de, otherwise en). */
export function resolveLanguageDefault(
  language: 'de' | 'en' | 'auto',
  systemLocale: string
): 'de' | 'en' {
  if (language !== 'auto') return language
  return systemLocale.toLowerCase().startsWith('de') ? 'de' : 'en'
}

/** Applies settings from `defaults` unless already present. */
export function applyOrgDefaults(
  systemLocale: string,
  config: OrgConfig | null = getOrgConfig()
): void {
  const defaults = config?.defaults
  if (!defaults) return
  const setIfUnset = (key: string, value: string): void => {
    if (getSetting(key) === null) setSetting(key, value)
  }
  if (defaults.localOnly !== undefined) setIfUnset(LOCAL_ONLY_KEY, defaults.localOnly ? '1' : '0')
  if (defaults.remoteImagesDefault !== undefined) {
    // '1' loads remote images, '0' blocks (see privacy setting)
    setIfUnset('mail.remoteImagesDefault', defaults.remoteImagesDefault === 'allow' ? '1' : '0')
  }
  if (defaults.language !== undefined) {
    setIfUnset('ui.language', resolveLanguageDefault(defaults.language, systemLocale))
  }
}

/**
 * Creates the organization's profiles (managed = 1) and keeps URL/style/name/
 * local flag of existing managed profiles in sync. Idempotent. Tasks
 * (`tasks`) are assigned only when a profile is first created —
 * later user choices stay untouched. The user's own profiles with the
 * same ID are never touched.
 */
export function seedOrgProfiles(
  db: Database.Database = getDb(),
  config: OrgConfig | null = getOrgConfig()
): void {
  const profiles = config?.aiProfiles
  if (!profiles?.length) return
  const find = db.prepare('SELECT managed FROM ai_profiles WHERE id = ?')
  const insert = db.prepare(
    `INSERT INTO ai_profiles (id, name, base_url, api_style, is_local, preset, managed, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 'custom', 1,
             (SELECT coalesce(max(sort_order), 0) + 1 FROM ai_profiles), ?)`
  )
  const sync = db.prepare(
    'UPDATE ai_profiles SET name = ?, base_url = ?, api_style = ?, is_local = ? WHERE id = ? AND managed = 1'
  )
  const created: typeof profiles = []
  db.transaction(() => {
    for (const p of profiles) {
      const row = find.get(p.id) as { managed: number } | undefined
      const baseUrl = normalizeBaseUrl(p.baseUrl)
      if (!row) {
        insert.run(p.id, p.name, baseUrl, p.apiStyle, p.isLocal ? 1 : 0, Date.now())
        created.push(p)
      } else if (row.managed === 1) {
        sync.run(p.name, baseUrl, p.apiStyle, p.isLocal ? 1 : 0, p.id)
      }
    }
  })()
  for (const p of created) {
    for (const task of TASKS) {
      const model = p.tasks?.[task]
      if (model) setTaskAssignment(task, p.id, model)
    }
  }
}

/** Both in startup order: defaults, then profiles (tasks need the profiles). */
export function applyOrgConfig(db: Database.Database, systemLocale: string): void {
  applyOrgDefaults(systemLocale)
  seedOrgProfiles(db)
}
