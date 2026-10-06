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
 * Microsoft-OAuth für persönliche Konten (Hotmail/Outlook.com).
 *
 * Client-ID: Microsoft erlaubt persönlichen Konten keine eigenen
 * App-Registrierungen mehr. Default ist deshalb Thunderbirds öffentlich
 * dokumentierte Public-Client-ID (gängige Praxis bei OSS-Mail-Tools; kein
 * Secret, Tokens bleiben lokal im Vault). Über das Setting `ms.clientId`
 * jederzeit durch eine eigene Registrierung ersetzbar.
 */
const THUNDERBIRD_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753'
const CACHE_SECRET_KEY = 'ms.tokenCache'

// Resource outlook.office.com (nicht office365.com): Thunderbirds
// App-Registrierung ist für diese Resource konfiguriert — andere Resources
// lehnt Microsoft mit invalid_scope ab. Die Tokens gelten trotzdem für den
// IMAP-/SMTP-Server outlook.office365.com.
export const MS_MAIL_SCOPES = [
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send'
]

/** Client-ID: explizites Main-Setting > Org-Konfiguration > Thunderbird-Default. */
export function resolveMicrosoftClientId(setting: string | null, org: OrgConfig | null): string {
  return setting?.trim() || org?.oauth?.microsoft?.clientId || THUNDERBIRD_CLIENT_ID
}

function clientId(): string {
  return resolveMicrosoftClientId(getSetting('ms.clientId'), getOrgConfig())
}

/** Persistiert den MSAL-Token-Cache verschlüsselt im safeStorage-Vault. */
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
  // Kein Fallback auf accounts[0]: ein Token für ein ANDERES Konto wäre am
  // IMAP/SMTP-Server (user ≠ Token-Konto) ohnehin ungültig — sauber
  // weiterreichen, damit der Syncer in needs-reauth läuft statt in Fehlversuchen.
  return accounts.find((a) => a.username.toLowerCase() === lower) ?? null
}

/** Der gerade wartende Loopback-Client — Ziel des CANCEL-Knopfs (Design 3b). */
let activeLoopback: CancelableLoopbackClient | null = null

/**
 * Interaktiver Login: öffnet den System-Browser; den Loopback-Redirect nimmt
 * unser abbrechbarer Client entgegen, damit CANCEL den Roundtrip wirklich
 * beendet. Gibt die tatsächlich angemeldete Adresse zurück.
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

/** Bricht einen wartenden Microsoft-Login ab; false, wenn keiner läuft. */
export function cancelMsLogin(): boolean {
  if (!activeLoopback) return false
  activeLoopback.cancel('Microsoft-Anmeldung abgebrochen')
  activeLoopback = null
  return true
}

/** Entfernt ein Konto aus dem MSAL-Cache (z. B. nach einer Anmeldung mit falscher Adresse). */
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
 * Frisches Access-Token (silent, mit Refresh). Ist ein Re-Login nötig
 * (Refresh-Token abgelaufen/widerrufen, kein Konto im Cache), wirft die
 * Funktion einen ReauthRequiredError → needs-reauth statt Backoff-Loop.
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
