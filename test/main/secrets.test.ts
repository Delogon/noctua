import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from 'electron'
import { getSecret, setSecret } from '@main/auth/secrets'
import { closeTestDb, createTestDb } from '../helpers/db'

describe('getSecret', () => {
  let db: ReturnType<typeof createTestDb>
  afterEach(() => {
    vi.restoreAllMocks()
    closeTestDb(db)
  })

  it('liefert null statt zu werfen, wenn die Entschlüsselung scheitert', () => {
    db = createTestDb()
    setSecret('account.1.password', 'geheim')
    vi.spyOn(safeStorage, 'decryptString').mockImplementation(() => {
      throw new Error('Error while decrypting the ciphertext')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getSecret('account.1.password')).toBeNull()
    expect(warn.mock.calls.flat().join(' ')).not.toContain('geheim')
  })

  it('liefert null für unbekannte Schlüssel', () => {
    db = createTestDb()
    expect(getSecret('gibt-es-nicht')).toBeNull()
  })
})
