import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount } from '../helpers/db'
import { accountSecretKey } from '@main/auth/providers'
import { getSecret, setSecret } from '@main/auth/secrets'

vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('imapflow', () => ({
  ImapFlow: class {
    connect = vi.fn(async () => {})
    logout = vi.fn(async () => {})
  }
}))
vi.mock('@main/auth/google', () => ({
  googleInteractiveLogin: vi.fn(),
  cancelGoogleLogin: vi.fn(),
  googleAccessToken: vi.fn()
}))
vi.mock('@main/auth/msal', () => ({
  msInteractiveLogin: vi.fn(),
  msForgetAccount: vi.fn(async () => {}),
  cancelMsLogin: vi.fn(),
  msAccessToken: vi.fn()
}))
vi.mock('@main/sync/engine', () => ({
  syncEngine: {
    credentialsChanged: vi.fn(async () => {}),
    startAccount: vi.fn(),
    stopAccount: vi.fn(async () => {}),
    getState: vi.fn(() => ({ state: 'idle', detail: null, errorSince: null }))
  }
}))
vi.mock('@main/spell', () => ({ getSpellEngine: vi.fn() }))

import { handlers } from '@main/ipc/handlers'
import { msForgetAccount } from '@main/auth/msal'

const remove = handlers['accounts:remove'] as (input: {
  accountId: number
}) => Promise<{ ok: boolean }>

describe('accounts:remove credential purge', () => {
  let db: Database.Database
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => closeTestDb(db))

  it('purges the MSAL cache entry for oauth-ms accounts', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'me@hotmail.de', provider: 'microsoft' })
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-ms' WHERE id = ?`).run(id)

    await expect(remove({ accountId: id })).resolves.toEqual({ ok: true })
    expect(msForgetAccount).toHaveBeenCalledWith('me@hotmail.de')
    expect(getSecret(accountSecretKey(id))).toBeNull()
  })

  it('does not touch the MSAL cache for password accounts', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'a@test.de' })
    setSecret(accountSecretKey(id), 'pw')

    await expect(remove({ accountId: id })).resolves.toEqual({ ok: true })
    expect(msForgetAccount).not.toHaveBeenCalled()
    expect(getSecret(accountSecretKey(id))).toBeNull()
  })

  it('still purges the Google refresh token for oauth-google accounts', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'me@gmail.com', provider: 'gmail' })
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-google' WHERE id = ?`).run(id)
    setSecret('google:refresh:me@gmail.com', 'rt')

    await expect(remove({ accountId: id })).resolves.toEqual({ ok: true })
    expect(getSecret('google:refresh:me@gmail.com')).toBeNull()
    expect(msForgetAccount).not.toHaveBeenCalled()
  })
})