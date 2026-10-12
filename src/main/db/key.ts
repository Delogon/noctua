import { randomBytes } from 'crypto'
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { safeStorage } from 'electron'
import { DbKeyError } from './encryption'

/**
 * Key of the SQLCipher database. 32 random bytes, encrypted via Electron safeStorage
 * (macOS: Keychain-backed) and stored as a file NEXT TO the DB
 * (`userData/noctua.dbkey`, 0600) — deliberately not in the DB itself. Without
 * safeStorage there is no plaintext fallback: better not to start than to
 * store unencrypted.
 */

export const DB_KEY_FILENAME = 'noctua.dbkey'

export function assertKeyStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new DbKeyError(
      'Die sichere Schlüsselablage (Schlüsselbund) ist nicht verfügbar. Noctua speichert die ' +
        'Datenbank nie unverschlüsselt und kann deshalb nicht starten. / The system keychain ' +
        'is unavailable. Noctua never stores its database unencrypted and cannot start.'
    )
  }
}

/**
 * Returns the key as a hex string. If the key file doesn't exist,
 * a new one is created — but only if `allowCreate` holds (no DB or a
 * plaintext DB present). An encrypted DB without a key file cannot be
 * recovered; in that case do NOT silently create a new key.
 */
export function loadOrCreateDbKey(keyPath: string, allowCreate: boolean): string {
  assertKeyStorageAvailable()

  if (existsSync(keyPath)) {
    let hex: string
    try {
      hex = safeStorage.decryptString(readFileSync(keyPath))
    } catch (error) {
      throw new DbKeyError(
        `Der Datenbank-Schlüssel (${DB_KEY_FILENAME}) lässt sich nicht entschlüsseln — ` +
          `Schlüsselbund-Eintrag geändert oder Datei beschädigt. ${
            error instanceof Error ? error.message : String(error)
          }`
      )
    }
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new DbKeyError(`Der Datenbank-Schlüssel (${DB_KEY_FILENAME}) hat ein ungültiges Format`)
    }
    chmodSync(keyPath, 0o600)
    return hex
  }

  if (!allowCreate) {
    throw new DbKeyError(
      `Die Datenbank ist verschlüsselt, aber die Schlüsseldatei (${DB_KEY_FILENAME}) fehlt. ` +
        'Ohne sie sind die Daten nicht lesbar.'
    )
  }

  const hex = randomBytes(32).toString('hex')
  const ciphertext = safeStorage.encryptString(hex)
  // Write atomically: the key must be fully on disk BEFORE
  // the first encrypted DB is created.
  const tmp = keyPath + '.tmp'
  try {
    writeFileSync(tmp, ciphertext, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, keyPath)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // nothing to clean up
    }
    throw error
  }
  return hex
}
