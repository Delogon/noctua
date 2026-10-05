import type Database from 'better-sqlite3-multiple-ciphers'
import { migrations } from './migrations'

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
