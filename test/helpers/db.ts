import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'
import { runMigrations } from '@main/db/migrate'
import { __setTestDb } from '@main/db'
import { setSecret } from '@main/auth/secrets'

/**
 * Fresh in-memory DB with full schema (all migrations + sqlite-vec).
 * Also injected as the singleton so that getSetting/getDb users
 * (e.g. tasks repo, budget) run against the same DB.
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

/** Creates a test account and returns its id. */
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
      // Before the makeEnvelope defaults (Nov 2023): test mails count as
      // arrived after account setup, unless a test wants otherwise.
      overrides.createdAt ?? 1_600_000_000_000
    )
  return Number(result.lastInsertRowid)
}

/** Creates a folder with special_use and returns its id. */
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

/** Builds an EnvelopeData with sensible defaults; overrides take precedence. */
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
 * Like createTestDb, but with a stored OpenRouter key — otherwise the resolver
 * (providers/registry) hands out no client. Intended for tests that
 * mock `@main/ai/providers/openai-factory`.
 */
export function createAiTestDb(): Database.Database {
  const db = createTestDb()
  setSecret('openrouter.apiKey', 'test-key')
  return db
}
