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
 * SQLCipher encryption of the mail database (PRV-5).
 *
 * Driver: better-sqlite3-multiple-ciphers (SQLite3MultipleCiphers). The cipher
 * `sqlcipher` with `legacy=4` matches the SQLCipher 4 format (AES-256-CBC,
 * HMAC-SHA512, 4096-byte pages, 256000 KDF iterations — no KDF with a raw key) and
 * is therefore readable with the sqlcipher CLI.
 *
 * This module knows neither Electron nor safeStorage: the key comes in as a
 * 64-character hex string (see key.ts). That keeps everything testable against
 * temp files.
 */

const SQLITE_MAGIC = 'SQLite format 3\0'
const KEY_HEX = /^[0-9a-f]{64}$/

/** File extensions SQLite creates next to the main file. */
const SIDECARS = ['-wal', '-shm', '-journal'] as const

/** File name of the plaintext backup during migration (see migratePlaintextToEncrypted). */
export const PLAIN_BACKUP_SUFFIX = '.plain-backup'
const MIGRATION_TMP_SUFFIX = '.encrypting'

export class DbKeyError extends Error {}

/** true if the file starts with the SQLite plaintext header. */
export function isPlaintextSqlite(file: string): boolean {
  return readHeader(file) === SQLITE_MAGIC
}

/** Exists, is not empty and has NO plaintext header → encrypted (or foreign). */
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
 * Cipher configuration + key — MUST be the very first statement after
 * opening (before any other PRAGMA/query). Order per
 * SQLite3MultipleCiphers: first cipher + parameters, then key. The key is
 * passed as a raw key (`x'…'`, 32 bytes) and needs no KDF.
 */
export function applyKey(db: Database.Database, keyHex: string): void {
  if (!KEY_HEX.test(keyHex)) throw new DbKeyError('Ungültiger Datenbank-Schlüssel')
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
  db.pragma(`key = "x'${keyHex}'"`)
}

/** Like applyKey, but for `rekey` (encrypting a plaintext DB or changing the key). */
function applyRekey(db: Database.Database, keyHex: string): void {
  if (!KEY_HEX.test(keyHex)) throw new DbKeyError('Ungültiger Datenbank-Schlüssel')
  db.pragma("cipher = 'sqlcipher'")
  db.pragma('legacy = 4')
  db.pragma(`rekey = "x'${keyHex}'"`)
}

/**
 * Loads sqlite-vec. In the packaged app the dylib lives in app.asar.unpacked —
 * SQLite's native dlopen doesn't know Electron's asar redirection.
 */
export function loadVecExtension(db: Database.Database): void {
  db.loadExtension(sqliteVec.getLoadablePath().replace('app.asar', 'app.asar.unpacked'))
}

/**
 * Opens an encrypted DB and checks the key immediately. Otherwise a wrong
 * key only surfaces on the first real query with "file is not a
 * database".
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
  // The codec does not encrypt temp files (large sorts, temporary indexes)
  // — keep them in RAM, otherwise mail content lands in plaintext in $TMPDIR
  // (SEC, vuln-0014).
  db.pragma('temp_store = MEMORY')
  return db
}

function unlinkQuiet(file: string): void {
  try {
    unlinkSync(file)
  } catch {
    // not present — intended
  }
}

function removeSidecars(file: string): void {
  for (const s of SIDECARS) unlinkQuiet(file + s)
}

/** Copy that costs almost nothing on APFS/btrfs via clone, otherwise a normal copy. */
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
    // Directory fsync is not possible on some platforms — best effort
  }
}

export interface MigrationHooks {
  /** Test seam: called right before the atomic rename (may throw). */
  beforeSwap?: () => void
}

/**
 * Encrypts an existing plaintext DB. Procedure (crash-safe):
 *
 *  1. Open the plaintext DB, fold in the WAL via `wal_checkpoint(TRUNCATE)`,
 *     switch to `journal_mode=DELETE`, close → one single, complete
 *     file without -wal/-shm. The source stays untouched until step 6.
 *  2. Create the backup `<db>.plain-backup` (plaintext).
 *  3. Make a working copy `<db>.encrypting` from the source and encrypt it THERE
 *     in place via `rekey`. A crash here only leaves the working copy behind.
 *  4. Open the working copy with the key: integrity_check = ok, user_version
 *     identical, and NOT readable without the key. fsync.
 *  5. Remove orphaned -wal/-shm of the source (empty after the checkpoint).
 *  6. `rename(<db>.encrypting, <db>)` — atomic (POSIX). Before it the plaintext DB
 *     is complete, after it the encrypted one; there is no intermediate state.
 *
 * The plaintext backup stays until the encrypted DB has been opened
 * successfully once (see discardPlainLeftovers). Deleting = unlink; on
 * APFS/SSD overwriting is ineffective (copy-on-write, wear leveling), the
 * remaining data is only protected by FileVault.
 */
export function migratePlaintextToEncrypted(
  dbPath: string,
  keyHex: string,
  hooks: MigrationHooks = {}
): void {
  const backup = dbPath + PLAIN_BACKUP_SUFFIX
  const tmp = dbPath + MIGRATION_TMP_SUFFIX

  // Leftovers of an earlier, aborted attempt — the source is authoritative.
  unlinkQuiet(tmp)
  removeSidecars(tmp)

  // 1. Fold in the WAL
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

  // 2. + 3. Backup and working copy
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

    // 4. Verification
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

    // 5. + 6. Swap
    removeSidecars(dbPath)
    renameSync(tmp, dbPath)
    chmodSync(dbPath, 0o600)
    fsyncDir(dirname(dbPath))
  } catch (error) {
    // Source is unchanged and stays authoritative; discard the working copy.
    unlinkQuiet(tmp)
    removeSidecars(tmp)
    throw error
  }
}

/**
 * Discards the migration's plaintext backup after the encrypted DB
 * has been opened (and migrated) successfully.
 */
export function discardPlainMigrationBackup(dbPath: string): void {
  unlinkQuiet(dbPath + PLAIN_BACKUP_SUFFIX)
}

/**
 * Deletes old plaintext pre-migration backups (`<db>.bak-v<N>`, created
 * via VACUUM INTO before encryption). Encrypted ones are kept.
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

/** Sets 0600 on DB, sidecars, backups (best effort — errors are not fatal). */
export function restrictPermissions(dbPath: string): void {
  const dir = dirname(dbPath)
  const base = basename(dbPath)
  try {
    for (const name of readdirSync(dir)) {
      if (name === base || name.startsWith(base + '-') || name.startsWith(base + '.')) {
        try {
          chmodSync(join(dir, name), 0o600)
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // Directory not readable — nothing to do
  }
}
