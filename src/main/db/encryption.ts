import {
  chmodSync,
  closeSync,
  copyFileSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync
} from 'fs'
import { basename, dirname, join } from 'path'
import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'

/**
 * SQLCipher-Verschlüsselung der Mail-Datenbank (PRV-5).
 *
 * Treiber: better-sqlite3-multiple-ciphers (SQLite3MultipleCiphers). Der Cipher
 * `sqlcipher` mit `legacy=4` entspricht dem SQLCipher-4-Format (AES-256-CBC,
 * HMAC-SHA512, 4096er Seiten, 256000 KDF-Iterationen — beim Raw-Key ohne KDF) und
 * ist damit mit dem sqlcipher-CLI lesbar.
 *
 * Dieses Modul kennt weder Electron noch safeStorage: der Schlüssel kommt als
 * 64-stelliger Hex-String herein (siehe key.ts). So bleibt alles gegen
 * Temp-Dateien testbar.
 */

const SQLITE_MAGIC = 'SQLite format 3\0'
const KEY_HEX = /^[0-9a-f]{64}$/

/** Dateiendungen, die SQLite neben der Hauptdatei anlegt. */
const SIDECARS = ['-wal', '-shm', '-journal'] as const

/** Dateiname des Klartext-Backups während der Migration (siehe migratePlaintextToEncrypted). */
export const PLAIN_BACKUP_SUFFIX = '.plain-backup'
const MIGRATION_TMP_SUFFIX = '.encrypting'

export class DbKeyError extends Error {}

/** true, wenn die Datei mit dem SQLite-Klartext-Header beginnt. */
export function isPlaintextSqlite(file: string): boolean {
  return readHeader(file) === SQLITE_MAGIC
}

/** Existiert, ist nicht leer und hat KEINEN Klartext-Header → verschlüsselt (oder fremd). */
export function isEncryptedFile(file: string): boolean {
  if (!existsSync(file) || statSync(file).size === 0) return false
  return !isPlaintextSqlite(file)
}

function readHeader(file: string): string | null {
  if (!existsSync(file)) return null
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(16)
    const n = readSync(fd, buf, 0, 16, 0)
    return n === 16 ? buf.toString('latin1') : null
  } finally {
    closeSync(fd)
  }
}

/**
 * Cipher-Konfiguration + Schlüssel — MUSS die allererste Anweisung nach dem
 * Öffnen sein (vor jedem anderen PRAGMA/Query). Reihenfolge laut
 * SQLite3MultipleCiphers: erst cipher + Parameter, dann key. Der Schlüssel wird
 * als Raw-Key (`x'…'`, 32 Byte) übergeben und braucht keine KDF.
 */
export function applyKey(db: Database.Database, keyHex: string): void {
  if (!KEY_HEX.test(keyHex)) throw new DbKeyError('Ungültiger Datenbank-Schlüssel')
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
  db.pragma(`key = "x'${keyHex}'"`)
}

/** Wie applyKey, aber für `rekey` (Verschlüsseln einer Klartext-DB bzw. Schlüsselwechsel). */
function applyRekey(db: Database.Database, keyHex: string): void {
  if (!KEY_HEX.test(keyHex)) throw new DbKeyError('Ungültiger Datenbank-Schlüssel')
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
  db.pragma(`rekey = "x'${keyHex}'"`)
}

/**
 * Lädt sqlite-vec. In der verpackten App liegt die dylib in app.asar.unpacked —
 * SQLites natives dlopen kennt Electrons asar-Umleitung nicht.
 */
export function loadVecExtension(db: Database.Database): void {
  db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked'))
}

/**
 * Öffnet eine verschlüsselte DB und prüft den Schlüssel sofort. Ein falscher
 * Schlüssel fällt sonst erst bei der ersten echten Abfrage mit „file is not a
 * database" auf.
 */
