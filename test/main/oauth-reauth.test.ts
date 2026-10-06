import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isAuthFailure } from '@main/sync/account-syncer'
import {
  isMsalReauthError,
  mapMsalError,
  ReauthRequiredError,
  isReauthError
} from '@main/auth/reauth'

const acquireTokenSilent = vi.hoisted(() => vi.fn())
vi.mock('@azure/msal-node', () => ({
  PublicClientApplication: class {
    getTokenCache(): unknown {
      return {
        getAllAccounts: async () => [{ username: 'me@hotmail.de' }],
        removeAccount: async () => {}
      }
    }
    acquireTokenSilent = acquireTokenSilent
  }
}))
vi.mock('@main/db', () => ({ getSetting: () => null }))
vi.mock('@main/auth/secrets', () => ({
  getSecret: vi.fn(() => null),
  setSecret: vi.fn(),
  deleteSecret: vi.fn()
}))

import { msAccessToken } from '@main/auth/msal'
import { googleAccessToken } from '@main/auth/google'
import { getSecret } from '@main/auth/secrets'

describe('OAuth-Refresh-Fehler → needs-reauth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('erkennt MSAL interaction_required / invalid_grant', () => {
    expect(isMsalReauthError({ errorCode: 'invalid_grant' })).toBe(true)
    expect(isMsalReauthError({ errorCode: 'interaction_required' })).toBe(true)
    expect(isMsalReauthError({ name: 'InteractionRequiredAuthError' })).toBe(true)
    expect(isMsalReauthError({ errorCode: 'network_error' })).toBe(false)
    expect(isMsalReauthError(new Error('timeout'))).toBe(false)
  })

  it('msAccessToken mappt MSAL-Fehler auf ReauthRequiredError, andere bleiben', async () => {
    acquireTokenSilent.mockRejectedValueOnce(
      Object.assign(new Error('AADSTS70008'), { errorCode: 'invalid_grant' })
    )
    const error = await msAccessToken('me@hotmail.de').catch((e) => e)
    expect(error).toBeInstanceOf(ReauthRequiredError)
    expect(isAuthFailure(error)).toBe(true)

    const net = new Error('ECONNRESET')
    acquireTokenSilent.mockRejectedValueOnce(net)
    expect(await msAccessToken('me@hotmail.de').catch((e) => e)).toBe(net)
    expect(mapMsalError(net)).toBe(net)
  })

  it('Google: invalid_grant beim Refresh → ReauthRequiredError', async () => {
    vi.mocked(getSecret).mockReturnValue('refresh-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' })
      }))
    )
    const error = await googleAccessToken('x@gmail.com').catch((e) => e)
    expect(error).toBeInstanceOf(ReauthRequiredError)
    expect(isAuthFailure(error)).toBe(true)
    vi.unstubAllGlobals()
  })

  it('Google: fehlendes Refresh-Token → needs-reauth; 5xx bleibt normaler Fehler', async () => {
    vi.mocked(getSecret).mockReturnValue(null)
    expect(isReauthError(await googleAccessToken('y@gmail.com').catch((e) => e))).toBe(true)

    vi.mocked(getSecret).mockReturnValue('rt')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => null }))
    )
    const error = await googleAccessToken('z@gmail.com').catch((e) => e)
    expect(isAuthFailure(error)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('IMAP-Auth-Fehler werden weiterhin erkannt', () => {
    expect(isAuthFailure({ authenticationFailed: true })).toBe(true)
    expect(isAuthFailure(new Error('x'))).toBe(false)
  })
})
