import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount } from '../helpers/db'
import { getSecret, setSecret } from '@main/auth/secrets'

// Mock browser logins — the rest of the handler (dedupe, vault) runs for real.
vi.mock('@main/auth/google', () => ({
  googleInteractiveLogin: vi.fn(async () => ({ email: 'bestand@gmail.com' })),
  googleAccessToken: vi.fn()
}))
vi.mock('@main/auth/msal', () => ({
  msInteractiveLogin: vi.fn(async () => ({ email: 'bestand@hotmail.de' })),
  msAccessToken: vi.fn()
}))
// Otherwise pulls the Hunspell dictionaries into the test as ?asset imports
vi.mock('@main/spell', () => ({ getSpellEngine: vi.fn() }))

import { handlers } from '@main/ipc/handlers'

describe('accounts:addGoogle / addMicrosoft — Dedupe', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('blockt eine bereits verbundene Google-Adresse und räumt das Refresh-Token weg', async () => {
    db = createTestDb()
    seedAccount(db, { email: 'bestand@gmail.com' })
    // At this point the login has already stored a refresh token
    setSecret('google:refresh:bestand@gmail.com', 'frisch')

    await expect(
      (handlers['accounts:addGoogle'] as (input: { accountName: string }) => Promise<unknown>)({
        accountName: 'Nochmal'
      })
    ).rejects.toThrow(/bereits als „Testkonto \d+“ verbunden.*trenne das Konto/)

    // Account uses a password — the superfluous Google token must not be left behind
    expect(getSecret('google:refresh:bestand@gmail.com')).toBeNull()
  })

  it('blockt eine bereits verbundene Microsoft-Adresse', async () => {
    db = createTestDb()
    seedAccount(db, { email: 'bestand@hotmail.de', provider: 'microsoft' })

    await expect(
      (handlers['accounts:addMicrosoft'] as (input: { accountName: string }) => Promise<unknown>)({
        accountName: 'Nochmal'
      })
    ).rejects.toThrow(/bereits als „Testkonto \d+“ verbunden/)
  })
})
