import type Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { migrations } from './migrations'

const BACKUPS_TO_KEEP = 2

/** DB comes from a newer app version — continuing would damage it. */
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
 * Backs up an existing DB before pending migrations to
 * `<db>.bak-v<version>` (VACUUM INTO: consistent, even with an open WAL) and
 * keeps only the newest backups. In-memory DBs (tests) are skipped.
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
 * Runs all pending migrations. Version state via PRAGMA user_version;
 * each migration runs in its own transaction.
 *
 * Foreign keys are off meanwhile (standard SQLite procedure for
 * table rebuilds): with active FKs, e.g. a DROP TABLE accounts would
 * drag along all folders and messages via ON DELETE CASCADE. A
 * foreign_key_check per migration ensures that integrity still holds
 * in the end — violations make the transaction fail.
 */
export function runMigrations(db: Database.Database): { from: number; to: number } {
  const from = db.pragma('user_version', { simple: true }) as number
  let current = from

  // Downgrade guard: never touch a DB from a newer version
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  if (from > latest) throw new DatabaseTooNewError(from, latest)

  // Backup only for an existing (non-empty) DB with pending migrations
  if (from > 0 && migrations.some((m) => m.version > from)) backupBeforeMigration(db, from)

  const fkWasOn = (db.pragma('foreign_keys', { simple: true }) as number) === 1
  // PRAGMA foreign_keys only takes effect outside transactions
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
