import { createServer, type Server } from 'node:http'
import { AuthError } from '@azure/msal-node'
import type { AuthorizeResponse, ILoopbackClient } from '@azure/msal-node'

/**
 * Abortable loopback server for Microsoft OAuth (Design 3b).
 *
 * msal-node ships its own LoopbackClient, but offers no way to abort a
 * running login — the CANCEL button in the accounts sheet needs exactly
 * that. This implementation mirrors msal's behavior
 * (loopback on 127.0.0.1, redirect URI http://localhost:{port}, success/
 * error template) and adds cancel(): closes the server, rejects the pending
 * listenForAuthCode promise — acquireTokenInteractive thus aborts
 * cleanly.
 */
/** Like google.ts: after 5 minutes without a redirect the login gives up. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

export class CancelableLoopbackClient implements ILoopbackClient {
  private server: Server | null = null
  private rejectListener: ((error: Error) => void) | null = null
  private canceled = false
  private timeout: NodeJS.Timeout | null = null

  listenForAuthCode(successTemplate?: string, errorTemplate?: string): Promise<AuthorizeResponse> {
    if (this.server) {
      return Promise.reject(new Error('Loopback-Server läuft bereits'))
    }
    return new Promise<AuthorizeResponse>((resolve, reject) => {
      this.rejectListener = reject
      this.timeout = setTimeout(() => {
        this.rejectListener = null
        this.closeServer()
        reject(new Error('Die Microsoft-Anmeldung ist abgelaufen – bitte versuche es erneut'))
      }, LOGIN_TIMEOUT_MS)
      this.timeout.unref?.()
      this.server = createServer((req, res) => {
        const url = req.url ?? ''
        if (url === '/') {
          // After receiving the code, msal redirects to "/" so the auth code
          // does not end up in the browser history — this is where the
          // success page comes.
          res.end(successTemplate ?? 'Angemeldet. Dieses Fenster kann geschlossen werden.')
          return
        }
        const parsed = new URL(url, this.getRedirectUri())
        const response: AuthorizeResponse = {}
        for (const [key, value] of parsed.searchParams) {
          ;(response as Record<string, string>)[key] = value
        }
        if (response.code) {
          res.writeHead(302, { location: this.getRedirectUri() })
          res.end()
        } else {
          res.end(errorTemplate ?? `Anmeldung fehlgeschlagen: ${response.error ?? 'unbekannt'}`)
        }
        this.rejectListener = null
        resolve(response)
        // The redirect to "/" (success page) still needs the server briefly —
        // then close it so no port stays open. msal checks state itself
        // (validateState in acquireTokenByCode → state_mismatch).
        setTimeout(() => this.closeServer(), 5000).unref?.()
      })
      this.server.listen(0, '127.0.0.1')
    })
  }

  getRedirectUri(): string {
    if (this.canceled) {
      // No NodeAuthError "noLoopbackServerExists": msal's redirect URI polling
      // would keep waiting on it — a generic error aborts immediately.
      throw new Error('Anmeldung abgebrochen')
    }
    if (!this.server || !this.server.listening) {
      // Exactly msal's error type + code, so waitForRedirectUri keeps polling
      // until the server listens (race between listen() and getRedirectUri()).
      throw new AuthError('no_loopback_server_exists', 'Loopback-Server lauscht noch nicht')
    }
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Loopback-Adresse unbekannt')
    }
    return `http://localhost:${address.port}`
  }

  closeServer(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = null
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
  }

  /** Aborts the waiting login — the caller gets `message` as the error. */
  cancel(message: string): void {
    this.canceled = true
    const reject = this.rejectListener
    this.rejectListener = null
    this.closeServer()
    reject?.(new Error(message))
  }
}
