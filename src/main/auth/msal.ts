import { shell } from 'electron'
import {
  PublicClientApplication,
  type AccountInfo,
  type ICachePlugin,
  type TokenCacheContext
} from '@azure/msal-node'
import { getSetting } from '../db'
import { getOrgConfig } from '../org-config'
import type { OrgConfig } from '@shared/org-config'
import { getSecret, setSecret } from './secrets'
import { CancelableLoopbackClient } from './loopback'
import { mapMsalError, ReauthRequiredError } from './reauth'

/**
 * Microsoft OAuth for personal accounts (Hotmail/Outlook.com).
 *
 * Client ID: Microsoft no longer allows personal accounts their own
 * app registrations. The default is therefore Thunderbird's publicly
 * documented public client ID (common practice among OSS mail tools; no
 * secret, tokens stay local in the vault). Can be replaced at any time with
 * your own registration via the setting `ms.clientId`.
 */
const THUNDERBIRD_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753'
const CACHE_SECRET_KEY = 'ms.tokenCache'

// Resource outlook.office.com (not office365.com): Thunderbird's
// app registration is configured for this resource — Microsoft rejects other
// resources with invalid_scope. The tokens still work for the
// IMAP/SMTP server outlook.office365.com.
export const MS_MAIL_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send'
]

/** Client ID: explicit main setting > org configuration > Thunderbird default. */
export function resolveMicrosoftClientId(setting: string | null, org: OrgConfig | null): string {
  return setting?.trim() || org?.oauth?.microsoft?.clientId || THUNDERBIRD_CLIENT_ID
}

function clientId(): string {
  return resolveMicrosoftClientId(getSetting('ms.clientId'), getOrgConfig())
}

/** Persists the MSAL token cache encrypted in the safeStorage vault. */
const vaultCachePlugin: ICachePlugin = {
  async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
    const cached = getSecret(CACHE_SECRET_KEY)
    if (cached) context.tokenCache.deserialize(cached)
  },
  async afterCacheAccess(context: TokenCacheContext): Promise<void> {
    if (context.cacheHasChanged) {
      setSecret(CACHE_SECRET_KEY, context.tokenCache.serialize())
    }
  }
}

let pca: PublicClientApplication | null = null
let pcaClientId: string | null = null

function getPca(): PublicClientApplication {
  const id = clientId()
  if (!pca || pcaClientId !== id) {
    pca = new PublicClientApplication({
      auth: {
        clientId: id,
        authority: 'https://login.microsoftonline.com/common'
      },
      cache: { cachePlugin: vaultCachePlugin }
    })
    pcaClientId = id
  }
  return pca
}

async function findAccount(email: string): Promise<AccountInfo | null> {
  const accounts = await getPca().getTokenCache().getAllAccounts()
  const lower = email.toLowerCase()
  // No fallback to accounts[0]: a token for a DIFFERENT account would be invalid
  // at the IMAP/SMTP server anyway (user ≠ token account) — pass it on
  // cleanly so the syncer goes to needs-reauth instead of failed attempts.
  return accounts.find((a) => a.username.toLowerCase() === lower) ?? null
}

/** The currently waiting loopback client — target of the CANCEL button (Design 3b). */
let activeLoopback: CancelableLoopbackClient | null = null

/**
 * Interactive login: opens the system browser; the loopback redirect is received
 * by our abortable client so CANCEL really ends the round trip.
 * Returns the address actually signed in.
 */
export async function msInteractiveLogin(): Promise<{ email: string }> {
  const loopback = new CancelableLoopbackClient()
  activeLoopback = loopback
  try {
    const result = await getPca().acquireTokenInteractive({
      scopes: MS_MAIL_SCOPES,
      loopbackClient: loopback,
      openBrowser: async (url) => {
        await shell.openExternal(url)
      },
      successTemplate:
        '<html><body style="font-family:sans-serif;padding:2rem"><h3>Angemeldet.</h3>Du kannst dieses Fenster schließen und zu Noctua zurückkehren.</body></html>',
      errorTemplate:
        '<html><body style="font-family:sans-serif;padding:2rem"><h3>Anmeldung fehlgeschlagen.</h3>Bitte in Noctua erneut versuchen.</body></html>'
    })
    if (!result?.account?.username) throw new Error('Microsoft hat kein Konto zurückgegeben')
    return { email: result.account.username.toLowerCase() }
  } finally {
    if (activeLoopback === loopback) activeLoopback = null
  }
}

/** Aborts a waiting Microsoft login; false if none is running. */
export function cancelMsLogin(): boolean {
  if (!activeLoopback) return false
  activeLoopback.cancel('Microsoft-Anmeldung abgebrochen')
  activeLoopback = null
  return true
}

/** Removes an account from the MSAL cache (e.g. after signing in with the wrong address). */
export async function msForgetAccount(email: string): Promise<void> {
  const lower = email.toLowerCase()
  const accounts = await getPca().getTokenCache().getAllAccounts()
  for (const account of accounts) {
    if (account.username.toLowerCase() === lower) {
      await getPca().getTokenCache().removeAccount(account)
    }
  }
}

/**
 * Fresh access token (silent, with refresh). If a re-login is needed
 * (refresh token expired/revoked, no account in the cache), the function
 * throws a ReauthRequiredError → needs-reauth instead of a backoff loop.
 */
export async function msAccessToken(email: string): Promise<string> {
  const account = await findAccount(email)
  if (!account) {
    throw new ReauthRequiredError('Microsoft-Konto nicht angemeldet — bitte erneut anmelden')
  }
  let result
  try {
    result = await getPca().acquireTokenSilent({ account, scopes: MS_MAIL_SCOPES })
  } catch (error) {
    throw mapMsalError(error)
  }
  if (!result?.accessToken) throw new Error('Kein Access-Token erhalten')
  return result.accessToken
}
