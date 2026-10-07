/**
 * Erkennung von „Anmeldung nötig"-Fehlern bei OAuth-Konten. Ein widerrufenes
 * oder abgelaufenes Refresh-Token hilft kein Reconnect-Loop — die Sync-Engine
 * mappt solche Fehler auf den Zustand `needs-reauth` (siehe isAuthFailure in
 * account-syncer.ts), die UI bietet dann „Erneut anmelden" an.
 */
export class ReauthRequiredError extends Error {
  readonly needsReauth = true
  constructor(message: string) {
    super(message)
    this.name = 'ReauthRequiredError'
  }
}

export function isReauthError(error: unknown): boolean {
  return (
    error instanceof ReauthRequiredError ||
    (error as { needsReauth?: unknown } | null)?.needsReauth === true
  )
}

/** OAuth-Fehlercodes, bei denen nur eine interaktive Anmeldung weiterhilft. */
const REAUTH_CODES = new Set([
  'invalid_grant',
  'interaction_required',
  'consent_required',
  'login_required',
  'bad_token',
  'no_tokens_found',
  'user_null'
])

/**
 * MSAL wirft bei abgelaufenem/widerrufenem Refresh-Token eine
 * InteractionRequiredAuthError (errorCode z. B. invalid_grant /
 * interaction_required). Duck-Typing statt instanceof: robust gegen mehrfach
 * gebündelte msal-common-Kopien und in Tests ohne MSAL-Klassen konstruierbar.
 */
export function isMsalReauthError(error: unknown): boolean {
  const e = error as { name?: unknown; errorCode?: unknown; subError?: unknown } | null
  if (!e || typeof e !== 'object') return false
  if (e.name === 'InteractionRequiredAuthError') return true
  return (
    (typeof e.errorCode === 'string' && REAUTH_CODES.has(e.errorCode)) ||
    (typeof e.subError === 'string' && REAUTH_CODES.has(e.subError))
  )
}

/** Wandelt MSAL-Refresh-Fehler in ReauthRequiredError; alles andere bleibt unverändert. */
export function mapMsalError(error: unknown): unknown {
  if (isMsalReauthError(error)) {
    const detail = error instanceof Error ? error.message : String(error)
    return new ReauthRequiredError(
      `Microsoft-Anmeldung abgelaufen — bitte erneut anmelden (${detail})`
    )
  }
  return error
}

/** Google-Token-Endpoint: error-Feld der JSON-Antwort. */
export function isGoogleReauthCode(code: string | undefined): boolean {
  return code === 'invalid_grant'
}
