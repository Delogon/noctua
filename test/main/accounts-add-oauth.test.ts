import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount } from '../helpers/db'
import { getSecret, setSecret } from '@main/auth/secrets'

// Browser-Logins mocken — der Handler-Rest (Dedupe, Vault) läuft echt.
vi.mock('@main/auth/google', () => ({
  googleInteractiveLogin: vi.fn(async () => ({ email: 'bestand@gmail.com' })),
  googleAccessToken: vi.fn()
}))
vi.mock('@main/auth/msal', () => ({
  msInteractiveLogin: vi.fn(async () => ({ email: 'bestand@hotmail.de' })),
  msAccessToken: vi.fn()
}))
// Zieht sonst die Hunspell-Wörterbücher als ?asset-Importe in den Test
vi.mock('@main/spell', () => ({ getSpellEngine: vi.fn() }))

import { handlers } from '@main/ipc/handlers'

describe('accounts:addGoogle / addMicrosoft — Dedupe', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('blockt eine bereits verbundene Google-Adresse und räumt das Refresh-Token weg', async () => {
    db = createTestDb()
    seedAccount(db, { email: 'bestand@gmail.com' })
    // Der Login hat zu diesem Zeitpunkt schon ein Refresh-Token abgelegt
    setSecret('google:refresh:bestand@gmail.com', 'frisch')

    await expect(
      (handlers['accounts:addGoogle'] as (input: { accountName: string }) => Promise<unknown>)({
        accountName: 'Nochmal'
      })
    ).rejects.toThrow(/bereits als „Testkonto \d+" verbunden.*trennen/)

    // Konto läuft per Passwort — das überflüssige Google-Token darf nicht liegen bleiben
    expect(getSecret('google:refresh:bestand@gmail.com')).toBeNull()
  })

  it('blockt eine bereits verbundene Microsoft-Adresse', async () => {
    db = createTestDb()
    seedAccount(db, { email: 'bestand@hotmail.de', provider: 'microsoft' })

    await expect(
      (handlers['accounts:addMicrosoft'] as (input: { accountName: string }) => Promise<unknown>)({
        accountName: 'Nochmal'
      })
    ).rejects.toThrow(/bereits als „Testkonto \d+" verbunden/)
  })
})
