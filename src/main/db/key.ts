import { randomBytes } from 'crypto'
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { safeStorage } from 'electron'
import { DbKeyError } from './encryption'

/**
 * Schlüssel der SQLCipher-Datenbank. 32 Zufallsbytes, per Electron safeStorage
 * (macOS: Keychain-gestützt) verschlüsselt und als Datei NEBEN der DB abgelegt
 * (`userData/noctua.dbkey`, 0600) — bewusst nicht in der DB selbst. Ohne
 * safeStorage gibt es keinen Klartext-Fallback: lieber nicht starten als
 * unverschlüsselt speichern.
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
 * Liefert den Schlüssel als Hex-String. Existiert die Schlüsseldatei nicht,
 * wird ein neuer erzeugt — aber nur, wenn `allowCreate` gilt (keine DB oder eine
 * Klartext-DB vorhanden). Eine verschlüsselte DB ohne Schlüsseldatei ist nicht
 * wiederherstellbar; dann NICHT still einen neuen Schlüssel erzeugen.
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
  // Atomar schreiben: Schlüssel muss vollständig auf der Platte liegen, BEVOR
  // die erste verschlüsselte DB entsteht.
  const tmp = keyPath + '.tmp'
  try {
    writeFileSync(tmp, ciphertext, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, keyPath)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // nichts aufzuräumen
    }
    throw error
  }
  return hex
}
