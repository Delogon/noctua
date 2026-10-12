import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount } from '../helpers/db'
import { getSecret, setSecret } from '@main/auth/secrets'
import { accountSecretKey } from '@main/auth/providers'

const imap = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  lastOptions: null as unknown
}))
vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(options: unknown) {
      imap.lastOptions = options
    }
    connect = imap.connect
    logout = imap.logout
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
    getState: vi.fn(() => ({ state: 'idle', detail: null, errorSince: null }))
  }
}))
vi.mock('@main/spell', () => ({ getSpellEngine: vi.fn() }))

import { handlers } from '@main/ipc/handlers'
import { syncEngine } from '@main/sync/engine'
import { googleInteractiveLogin } from '@main/auth/google'
import { msInteractiveLogin, msForgetAccount } from '@main/auth/msal'
import { getSecret as vaultGet } from '@main/auth/secrets'

type Call<I> = (input: I) => Promise<unknown>
const updatePassword = handlers['accounts:updatePassword'] as Call<{
  accountId: number
  password: string
}>
const reauthorize = handlers['accounts:reauthorize'] as Call<{ accountId: number }>

describe('accounts:updatePassword', () => {
  let db: Database.Database
  beforeEach(() => {
    vi.clearAllMocks()
    imap.connect.mockImplementation(async () => {})
  })
  afterEach(() => closeTestDb(db))

  it('prüft den IMAP-Login, speichert im Vault und startet den Syncer neu', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'a@test.de' })
    setSecret(accountSecretKey(id), 'alt')

    await updatePassword({ accountId: id, password: ' ab cd ef ' })

    expect((imap.lastOptions as { auth: { pass: string } }).auth.pass).toBe('abcdef')
    expect(getSecret(accountSecretKey(id))).toBe('abcdef')
    expect(syncEngine.credentialsChanged).toHaveBeenCalledWith(accountSecretKey(id))
    expect(syncEngine.startAccount).toHaveBeenCalled()
  })

  it('überschreibt nichts, wenn der Login scheitert', async () => {
    db = createTestDb()
    const id = seedAccount(db)
    setSecret(accountSecretKey(id), 'alt')
    imap.connect.mockRejectedValueOnce(new Error('Invalid credentials'))

    await expect(updatePassword({ accountId: id, password: 'falsch' })).rejects.toThrow(
      'Invalid credentials'
    )
    expect(getSecret(accountSecretKey(id))).toBe('alt')
    expect(syncEngine.credentialsChanged).not.toHaveBeenCalled()
  })

  it('lehnt OAuth-Konten und unbekannte Konten ab', async () => {
    db = createTestDb()
    const id = seedAccount(db)
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-google' WHERE id = ?`).run(id)
    await expect(updatePassword({ accountId: id, password: 'x' })).rejects.toThrow(/Browser/)
    await expect(updatePassword({ accountId: 9999, password: 'x' })).rejects.toThrow(
      /nicht gefunden/
    )
    expect(imap.connect).not.toHaveBeenCalled()
  })
})

describe('accounts:reauthorize', () => {
  let db: Database.Database
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => closeTestDb(db))

  it('Google: gleiche Adresse → Syncer neu starten', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'me@gmail.com', provider: 'gmail' })
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-google' WHERE id = ?`).run(id)
    vi.mocked(googleInteractiveLogin).mockResolvedValueOnce({ email: 'me@gmail.com' })

    await expect(reauthorize({ accountId: id })).resolves.toEqual({
      ok: true,
      email: 'me@gmail.com'
    })
    expect(syncEngine.credentialsChanged).toHaveBeenCalledWith(accountSecretKey(id))
  })

  it('Google: andere Adresse → Fehler, fremdes Refresh-Token wird verworfen', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'me@gmail.com', provider: 'gmail' })
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-google' WHERE id = ?`).run(id)
    setSecret('google:refresh:other@gmail.com', 'rt')
    vi.mocked(googleInteractiveLogin).mockResolvedValueOnce({ email: 'other@gmail.com' })

    await expect(reauthorize({ accountId: id })).rejects.toThrow(/other@gmail.com.*me@gmail.com/)
    expect(vaultGet('google:refresh:other@gmail.com')).toBeNull()
    expect(syncEngine.credentialsChanged).not.toHaveBeenCalled()
  })

  it('Microsoft: falsche Adresse wird aus dem Cache entfernt, richtige startet neu', async () => {
    db = createTestDb()
    const id = seedAccount(db, { email: 'me@hotmail.de', provider: 'microsoft' })
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-ms' WHERE id = ?`).run(id)

    vi.mocked(msInteractiveLogin).mockResolvedValueOnce({ email: 'x@hotmail.de' })
    await expect(reauthorize({ accountId: id })).rejects.toThrow(/x@hotmail.de/)
    expect(msForgetAccount).toHaveBeenCalledWith('x@hotmail.de')

    vi.mocked(msInteractiveLogin).mockResolvedValueOnce({ email: 'ME@hotmail.de' })
    await expect(reauthorize({ accountId: id })).resolves.toMatchObject({ ok: true })
    expect(syncEngine.credentialsChanged).toHaveBeenCalledTimes(1)
  })

  it('lehnt Passwort-Konten ab', async () => {
    db = createTestDb()
    const id = seedAccount(db)
    await expect(reauthorize({ accountId: id })).rejects.toThrow(/Passwort/)
  })
})
