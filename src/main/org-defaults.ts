import type Database from 'better-sqlite3-multiple-ciphers'
import type { OrgConfig } from '@shared/org-config'
import { getDb, getSetting, setSetting } from './db'
import { normalizeBaseUrl, setTaskAssignment } from './ai/providers/registry'
import { TASKS } from './ai/providers/registry'
import { getOrgConfig } from './org-config'
import { LOCAL_ONLY_KEY } from './privacy'

// Org-Defaults und Profil-Seeding beim Start. Grundregel: nie eine Nutzerwahl
// überschreiben — Defaults gelten nur, solange der Schlüssel NICHT gesetzt ist.

/** Org-Default für `ai_enabled` bei neuen Konten (Upstream: an). */
export function defaultAiEnabledForNewAccounts(config: OrgConfig | null = getOrgConfig()): 0 | 1 {
  return config?.defaults?.aiEnabledForNewAccounts === false ? 0 : 1
}

/** 'auto' folgt der Systemsprache (de → de, sonst en). */
export function resolveLanguageDefault(
  language: 'de' | 'en' | 'auto',
  systemLocale: string
): 'de' | 'en' {
  if (language !== 'auto') return language
  return systemLocale.toLowerCase().startsWith('de') ? 'de' : 'en'
}

/** Setzt Einstellungen aus `defaults`, sofern noch nicht vorhanden. */
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
    // '1' lädt Remote-Bilder, '0' blockiert (siehe Datenschutz-Einstellung)
    setIfUnset('mail.remoteImagesDefault', defaults.remoteImagesDefault === 'allow' ? '1' : '0')
  }
  if (defaults.language !== undefined) {
    setIfUnset('ui.language', resolveLanguageDefault(defaults.language, systemLocale))
  }
}

/**
 * Legt die Profile der Organisation an (managed = 1) und hält URL/Stil/Name/
 * lokal-Flag bestehender managed-Profile synchron. Idempotent. Aufgaben
 * (`tasks`) werden nur beim allerersten Anlegen eines Profils zugewiesen —
 * spätere Nutzerwahl bleibt unangetastet. Eigene Profile des Nutzers mit
 * gleicher ID werden nie angefasst.
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

/** Beides in der Startreihenfolge: Defaults, dann Profile (Aufgaben brauchen die Profile). */
export function applyOrgConfig(db: Database.Database, systemLocale: string): void {
  applyOrgDefaults(systemLocale)
  seedOrgProfiles(db)
}
