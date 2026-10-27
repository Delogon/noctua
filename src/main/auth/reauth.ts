/**
 * Detection of "sign-in required" errors for OAuth accounts. A reconnect loop
 * does not help with a revoked or expired refresh token — the sync engine
 * maps such errors to the `needs-reauth` state (see isAuthFailure in
 * account-syncer.ts), and the UI then offers "Sign in again".
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

/** OAuth error codes where only an interactive sign-in helps. */
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
 * On an expired/revoked refresh token MSAL throws an
 * InteractionRequiredAuthError (errorCode e.g. invalid_grant /
 * interaction_required). Duck typing instead of instanceof: robust against multiple
 * bundled msal-common copies and constructible in tests without MSAL classes.
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

/** Converts MSAL refresh errors into ReauthRequiredError; everything else stays unchanged. */
export function mapMsalError(error: unknown): unknown {
  if (isMsalReauthError(error)) {
    const detail = error instanceof Error ? error.message : String(error)
    return new ReauthRequiredError(
      `Microsoft-Anmeldung abgelaufen — bitte erneut anmelden (${detail})`
    )
  }
  return error
}

/** Google token endpoint: error field of the JSON response. */
export function isGoogleReauthCode(code: string | undefined): boolean {
  return code === 'invalid_grant'
}
