import type Database from 'better-sqlite3'
import { getSetting, setSetting } from '../db'
import { hasSecret, setSecret } from './secrets'
import { accountSecretKey, PROVIDER_DEFAULTS } from './providers'
import { ACCOUNT_COLORS } from '@shared/types'
import { isDev } from '../dev-mode'

/**
 * Dev-Seeding über Umgebungsvariablen — Credentials landen direkt im
 * safeStorage-Vault, nie auf der Platte. Läuft nur, wenn die Variablen
 * gesetzt sind, und ist idempotent.
 *
 *   NOCTUA_SEED_GMAIL_USER / NOCTUA_SEED_GMAIL_PASS
 *   NOCTUA_SEED_OPENROUTER_KEY
 */
export function seedFromEnv(db: Database.Database): void {
  // Zweite Absicherung neben dem Aufrufer: im Produktions-Bundle nie aus der Umgebung seeden
  if (!isDev) return
  const gmailUser = process.env.NOCTUA_SEED_GMAIL_USER?.trim().toLowerCase()
  const gmailPass = process.env.NOCTUA_SEED_GMAIL_PASS?.replace(/\s+/g, '')
  if (gmailUser && gmailPass) {
    const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(gmailUser) as
      { id: number } | undefined
    if (!existing) {
      const g = PROVIDER_DEFAULTS.gmail
      const count = (db.prepare('SELECT count(*) AS c FROM accounts').get() as { c: number }).c
      const result = db
        .prepare(
          `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
            imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at)
           VALUES (?, ?, NULL, 'gmail', 'password', ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          gmailUser,
          `Gmail ${count + 1}`,
          g.imapHost,
          g.imapPort,
          g.smtpHost,
          g.smtpPort,
          ACCOUNT_COLORS[count % ACCOUNT_COLORS.length],
          Date.now()
        )
      setSecret(accountSecretKey(Number(result.lastInsertRowid)), gmailPass)
      console.log(`[seed] Gmail-Konto ${gmailUser} angelegt`)
    }
  }

  const openrouterKey = process.env.NOCTUA_SEED_OPENROUTER_KEY?.trim()
  if (openrouterKey && !hasSecret('openrouter.apiKey')) {
    setSecret('openrouter.apiKey', openrouterKey)
    console.log('[seed] OpenRouter-Key im Vault abgelegt')
  }

  if (getSetting('ai.triageModel') === null)
    setSetting('ai.triageModel', 'deepseek/deepseek-v4-flash')
  if (getSetting('ai.draftModel') === null) setSetting('ai.draftModel', 'anthropic/claude-opus-4.8')
}
