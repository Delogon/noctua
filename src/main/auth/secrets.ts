import { safeStorage } from 'electron'
import { getDb } from '../db'

/**
 * Vault for all credentials (app passwords, OAuth token cache, Bridge password,
 * OpenRouter key). Values are encrypted with Electron safeStorage (Keychain-backed
 * on macOS) and stored as a BLOB in the secrets table.
 * Decrypted values never leave the main process.
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
    { ciphertext: Buffer } | undefined
  if (!row) return null
  try {
    ensureAvailable()
    return safeStorage.decryptString(row.ciphertext)
  } catch (error) {
    // E.g. Keychain change or corrupted entry: treat as "no credential"
    // so the re-auth paths kick in. Do not log any secret material.
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
