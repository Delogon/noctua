import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  emailFromIdToken,
  googleAccessToken,
  googleAuthUrl,
  pkcePair
} from '@main/auth/google'
import { setSecret, getSecret } from '@main/auth/secrets'
import { createTestDb, closeTestDb } from '../helpers/db'

function fakeIdToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${body}.signature`
}

function tokenFetch(body: Record<string, unknown>): typeof fetch {
  return vi.fn().mockResolvedValue({ json: () => Promise.resolve(body) }) as unknown as typeof fetch
}

describe('google-auth', () => {
  let db: Database.Database | null = null
  afterEach(() => {
    if (db) closeTestDb(db)
    db = null
    vi.unstubAllGlobals()
  })

  it('baut die Autorisierungs-URL mit PKCE, offline-Zugriff und Consent', () => {
    const url = new URL(
      googleAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://127.0.0.1:49152/callback',
        challenge: 'challenge-abc',
        state: 'state-xyz'
      })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('client-123')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49152/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toContain('https://mail.google.com/')
    // Ohne offline+consent gäbe Google kein Refresh-Token heraus
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-xyz')
  })

  it('erzeugt ein konsistentes PKCE-Paar (S256, base64url)', () => {
    const { verifier, challenge } = pkcePair()
    const expected = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(challenge).toBe(expected)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(pkcePair().verifier).not.toBe(verifier)
  })

  it('liest die Adresse kleingeschrieben aus dem id_token', () => {
    expect(emailFromIdToken(fakeIdToken({ email: 'Lena.Hartmann@GMail.com' }))).toBe(
      'lena.hartmann@gmail.com'
    )
    expect(emailFromIdToken(fakeIdToken({ sub: '123' }))).toBeNull()
    expect(emailFromIdToken('kein-jwt')).toBeNull()
  })

  it('erneuert das Access-Token per Refresh-Token und cached es', async () => {
    db = createTestDb()
    setSecret('google:refresh:cache@gmail.com', 'refresh-1')
    const fetchMock = tokenFetch({ access_token: 'at-1', expires_in: 3600 })
    vi.stubGlobal('fetch', fetchMock)

    expect(await googleAccessToken('cache@gmail.com')).toBe('at-1')
    expect(await googleAccessToken('cache@gmail.com')).toBe('at-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = String((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=refresh-1')
  })

  it('verlangt ohne Refresh-Token einen Re-Login', async () => {
    db = createTestDb()
    await expect(googleAccessToken('unbekannt@gmail.com')).rejects.toThrow(
      /nicht angemeldet.*neu verbinden/
    )
  })

  it('räumt bei widerrufenem Zugriff auf und verlangt einen Re-Login', async () => {
    db = createTestDb()
    setSecret('google:refresh:widerrufen@gmail.com', 'refresh-alt')
    vi.stubGlobal('fetch', tokenFetch({ error: 'invalid_grant' }))

    await expect(googleAccessToken('widerrufen@gmail.com')).rejects.toThrow(/widerrufen/)
    expect(getSecret('google:refresh:widerrufen@gmail.com')).toBeNull()
  })
})
