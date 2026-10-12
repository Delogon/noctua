import type Database from 'better-sqlite3-multiple-ciphers'
import { getSetting, setSetting } from '../db'
import { hasSecret, setSecret } from './secrets'
import { accountSecretKey, PROVIDER_DEFAULTS } from './providers'
import { ACCOUNT_COLORS } from '@shared/types'
import { isDev } from '../dev-mode'

/**
 * Dev seeding via environment variables — credentials go directly into the
 * safeStorage vault, never onto disk. Runs only when the variables are
 * set, and is idempotent.
 *
 *   NOCTUA_SEED_GMAIL_USER / NOCTUA_SEED_GMAIL_PASS
 *   NOCTUA_SEED_OPENROUTER_KEY
 */
export function seedFromEnv(db: Database.Database): void {
  // Second safeguard besides the caller: never seed from the environment in a production bundle
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
