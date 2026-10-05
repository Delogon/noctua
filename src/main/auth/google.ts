import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { getSetting } from '../db'
import { getOrgConfig } from '../org-config'
import type { OrgConfig } from '@shared/org-config'
import { deleteSecret, getSecret, setSecret } from './secrets'
import { isGoogleReauthCode, ReauthRequiredError } from './reauth'

/**
 * Google-OAuth für Gmail-Konten (Loopback-Flow mit PKCE, wie beim
 * Microsoft-Login: Anmeldung im System-Browser, kein Passwort in der App).
 *
 * Client-ID: Default ist Thunderbirds öffentlich dokumentierter Google-Client
 * (gängige Praxis bei OSS-Mail-Tools; das „Secret" eines Installed-App-Clients
 * gilt laut Google ausdrücklich nicht als vertraulich). Über die Settings
 * `google.clientId`/`google.clientSecret` durch eine eigene Registrierung
 * ersetzbar. Nur das Refresh-Token wird gespeichert — verschlüsselt im Vault.
 */
const THUNDERBIRD_GOOGLE_CLIENT_ID =
  '406964657835-aq8lmia8j95dhl1a2bvharmfk3t1hgqj.apps.googleusercontent.com'
const THUNDERBIRD_GOOGLE_CLIENT_SECRET = 'kSmqreRr0qwBWJgbf5Y-PjSU'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

// mail.google.com deckt IMAP und SMTP (XOAUTH2) ab; openid email liefert die
// angemeldete Adresse im id_token, ohne einen weiteren API-Aufruf zu brauchen.
export const GOOGLE_MAIL_SCOPE = 'https://mail.google.com/ openid email'

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const EXPIRY_MARGIN_MS = 60_000

/**
 * Client-Auflösung: explizite Main-Settings > Org-Konfiguration > Thunderbird-
 * Default. Ein Org-Client bekommt NIE das Thunderbird-Secret: ohne eigenes
 * clientSecret bleibt es leer (öffentlicher Client, wird nicht mitgeschickt).
 */
export function resolveGoogleClient(
  settings: { clientId: string | null; clientSecret: string | null },
  org: OrgConfig | null
): { clientId: string; clientSecret: string } {
  const orgGoogle = org?.oauth?.google
  const settingId = settings.clientId?.trim()
  const settingSecret = settings.clientSecret?.trim()
  if (settingId) {
    return {
      clientId: settingId,
      clientSecret: settingSecret || orgGoogle?.clientSecret || THUNDERBIRD_GOOGLE_CLIENT_SECRET
    }
  }
  if (orgGoogle) {
    return {
      clientId: orgGoogle.clientId,
      clientSecret: settingSecret || orgGoogle.clientSecret || ''
    }
  }
  return {
    clientId: THUNDERBIRD_GOOGLE_CLIENT_ID,
    clientSecret: settingSecret || THUNDERBIRD_GOOGLE_CLIENT_SECRET
  }
}

function googleClient(): { clientId: string; clientSecret: string } {
  return resolveGoogleClient(
    { clientId: getSetting('google.clientId'), clientSecret: getSetting('google.clientSecret') },
    getOrgConfig()
  )
}

function clientId(): string {
  return googleClient().clientId
}

function clientSecret(): string {
  return googleClient().clientSecret
}

function refreshSecretKey(email: string): string {
  return `google:refresh:${email.toLowerCase()}`
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PKCE-Paar: verifier (Zufall) + S256-Challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Autorisierungs-URL — pur gehalten, damit die Parameter testbar sind. */
export function googleAuthUrl(options: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: GOOGLE_MAIL_SCOPE,
    // Refresh-Token nur mit offline+consent — sonst kommt nach dem ersten
    // Login keines mehr, und die App könnte Tokens nicht erneuern.
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: options.challenge,
    code_challenge_method: 'S256',
    state: options.state
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

/**
 * E-Mail-Adresse aus dem id_token (JWT-Payload). Keine Signaturprüfung nötig:
 * Das Token kommt direkt von Googles Token-Endpoint über TLS.
 */
export function emailFromIdToken(idToken: string): string | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    ) as { email?: unknown }
    return typeof json.email === 'string' && json.email.includes('@')
      ? json.email.toLowerCase()
      : null
  } catch {
    return null
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  error?: string
  error_description?: string
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(
      Object.entries(params).filter(([key, value]) => key !== 'client_secret' || value !== '')
    ).toString()
  })
  const body = (await response.json().catch(() => null)) as TokenResponse | null
  // Google meldet Fehler (z. B. invalid_grant) als HTTP 400 mit JSON-Body —
  // den reichen wir durch, die Aufrufer werten error/error_description aus.
  // Ohne verwertbaren Body (Proxy-Fehlerseite, 5xx) gibt es einen klaren Fehler.
  if (!response.ok && !body?.error) {
    throw new Error(`Google-Token-Anfrage fehlgeschlagen (HTTP ${response.status})`)
  }
  if (!body) throw new Error('Google-Token-Anfrage lieferte keine gültige Antwort')
  return body
}

