import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { shell } from 'electron'
import { AuthError } from '@azure/msal-node'
import { cancelGoogleLogin, googleInteractiveLogin } from '@main/auth/google'
import { cancelMsLogin } from '@main/auth/msal'
import { CancelableLoopbackClient } from '@main/auth/loopback'
import { createTestDb, closeTestDb } from '../helpers/db'

// CANCEL bricht den OAuth-Roundtrip wirklich ab (Design 3b): der wartende
// Login verwirft, der Loopback-Server schließt — kein Zombie-Listener.

describe('cancelGoogleLogin', () => {
  let db: Database.Database | null = null
  afterEach(() => {
    if (db) closeTestDb(db)
    db = null
  })

  it('bricht einen wartenden Login ab — das invoke-Promise verwirft', async () => {
    db = createTestDb()
    const login = googleInteractiveLogin()
    // Erst wenn der Browser geöffnet wurde, lauscht der Loopback-Server
    await vi.waitFor(() => expect(shell.openExternal).toHaveBeenCalled())

    expect(cancelGoogleLogin()).toBe(true)
    await expect(login).rejects.toThrow(/abgebrochen/)
  })

  it('false, wenn gerade kein Login wartet', () => {
    expect(cancelGoogleLogin()).toBe(false)
  })
})

describe('cancelMsLogin', () => {
  it('false, wenn gerade kein Login wartet', () => {
    expect(cancelMsLogin()).toBe(false)
  })
})

describe('CancelableLoopbackClient (msal-Loopback mit Abbruchpfad)', () => {
  async function redirectUriOf(client: CancelableLoopbackClient): Promise<string> {
    // msal pollt getRedirectUri, bis der Server lauscht — hier genauso
    return vi.waitFor(() => client.getRedirectUri())
  }

  it('meldet vor dem Lauschen msals Poll-Fehlercode', () => {
    const client = new CancelableLoopbackClient()
    try {
      client.getRedirectUri()
      expect.unreachable('getRedirectUri hätte werfen müssen')
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError)
      expect((error as AuthError).errorCode).toBe('no_loopback_server_exists')
    }
  })

  it('nimmt den Auth-Code entgegen wie msals eigener Client', async () => {
    const client = new CancelableLoopbackClient()
    const listener = client.listenForAuthCode('OK', 'FEHLER')
    const uri = await redirectUriOf(client)
    const port = Number(new URL(uri).port)
    expect(uri).toBe(`http://localhost:${port}`)

    const response = await fetch(`http://127.0.0.1:${port}/?code=abc-123&state=xyz`, {
      redirect: 'manual'
    })
    // 302 auf die Redirect-URI, damit der Code nicht in der Browser-History bleibt
    expect(response.status).toBe(302)
    await expect(listener).resolves.toMatchObject({ code: 'abc-123', state: 'xyz' })
    client.closeServer()
  })

  it('cancel verwirft den wartenden Listener und schließt den Server', async () => {
    const client = new CancelableLoopbackClient()
    const listener = client.listenForAuthCode()
    const uri = await redirectUriOf(client)

    client.cancel('Microsoft-Anmeldung abgebrochen')
    await expect(listener).rejects.toThrow(/abgebrochen/)
    // Nach dem Abbruch bricht msals Redirect-Polling sofort ab (kein Poll-Code)
    expect(() => client.getRedirectUri()).toThrow(/abgebrochen/)
    // Der Port ist wieder frei — niemand lauscht mehr
    await expect(fetch(`${uri.replace('localhost', '127.0.0.1')}/?code=x`)).rejects.toThrow()
  })
})
