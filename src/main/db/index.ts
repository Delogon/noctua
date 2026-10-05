import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { runMigrations } from './migrate'

let db: Database.Database | null = null

export function openDb(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'noctua.sqlite')
  db = new Database(dbPath)
  // Vektor-Extension VOR den Migrationen laden (vec0-Tabellen brauchen sie).
  // In der verpackten App liegt die dylib in app.asar.unpacked — SQLites
  // natives dlopen kennt Electrons asar-Umleitung nicht, Pfad selbst umbiegen.
  db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  const { from, to } = runMigrations(db)
  if (from !== to) {
    console.log(`[db] migrated ${dbPath} from v${from} to v${to}`)
  }
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
