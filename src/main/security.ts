import { fileURLToPath } from 'url'
import { resolve } from 'path'
import { ZodError } from 'zod'
import { ForbiddenKeyError } from '@shared/settings-keys'

/**
 * Pure security helpers of the main process (no Electron import, so they are
 * directly testable under Vitest): dev detection, sender checks for
 * IPC, permission decisions, CSP and error sanitizing.
 */

// ---------------------------------------------------------------------------
// Dev detection (SEC-10)
// ---------------------------------------------------------------------------

/** Is the app inside an app.asar? Then it is a production bundle. */
export function isAsarAppPath(appPath: string): boolean {
  return /\.asar([\\/]|$)/i.test(appPath)
}

/**
 * NOCTUA_DEV only takes effect if the app is NOT running as an asar bundle. The
 * branded dev wrapper (scripts/prepare-dev-app.mjs) does report app.isPackaged=true,
 * but loads the project folder (appPath = repo directory, no .asar). An
 * installed production build (electron-builder, asar) always has an
 * .asar path — so the environment variable cannot flip it into dev mode
 * (no credential seeding, no remote renderer, no DevTools menu).
 */
export function resolveIsDev(opts: {
  isPackaged: boolean
  devEnv: string | undefined
  appPath: string
}): boolean {
  if (!opts.isPackaged) return true
  return opts.devEnv === '1' && !isAsarAppPath(opts.appPath)
}

/** Dev renderer URL only for loopback hosts — never a remote server. */
export function safeDevRendererUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && loopback) return u.toString()
  } catch {
    // invalid URL
  }
  return null
}

// ---------------------------------------------------------------------------
// Trusted app pages (SEC-7, SEC-5)
// ---------------------------------------------------------------------------

export interface TrustedAppPages {
  /** Absolute path of the built index.html (production) */
  indexPath: string
  /** Vite dev server URL — only set in dev mode */
  devUrl: string | null
}

/** Exact app page: the built index.html (file://) or the dev server origin. */
export function isTrustedAppUrl(url: string | undefined | null, pages: TrustedAppPages): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') {
      return resolve(fileURLToPath(u)) === resolve(pages.indexPath)
    }
    if (pages.devUrl) return u.origin === new URL(pages.devUrl).origin
  } catch {
    // invalid URL
  }
  return false
}

export interface SenderInfo {
  /** event.senderFrame === mainWindow.webContents.mainFrame */
  isMainWindowTopFrame: boolean
  /** senderFrame.url (empty if the frame is already destroyed) */
  frameUrl: string | undefined | null
}

/** IPC sender check: only the top frame of the main window on the app page. */
export function isTrustedIpcSender(sender: SenderInfo, pages: TrustedAppPages): boolean {
  return sender.isMainWindowTopFrame && isTrustedAppUrl(sender.frameUrl, pages)
}

/**
 * Permissions: denied by default. Only the microphone (dictation,
 * useListeningAudio) is allowed, for our own app page — no camera. Clipboard
 * (clipboard-sanitized-write) is not used by the renderer (only paste events,
 * which need no permission) and therefore stays denied as well.
 */
export function isPermissionAllowed(opts: {
  permission: string
  /** 'audio' | 'video' | 'unknown' or the request's mediaTypes */
  mediaTypes?: readonly string[]
  fromMainWindow: boolean
  requestingUrl: string | undefined | null
  pages: TrustedAppPages
}): boolean {
  if (!opts.fromMainWindow) return false
  if (opts.permission !== 'media') return false
  if (!opts.mediaTypes || opts.mediaTypes.length === 0) return false
  if (!opts.mediaTypes.every((t) => t === 'audio')) return false
  return isTrustedAppUrl(opts.requestingUrl, opts.pages)
}

// ---------------------------------------------------------------------------
// CSP header (SEC-5)
// ---------------------------------------------------------------------------

/**
 * Mirrors the meta CSP from src/renderer/index.html (test/main/security.test.ts
 * checks they match) and adds the directives that have no effect via <meta>
 * (frame-ancestors) or only make sense as a header.
 *
 * Sandbox iframe with srcdoc (mail renderer): srcdoc documents inherit the parent
 * document's CSP and are not loaded via frame-src — so no additional source is
 * needed for them. frame-ancestors only applies to network navigation
 * of a frame, not to srcdoc.
 */
export const APP_CSP_BASE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws:"

export const APP_CSP_EXTRA =
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export const APP_CSP = `${APP_CSP_BASE}; ${APP_CSP_EXTRA}`

// ---------------------------------------------------------------------------
// Error sanitizing (SEC-8)
// ---------------------------------------------------------------------------

/**
 * What the renderer sees of an IPC error. Zod issues (paths, expected
 * types, input values) stay in the main log; handler-side error messages
 * (deliberately user-readable, e.g. "Postfachname bereits vergeben") pass through,
 * but are truncated.
 */
export function sanitizeIpcError(error: unknown, phase: 'input' | 'output' | 'handler'): Error {
  if (error instanceof ZodError) {
    return new Error(phase === 'output' ? 'Ungültige Antwort' : 'Ungültige Anfrage')
  }
  if (error instanceof ForbiddenKeyError) return new Error(error.message)
  const message = error instanceof Error ? error.message : String(error)
  return new Error(message.slice(0, 300) || 'Unbekannter Fehler')
}
