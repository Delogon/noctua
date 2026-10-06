import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { safeStorage } from 'electron'
import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'
import {
  applyKey,
  discardPlainBackups,
  discardPlainMigrationBackup,
  isEncryptedFile,
  isPlaintextSqlite,
  migratePlaintextToEncrypted,
  openEncrypted,
  restrictPermissions
} from '@main/db/encryption'
import { loadOrCreateDbKey } from '@main/db/key'
import { runMigrations } from '@main/db/migrate'

const KEY = 'ab'.repeat(32)
let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'noctua-enc-'))
  dbPath = join(dir, 'noctua.sqlite')
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** Klartext-DB mit vollem Schema, offenem WAL und ein paar Zeilen. */
function makePlainDb(): void {
  const db = new Database(dbPath)
  sqliteVec.load(db)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  db.prepare(`INSERT INTO settings (key, value) VALUES ('probe', 'hallo')`).run()
  // WAL bewusst NICHT checkpointen: die Daten liegen noch im -wal
  expect(existsSync(dbPath + '-wal')).toBe(true)
  db.close()
}

function userVersionPlain(): number {
  const db = new Database(dbPath)
  try {
    return db.pragma('user_version', { simple: true }) as number
  } finally {
    db.close()
  }
}

describe('Schlüsselverwaltung', () => {
  it('erzeugt beim ersten Start 32 Zufallsbytes, verschlüsselt mit safeStorage, Modus 0600', () => {
    const keyPath = join(dir, 'noctua.dbkey')
    const hex = loadOrCreateDbKey(keyPath, true)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    const stored = readFileSync(keyPath)
    // Mock-safeStorage stellt "enc:" voran; im Klartext darf der Hex-Key nie stehen,
    // die Datei muss über safeStorage laufen.
    expect(stored.subarray(0, 4).toString()).toBe('enc:')
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    // Zweiter Aufruf liefert denselben Schlüssel
    expect(loadOrCreateDbKey(keyPath, false)).toBe(hex)
  })

  it('schlägt geschlossen fehl, wenn safeStorage fehlt (kein Klartext-Fallback)', () => {
    vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(false)
    const keyPath = join(dir, 'noctua.dbkey')
    expect(() => loadOrCreateDbKey(keyPath, true)).toThrow(/Schlüsselablage|keychain/)
    expect(existsSync(keyPath)).toBe(false)
  })

  it('erzeugt keinen neuen Schlüssel, wenn eine verschlüsselte DB ohne Schlüsseldatei existiert', () => {
    expect(() => loadOrCreateDbKey(join(dir, 'noctua.dbkey'), false)).toThrow(/fehlt/)
  })

  it('meldet eine nicht entschlüsselbare Schlüsseldatei klar', () => {
    const keyPath = join(dir, 'noctua.dbkey')
    writeFileSync(keyPath, Buffer.from('enc:kein-hex'))
    expect(() => loadOrCreateDbKey(keyPath, true)).toThrow(/ungültiges Format/)
  })
})