const HTML_HEAD = '<html><body style="font-family:sans-serif;padding:2rem">'
const SUCCESS_HTML = `${HTML_HEAD}<h3>Angemeldet.</h3>Du kannst dieses Fenster schließen und zu Noctua zurückkehren.</body></html>`
const ERROR_HTML = `${HTML_HEAD}<h3>Anmeldung fehlgeschlagen.</h3>Bitte in Noctua erneut versuchen.</body></html>`

/** In-Memory-Cache für Access-Tokens (leben ~1 h) je Adresse. */
const accessTokens = new Map<string, { token: string; expiresAt: number }>()

/** Bricht den gerade wartenden Login ab — Ziel des CANCEL-Knopfs (Design 3b). */
let activeCancel: (() => void) | null = null

/** Bricht einen wartenden Google-Login ab; false, wenn keiner läuft. */
export function cancelGoogleLogin(): boolean {
  if (!activeCancel) return false
  activeCancel()
  return true
}

/**
 * Interaktiver Login: öffnet den System-Browser, nimmt den Redirect auf einem
 * Loopback-Port entgegen und tauscht den Code gegen Tokens. Gibt die
 * tatsächlich angemeldete Adresse zurück; das Refresh-Token landet im Vault.
 */
export async function googleInteractiveLogin(): Promise<{ email: string }> {
  const { verifier, challenge } = pkcePair()
  const state = base64url(randomBytes(16))

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error: Error | null, email?: string): void => {
      if (settled) return
      settled = true
      if (activeCancel === cancelThis) activeCancel = null
      clearTimeout(timeout)
      server.close()
      server.closeAllConnections()
      if (error) reject(error)
      else resolve({ email: email! })
    }
    const cancelThis = (): void => finish(new Error('Google-Anmeldung abgebrochen'))
    activeCancel = cancelThis

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const fail = (message: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(ERROR_HTML)
        finish(new Error(message))
      }
      if (url.searchParams.get('state') !== state) {
        fail('Google-Anmeldung: state stimmt nicht überein')
        return
      }
      const oauthError = url.searchParams.get('error')
      if (oauthError) {
        fail(`Google-Anmeldung abgebrochen (${oauthError})`)
        return
      }
      const code = url.searchParams.get('code')
      if (!code) {
        fail('Google-Anmeldung lieferte keinen Code')
        return
      }
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      void tokenRequest({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: `http://127.0.0.1:${port}/callback`
      })
        .then((tokens) => {
          if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token) {
            fail(
              `Google-Anmeldung fehlgeschlagen: ${tokens.error_description ?? tokens.error ?? 'keine Tokens erhalten'}`
            )
            return
          }
          const email = emailFromIdToken(tokens.id_token)
          if (!email) {
            fail('Google-Anmeldung lieferte keine E-Mail-Adresse')
            return
          }
          setSecret(refreshSecretKey(email), tokens.refresh_token)
          accessTokens.set(email, {
            token: tokens.access_token,
            expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000
          })
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_HTML)
          finish(null, email)
        })
        .catch((error: unknown) =>
          fail(error instanceof Error ? error.message : 'Token-Tausch fehlgeschlagen')
        )
    })

    const timeout = setTimeout(
      () => finish(new Error('Google-Anmeldung: Zeitüberschreitung — bitte erneut versuchen')),
      LOGIN_TIMEOUT_MS
    )

    server.on('error', (error) => finish(error))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const url = googleAuthUrl({
        clientId: clientId(),
        redirectUri: `http://127.0.0.1:${port}/callback`,
        challenge,
        state
      })
      void shell.openExternal(url)
    })
  })
}

/** Frisches Access-Token (mit Refresh); wirft, wenn ein Re-Login nötig ist. */
export async function googleAccessToken(email: string): Promise<string> {
  const key = email.toLowerCase()
  const cached = accessTokens.get(key)
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.token

  const refreshToken = getSecret(refreshSecretKey(key))
  if (!refreshToken)
    throw new ReauthRequiredError('Google-Konto nicht angemeldet — bitte erneut anmelden')

  const tokens = await tokenRequest({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  })
  if (!tokens.access_token) {
    if (isGoogleReauthCode(tokens.error)) {
      // Zugriff widerrufen oder Token abgelaufen — Rest aufräumen, Re-Login nötig
      deleteSecret(refreshSecretKey(key))
      accessTokens.delete(key)
      throw new ReauthRequiredError('Google-Zugriff widerrufen — bitte erneut anmelden')
    }
    throw new Error(
      `Google-Token-Refresh fehlgeschlagen: ${tokens.error_description ?? tokens.error ?? 'unbekannt'}`
    )
  }
  accessTokens.set(key, {
    token: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000
  })
  return tokens.access_token
}
