import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'
import { runMigrations } from '@main/db/migrate'
import { __setTestDb } from '@main/db'
import { setSecret } from '@main/auth/secrets'

/**
 * Frische In-Memory-DB mit vollem Schema (alle Migrationen + sqlite-vec).
 * Wird zugleich als Singleton injiziert, damit getSetting/getDb-Nutzer
 * (z. B. tasks-Repo, budget) gegen dieselbe DB laufen.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  sqliteVec.load(db)
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  __setTestDb(db)
  return db
}

export function closeTestDb(db: Database.Database): void {
  __setTestDb(null)
  db.close()
}

let accountSeq = 0

/** Legt ein Test-Konto an und gibt dessen id zurück. */
export function seedAccount(
  db: Database.Database,
  overrides: Partial<{ email: string; provider: string; color: string; createdAt: number }> = {}
): number {
  accountSeq += 1
  const result = db
    .prepare(
      `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
        imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at)
       VALUES (?, ?, NULL, ?, 'password', 'imap.test', 993, 'smtp.test', 465, 1, ?, ?)`
    )
    .run(
      overrides.email ?? `user${accountSeq}@test.de`,
      `Testkonto ${accountSeq}`,
      overrides.provider ?? 'imap',
      overrides.color ?? '#7c7ff2',
      // Vor den makeEnvelope-Defaults (Nov 2023): Test-Mails gelten als
      // nach der Konto-Einrichtung angekommen, außer ein Test will es anders.
      overrides.createdAt ?? 1_600_000_000_000
    )
  return Number(result.lastInsertRowid)
}

/** Legt einen Ordner mit special_use an und gibt dessen id zurück. */
export function seedFolder(
  db: Database.Database,
  accountId: number,
  specialUse: string,
  path = specialUse.replace('\\', '')
): number {
  const result = db
    .prepare(
      `INSERT INTO folders (account_id, path, special_use, sync_mode) VALUES (?, ?, ?, 'full')`
    )
    .run(accountId, path, specialUse)
  return Number(result.lastInsertRowid)
}

import type { EnvelopeData } from '@main/mail/ingest'

/** Baut ein EnvelopeData mit vernünftigen Defaults; overrides überschreiben. */
export function makeEnvelope(over: Partial<EnvelopeData> = {}): EnvelopeData {
  return {
    uid: 1,
    gmMsgid: null,
    gmThrid: null,
    messageId: '<m@test>',
    inReplyTo: null,
    references: [],
    subject: 'Betreff',
    fromAddr: 'alice@test.de',
    fromName: 'Alice',
    to: [{ name: 'Bob', address: 'bob@test.de' }],
    cc: [],
    replyTo: [],
    date: 1_700_000_000_000,
    internalDate: 1_700_000_000_000,
    size: 1000,
    flags: new Set<string>(),
    hasAttachments: false,
    listUnsubscribe: false,
    listUnsubscribeUrl: null,
    listUnsubscribePost: false,
    ...over
  }
}

/**
 * Wie createTestDb, aber mit hinterlegtem OpenRouter-Key — der Resolver
 * (providers/registry) gibt sonst keinen Client heraus. Gedacht für Tests, die
 * `@main/ai/providers/openai-factory` mocken.
 */
export function createAiTestDb(): Database.Database {
  const db = createTestDb()
  setSecret('openrouter.apiKey', 'test-key')
  return db
}
