import { safeStorage } from 'electron'
import { getDb } from '../db'

/**
 * Vault für alle Credentials (App-Passwörter, OAuth-Token-Cache, Bridge-Passwort,
 * OpenRouter-Key). Werte werden mit Electron safeStorage verschlüsselt (auf macOS
 * Keychain-gestützt) und als BLOB in der secrets-Tabelle abgelegt.
 * Entschlüsselte Werte verlassen den Main-Prozess nie.
 */

function ensureAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available — cannot store secrets')
  }
}

export function setSecret(key: string, value: string): void {
  ensureAvailable()
  const ciphertext = safeStorage.encryptString(value)
  getDb()
    .prepare(
      `INSERT INTO secrets (key, ciphertext, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`
    )
    .run(key, ciphertext, Date.now())
}

export function getSecret(key: string): string | null {
  const row = getDb().prepare('SELECT ciphertext FROM secrets WHERE key = ?').get(key) as
    | { ciphertext: Buffer }
    | undefined
  if (!row) return null
  try {
    ensureAvailable()
    return safeStorage.decryptString(row.ciphertext)
  } catch (error) {
    // Z. B. Keychain-Wechsel oder beschädigter Eintrag: wie „kein Credential"
    // behandeln, damit die Re-Auth-Pfade greifen. Kein Secret-Material loggen.
    console.warn(
      `[secrets] Entschlüsselung fehlgeschlagen (${key.split('.')[0]}): ${error instanceof Error ? error.message.slice(0, 80) : 'unbekannt'}`
    )
    return null
  }
}

export function hasSecret(key: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM secrets WHERE key = ?').get(key)
  return row !== undefined
}

export function deleteSecret(key: string): void {
  getDb().prepare('DELETE FROM secrets WHERE key = ?').run(key)
}
