import { app } from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { runMigrations } from './migrate'
import {
  discardPlainLeftovers,
  isPlaintextSqlite,
  loadVecExtension,
  migratePlaintextToEncrypted,
  openEncrypted,
  restrictPermissions
} from './encryption'
import { DB_KEY_FILENAME, loadOrCreateDbKey } from './key'

let db: Database.Database | null = null

/**
 * Öffnet die SQLCipher-verschlüsselte Datenbank (Schlüssel aus safeStorage) und
 * migriert dabei eine vorhandene Klartext-DB. Fehlt safeStorage oder der
 * Schlüssel, wirft die Funktion — es gibt keinen Klartext-Fallback.
 */
export function openDb(): Database.Database {
  if (db) return db

  const userData = app.getPath('userData')
  const dbPath = join(userData, 'noctua.sqlite')
  const keyPath = join(userData, DB_KEY_FILENAME)

  // Neue Dateien (DB, -wal, -shm, Schlüssel, Backups) nur für den Besitzer lesbar.
  // SQLite legt -wal/-shm mit den Rechten der Hauptdatei an. Umask nur
  // während des Öffnens, damit z. B. gespeicherte Anhänge unberührt bleiben.
  const previousUmask = process.umask(0o077)
  try {
    const exists = existsSync(dbPath) && statSync(dbPath).size > 0
    const plaintext = exists && isPlaintextSqlite(dbPath)
    // Nur ohne DB oder bei Klartext-DB darf ein neuer Schlüssel entstehen.
    const keyHex = loadOrCreateDbKey(keyPath, !exists || plaintext)

    if (plaintext) {
      console.log('[db] Klartext-Datenbank gefunden — verschlüssele …')
      migratePlaintextToEncrypted(dbPath, keyHex)
      console.log('[db] Verschlüsselung abgeschlossen')
    }

    const opened = openEncrypted(dbPath, keyHex)
    try {
      // Vektor-Extension VOR den Migrationen laden (vec0-Tabellen brauchen sie).
      loadVecExtension(opened)
      opened.pragma('journal_mode = WAL')
      opened.pragma('synchronous = NORMAL')
      opened.pragma('foreign_keys = ON')

      const { from, to } = runMigrations(opened)
      if (from !== to) {
        console.log(`[db] migrated ${dbPath} from v${from} to v${to}`)
      }
    } catch (error) {
      opened.close()
      throw error
    }
    db = opened

    // Die verschlüsselte DB lief einmal durch → Klartext-Reste (Migrations-Backup,
    // alte .bak-v*) verwerfen. unlink genügt; Überschreiben bringt auf APFS nichts.
    discardPlainLeftovers(dbPath)
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
 * Test-Naht: setzt die Singleton-Instanz auf eine vorbereitete (In-Memory-)DB,
 * damit Module, die getSetting/getDb intern nutzen, gegen dieselbe DB laufen.
 * Ausschließlich für Tests gedacht.
 */
export function __setTestDb(instance: Database.Database | null): void {
  db = instance
}

export function closeDb(): void {
  db?.close()
  db = null
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}