describe('verschlüsselte DB', () => {
  it('lädt sqlite-vec und bleibt ohne Schlüssel unlesbar', () => {
    const db = new Database(dbPath)
    applyKey(db, KEY)
    sqliteVec.load(db)
    db.exec('CREATE VIRTUAL TABLE v USING vec0(embedding float[2])')
    db.close()
    expect(isEncryptedFile(dbPath)).toBe(true)
    expect(readFileSync(dbPath).subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3')

    const ok = openEncrypted(dbPath, KEY)
    sqliteVec.load(ok)
    expect(ok.prepare('SELECT count(*) AS c FROM v').get()).toEqual({ c: 0 })
    // Temp-Dateien im RAM: der Codec verschlüsselt sie nicht (vuln-0014)
    expect(ok.pragma('temp_store', { simple: true })).toBe(2)
    ok.close()

    expect(() => openEncrypted(dbPath, 'cd'.repeat(32))).toThrow(/entschlüsselt/)
    const bare = new Database(dbPath)
    expect(() => bare.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow()
    bare.close()
  })

  it('VACUUM INTO (Pre-Migration-Backup) bleibt mit demselben Schlüssel verschlüsselt', () => {
    const db = new Database(dbPath)
    applyKey(db, KEY)
    db.exec('CREATE TABLE t (a); INSERT INTO t VALUES (1)')
    db.pragma('user_version = 9')
    const bak = dbPath + '.bak-v9'
    db.prepare('VACUUM INTO ?').run(bak)
    db.close()

    expect(isPlaintextSqlite(bak)).toBe(false)
    const open = openEncrypted(bak, KEY)
    expect(open.prepare('SELECT a FROM t').get()).toEqual({ a: 1 })
    expect(open.pragma('user_version', { simple: true })).toBe(9)
    open.close()
    expect(() => openEncrypted(bak, 'cd'.repeat(32))).toThrow()
  })
})

describe('Migration Klartext → verschlüsselt', () => {
  it('verschlüsselt inkl. WAL-Inhalt, behält user_version und Daten', () => {
    makePlainDb()
    const version = userVersionPlain()
    expect(isPlaintextSqlite(dbPath)).toBe(true)

    migratePlaintextToEncrypted(dbPath, KEY)

    expect(isPlaintextSqlite(dbPath)).toBe(false)
    expect(readFileSync(dbPath).subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3')
    expect(existsSync(dbPath + '-wal')).toBe(false)
    expect(existsSync(dbPath + '.encrypting')).toBe(false)
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)

    const db = openEncrypted(dbPath, KEY)
    sqliteVec.load(db)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.pragma('user_version', { simple: true })).toBe(version)
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'probe'`).get()).toEqual({
      value: 'hallo'
    })
    db.close()
    expect(() => openEncrypted(dbPath, 'cd'.repeat(32))).toThrow()
    const bare = new Database(dbPath)
    expect(() => bare.prepare('SELECT 1 FROM sqlite_master').get()).toThrow()
    bare.close()

    // Backup liegt als lesbarer Klartext bis zum ersten erfolgreichen Öffnen
    const backup = dbPath + '.plain-backup'
    expect(isPlaintextSqlite(backup)).toBe(true)
    expect(statSync(backup).mode & 0o777).toBe(0o600)
    discardPlainMigrationBackup(dbPath)
    expect(existsSync(backup)).toBe(false)
  })

  it('crash-sicher: Fehler vor dem Austausch lässt die Klartext-DB vollständig, ein Neuversuch klappt', () => {
    makePlainDb()
    const version = userVersionPlain()

    expect(() =>
      migratePlaintextToEncrypted(dbPath, KEY, {
        beforeSwap: () => {
          throw new Error('simulierter Absturz')
        }
      })
    ).toThrow('simulierter Absturz')

    // Quelle noch Klartext, vollständig, lesbar; keine Arbeitskopie übrig
    expect(isPlaintextSqlite(dbPath)).toBe(true)
    expect(existsSync(dbPath + '.encrypting')).toBe(false)
    const plain = new Database(dbPath)
    expect(plain.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(plain.pragma('user_version', { simple: true })).toBe(version)
    expect(plain.prepare(`SELECT value FROM settings WHERE key='probe'`).get()).toEqual({
      value: 'hallo'
    })
    plain.close()

    // Harter Abbruch (Arbeitskopie bleibt liegen) → nächster Start räumt auf und migriert
    writeFileSync(dbPath + '.encrypting', 'Müll eines abgebrochenen Laufs')
    migratePlaintextToEncrypted(dbPath, KEY)
    expect(isEncryptedFile(dbPath)).toBe(true)
    openEncrypted(dbPath, KEY).close()
  })

  it('verifiziert user_version/Verschlüsselung und tauscht nur bei Erfolg', () => {
    makePlainDb()
    // Falscher Key-Format → bricht vor jeder Änderung an der Quelle ab
    expect(() => migratePlaintextToEncrypted(dbPath, 'zz')).toThrow(/Schlüssel/)
    expect(isPlaintextSqlite(dbPath)).toBe(true)
  })

  it('verwirft alte Klartext-.bak-v*, behält verschlüsselte', () => {
    const plain = dbPath + '.bak-v3'
    const enc = dbPath + '.bak-v4'
    const p = new Database(plain)
    p.exec('CREATE TABLE t (a)')
    p.close()
    const e = new Database(enc)
    applyKey(e, KEY)
    e.exec('CREATE TABLE t (a)')
    e.close()

    expect(discardPlainBackups(dbPath)).toBe(1)
    expect(existsSync(plain)).toBe(false)
    expect(existsSync(enc)).toBe(true)
  })

  it('restrictPermissions setzt 0600 auf DB, Sidecars und Backups', () => {
    for (const f of ['', '-wal', '-shm', '.bak-v2']) writeFileSync(dbPath + f, 'x', { mode: 0o644 })
    restrictPermissions(dbPath)
    for (const f of ['', '-wal', '-shm', '.bak-v2'])
      expect(statSync(dbPath + f).mode & 0o777).toBe(0o600)
  })
})
