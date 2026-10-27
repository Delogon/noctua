import { app } from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { runMigrations } from './migrate'
import {
  discardPlainBackups,
  discardPlainMigrationBackup,
  isPlaintextSqlite,
  loadVecExtension,
  migratePlaintextToEncrypted,
  openEncrypted,
  restrictPermissions
} from './encryption'
import { DB_KEY_FILENAME, loadOrCreateDbKey } from './key'
import { configureCache, optimizeDb, stopDbMaintenance } from './optimize'

let db: Database.Database | null = null

/**
 * Opens the SQLCipher-encrypted database (key from safeStorage) and
 * migrates an existing plaintext DB along the way. If safeStorage or the
 * key is missing, the function throws — there is no plaintext fallback.
 */
export function openDb(): Database.Database {
  if (db) return db

  const userData = app.getPath('userData')
  const dbPath = join(userData, 'noctua.sqlite')
  const keyPath = join(userData, DB_KEY_FILENAME)

  // New files (DB, -wal, -shm, key, backups) readable by the owner only.
  // SQLite creates -wal/-shm with the permissions of the main file. Umask only
  // while opening, so that e.g. saved attachments stay unaffected.
  const previousUmask = process.umask(0o077)
  try {
    const exists = existsSync(dbPath) && statSync(dbPath).size > 0
    const plaintext = exists && isPlaintextSqlite(dbPath)
    // A new key may only be created without a DB or with a plaintext DB.
    const keyHex = loadOrCreateDbKey(keyPath, !exists || plaintext)

    if (plaintext) {
      console.log('[db] Klartext-Datenbank gefunden — verschlüssele …')
      migratePlaintextToEncrypted(dbPath, keyHex)
      console.log('[db] Verschlüsselung abgeschlossen')
    }

    const opened = openEncrypted(dbPath, keyHex)
    // Discard old plaintext pre-migration backups (.bak-v*) right away — the
    // rotation in migrate.ts creates encrypted ones from now on.
    discardPlainBackups(dbPath)
    let from: number
    let to: number
    try {
      // Load the vector extension BEFORE the migrations (vec0 tables need it).
      loadVecExtension(opened)
      opened.pragma('journal_mode = WAL')
      opened.pragma('synchronous = NORMAL')
      opened.pragma('foreign_keys = ON')
      configureCache(opened)
      ;({ from, to } = runMigrations(opened))
    } catch (error) {
      // Downgrade guard/migration error: release the handle so the DB file
      // stays untouched; main/index.ts shows the error in a dialog and quits.
      opened.close()
      throw error
    }
    if (from !== to) {
      console.log(`[db] migrated ${dbPath} from v${from} to v${to}`)
    }
    db = opened

    // The encrypted DB ran through once → discard the migration's plaintext
    // backup. unlink is enough; overwriting achieves nothing on APFS/SSD.
    discardPlainMigrationBackup(dbPath)
  } finally {
    process.umask(previousUmask)
  }
  restrictPermissions(dbPath)
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not opened yet — call openDb() during app startup')
  return db
}

/**
 * Test seam: sets the singleton instance to a prepared (in-memory) DB,
 * so that modules using getSetting/getDb internally run against the same DB.
 * Intended for tests only.
 */
export function __setTestDb(instance: Database.Database | null): void {
  db = instance
}

export function closeDb(): void {
  stopDbMaintenance()
  try {
    // Recommended before closing a long-lived connection: stores statistics
    // for tables whose size changed a lot during this session.
    if (db) optimizeDb(db, false)
  } catch (error) {
    console.warn('[db] optimize on close failed:', error)
  }
  db?.close()
  db = null
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}
