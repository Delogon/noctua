import type Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { migrations } from './migrations'

const BACKUPS_TO_KEEP = 2

/** DB stammt von einer neueren App-Version — Weiterarbeiten würde sie beschädigen. */
export class DatabaseTooNewError extends Error {
  constructor(
    readonly dbVersion: number,
    readonly appVersion: number
  ) {
    super(
      `Die Datenbank hat Schema-Version ${dbVersion}, diese App-Version kennt nur bis ${appVersion}. ` +
        'Bitte die neuere Noctua-Version starten (ein Downgrade ist nicht möglich).'
    )
    this.name = 'DatabaseTooNewError'
  }
}

/**
 * Sichert eine bestehende DB vor ausstehenden Migrationen nach
 * `<db>.bak-v<version>` (VACUUM INTO: konsistent, auch bei offenem WAL) und
 * behält nur die neuesten Backups. In-Memory-DBs (Tests) werden übersprungen.
 */
export function backupBeforeMigration(db: Database.Database, version: number): string | null {
  const dbPath = db.name
  if (!dbPath || dbPath === ':memory:' || !existsSync(dbPath)) return null
  const target = `${dbPath}.bak-v${version}`
  rmSync(target, { force: true })
  db.prepare('VACUUM INTO ?').run(target)

  const prefix = `${basename(dbPath)}.bak-v`
  const dir = dirname(dbPath)
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const old of backups.slice(BACKUPS_TO_KEEP)) rmSync(old.path, { force: true })
  return target
}

/**
 * Führt alle ausstehenden Migrationen aus. Versionsstand via PRAGMA user_version;
 * jede Migration läuft in einer eigenen Transaktion.
 *
 * Foreign Keys sind währenddessen aus (SQLite-Standardverfahren für
 * Tabellen-Neubauten): Mit aktiven FKs würde z. B. ein DROP TABLE accounts
 * über ON DELETE CASCADE sämtliche Ordner und Nachrichten mitreißen. Ein
 * foreign_key_check je Migration stellt sicher, dass die Integrität am Ende
 * trotzdem stimmt — Verstöße lassen die Transaktion platzen.
 */
export function runMigrations(db: Database.Database): { from: number; to: number } {
  const from = db.pragma('user_version', { simple: true }) as number
  let current = from

  // Downgrade-Guard: eine DB aus einer neueren Version nie anfassen
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  if (from > latest) throw new DatabaseTooNewError(from, latest)

  // Backup nur bei bestehender (nicht leerer) DB mit ausstehenden Migrationen
  if (from > 0 && migrations.some((m) => m.version > from)) backupBeforeMigration(db, from)

  const fkWasOn = (db.pragma('foreign_keys', { simple: true }) as number) === 1
  // PRAGMA foreign_keys wirkt nur außerhalb von Transaktionen
  db.pragma('foreign_keys = OFF')
  try {
    for (const migration of migrations) {
      if (migration.version <= current) continue
      db.transaction(() => {
        db.exec(migration.sql)
        const violations = db.pragma('foreign_key_check') as unknown[]
        if (violations.length > 0) {
          throw new Error(
            `Migration ${migration.name} verletzt Fremdschlüssel (${violations.length} Zeilen)`
          )
        }
        db.pragma(`user_version = ${migration.version}`)
      })()
      current = migration.version
    }
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }

  return { from, to: current }
}