export function openEncrypted(file: string, keyHex: string): Database.Database {
  const db = new Database(file)
  try {
    applyKey(db, keyHex)
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch (error) {
    db.close()
    throw new DbKeyError(
      `Datenbank konnte nicht entschlüsselt werden (falscher oder fehlender Schlüssel?): ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return db
}

function unlinkQuiet(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    // nicht vorhanden — gewollt
  }
}

function removeSidecars(file: string): void {
  for (const s of SIDECARS) unlinkQuiet(file + s)
}

/** Kopie, die auf APFS/btrfs per Clone fast nichts kostet, sonst normal kopiert. */
function copyPrivate(src: string, dest: string): void {
  unlinkQuiet(dest)
  copyFileSync(src, dest, fsConstants.COPYFILE_FICLONE)
  chmodSync(dest, 0o600)
}

function fsyncFile(file: string): void {
  const fd = openSync(file, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  } catch {
    // Verzeichnis-fsync ist auf manchen Plattformen nicht möglich — best effort
  }
}

export interface MigrationHooks {
  /** Test-Naht: wird unmittelbar vor dem atomaren Umbenennen aufgerufen (darf werfen). */
  beforeSwap?: () => void
}

/**
 * Verschlüsselt eine vorhandene Klartext-DB. Ablauf (crash-sicher):
 *
 *  1. Klartext-DB öffnen, WAL per `wal_checkpoint(TRUNCATE)` einarbeiten,
 *     auf `journal_mode=DELETE` stellen, schließen → eine einzige, vollständige
 *     Datei ohne -wal/-shm. Quelle bleibt bis Schritt 6 unangetastet.
 *  2. Backup `<db>.plain-backup` (Klartext) anlegen.
 *  3. Arbeitskopie `<db>.encrypting` aus der Quelle ziehen und DORT per `rekey`
 *     in-place verschlüsseln. Ein Absturz hier hinterlässt nur die Arbeitskopie.
 *  4. Arbeitskopie mit Schlüssel öffnen: integrity_check = ok, user_version
 *     identisch, und OHNE Schlüssel nicht lesbar. fsync.
 *  5. Verwaiste -wal/-shm der Quelle entfernen (nach dem Checkpoint leer).
 *  6. `rename(<db>.encrypting, <db>)` — atomar (POSIX). Davor ist die Klartext-DB
 *     vollständig, danach die verschlüsselte; es gibt keinen Zwischenzustand.
 *
 * Das Klartext-Backup bleibt liegen, bis die verschlüsselte DB einmal
 * erfolgreich geöffnet wurde (siehe discardPlainLeftovers). Löschen = unlink; auf
 * APFS/SSD ist Überschreiben wirkungslos (Copy-on-Write, Wear-Leveling), die
 * Restdaten schützt nur FileVault.
 */
export function migratePlaintextToEncrypted(
  dbPath: string,
  keyHex: string,
  hooks: MigrationHooks = {}
): void {
  const backup = dbPath + PLAIN_BACKUP_SUFFIX
  const tmp = dbPath + MIGRATION_TMP_SUFFIX

  // Reste eines früheren, abgebrochenen Versuchs — die Quelle ist maßgeblich.
  unlinkQuiet(tmp)
  removeSidecars(tmp)

  // 1. WAL einarbeiten
  const src = new Database(dbPath)
  let userVersion: number
  try {
    src.pragma('wal_checkpoint(TRUNCATE)')
    src.pragma('journal_mode = DELETE')
    userVersion = src.pragma('user_version', { simple: true }) as number
  } finally {
    src.close()
  }
  removeSidecars(dbPath)

  // 2. + 3. Backup und Arbeitskopie
  copyPrivate(dbPath, backup)
  copyPrivate(backup, tmp)

  try {
    const work = new Database(tmp)
    try {
      applyRekey(work, keyHex)
    } finally {
      work.close()
    }
    fsyncFile(tmp)

    // 4. Verifikation
    if (isPlaintextSqlite(tmp)) {
      throw new Error('Verschlüsselung fehlgeschlagen: Arbeitskopie ist noch Klartext')
    }
    const check = openEncrypted(tmp, keyHex)
    try {
      loadVecExtension(check)
      const integrity = check.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error(`integrity_check nach Verschlüsselung: ${integrity}`)
      const version = check.pragma('user_version', { simple: true }) as number
      if (version !== userVersion) {
        throw new Error(`user_version weicht ab (${version} statt ${userVersion})`)
      }
    } finally {
      check.close()
    }
    const bare = new Database(tmp, { readonly: true })
    try {
      let readable = true
      try {
        bare.prepare('SELECT count(*) FROM sqlite_master').get()
      } catch {
        readable = false
      }
      if (readable) throw new Error('Arbeitskopie ist ohne Schlüssel lesbar')
    } finally {
      bare.close()
    }
    removeSidecars(tmp)

    hooks.beforeSwap?.()

    // 5. + 6. Austausch
    removeSidecars(dbPath)
    renameSync(tmp, dbPath)
    chmodSync(dbPath, 0o600)
    fsyncDir(dirname(dbPath))
  } catch (error) {
    // Quelle ist unverändert und bleibt maßgeblich; Arbeitskopie wegwerfen.
    unlinkQuiet(tmp)
    removeSidecars(tmp)
    throw error
  }
}

/**
 * Verwirft das Klartext-Backup der Migration, nachdem die verschlüsselte DB
 * erfolgreich geöffnet (und migriert) wurde.
 */
export function discardPlainMigrationBackup(dbPath: string): void {
  unlinkQuiet(dbPath + PLAIN_BACKUP_SUFFIX)
}

/**
 * Löscht alte Klartext-Pre-Migration-Backups (`<db>.bak-v<N>`, vor der
 * Verschlüsselung per VACUUM INTO entstanden). Verschlüsselte bleiben erhalten.
 */
export function discardPlainBackups(dbPath: string): number {
  let removed = 0
  const dir = dirname(dbPath)
  const prefix = basename(dbPath) + '.bak-v'
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue
    const file = join(dir, name)
    if (name.endsWith('-wal') || name.endsWith('-shm') || isPlaintextSqlite(file)) {
      unlinkQuiet(file)
      removed++
    }
  }
  return removed
}

/** Setzt 0600 auf DB, Sidecars, Backups (best effort — Fehler sind nicht fatal). */
export function restrictPermissions(dbPath: string): void {
  const dir = dirname(dbPath)
  const base = basename(dbPath)
  try {
    for (const name of readdirSync(dir)) {
      if (name === base || name.startsWith(base + '-') || name.startsWith(base + '.')) {
        try {
          chmodSync(join(dir, name), 0o600)
        } catch {
          // ignorieren
        }
      }
    }
  } catch {
    // Verzeichnis nicht lesbar — nichts zu tun
  }
}
