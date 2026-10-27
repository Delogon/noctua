import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { shell } from 'electron'
import { AuthError } from '@azure/msal-node'
import { cancelGoogleLogin, googleInteractiveLogin } from '@main/auth/google'
import { cancelMsLogin } from '@main/auth/msal'
import { CancelableLoopbackClient } from '@main/auth/loopback'
import { createTestDb, closeTestDb } from '../helpers/db'

// CANCEL really aborts the OAuth round trip (Design 3b): the waiting
// login rejects, the loopback server closes — no zombie listener.

describe('cancelGoogleLogin', () => {
  let db: Database.Database | null = null
  afterEach(() => {
    if (db) closeTestDb(db)
    db = null
  })

  it('bricht einen wartenden Login ab — das invoke-Promise verwirft', async () => {
    db = createTestDb()
    const login = googleInteractiveLogin()
    // The loopback server listens only once the browser has been opened
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
    // msal polls getRedirectUri until the server listens — same here
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
    // 302 to the redirect URI so the code does not stay in the browser history
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
    // After the cancel, msal's redirect polling stops immediately (no poll code)
    expect(() => client.getRedirectUri()).toThrow(/abgebrochen/)
    // The port is free again — nobody is listening anymore
    await expect(fetch(`${uri.replace('localhost', '127.0.0.1')}/?code=x`)).rejects.toThrow()
  })
})
