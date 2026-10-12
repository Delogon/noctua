import { fileURLToPath } from 'url'
import { resolve } from 'path'
import { ZodError } from 'zod'
import { ForbiddenKeyError } from '@shared/settings-keys'

/**
 * Reine Sicherheits-Helfer des Main-Prozesses (ohne Electron-Import, damit
 * sie unter Vitest direkt testbar sind): Dev-Erkennung, Sender-Prüfung für
 * IPC, Berechtigungs-Entscheidungen, CSP und Fehler-Bereinigung.
 */

// ---------------------------------------------------------------------------
// Dev-Erkennung (SEC-10)
// ---------------------------------------------------------------------------

/** Liegt die App in einem app.asar? Dann ist es ein Produktions-Bundle. */
export function isAsarAppPath(appPath: string): boolean {
  return /\.asar([\\/]|$)/i.test(appPath)
}

/**
 * NOCTUA_DEV wirkt nur, wenn die App NICHT als asar-Bundle läuft. Der gebrandete
 * Dev-Wrapper (scripts/prepare-dev-app.mjs) meldet zwar app.isPackaged=true,
 * lädt aber den Projektordner (appPath = Repo-Verzeichnis, kein .asar). Ein
 * installiertes Produktions-Build (electron-builder, asar) hat immer einen
 * .asar-Pfad — die Umgebungsvariable kann es also nicht in den Dev-Modus
 * kippen (kein Credential-Seeding, kein Remote-Renderer, kein DevTools-Menü).
 */
export function resolveIsDev(opts: {
  isPackaged: boolean
  devEnv: string | undefined
  appPath: string
}): boolean {
  if (!opts.isPackaged) return true
  return opts.devEnv === '1' && !isAsarAppPath(opts.appPath)
}

/** Dev-Renderer-URL nur für Loopback-Hosts — nie ein entfernter Server. */
export function safeDevRendererUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && loopback) return u.toString()
  } catch {
    // ungültige URL
  }
  return null
}

// ---------------------------------------------------------------------------
// Vertrauenswürdige App-Seiten (SEC-7, SEC-5)
// ---------------------------------------------------------------------------

export interface TrustedAppPages {
  /** Absoluter Pfad der gebauten index.html (Produktion) */
  indexPath: string
  /** Vite-Dev-Server-URL — nur im Dev-Modus gesetzt */
  devUrl: string | null
}

/** Exakte App-Seite: die gebaute index.html (file://) oder der Dev-Server-Origin. */
export function isTrustedAppUrl(url: string | undefined | null, pages: TrustedAppPages): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol === 'file:') {
      return resolve(fileURLToPath(u)) === resolve(pages.indexPath)
    }
    if (pages.devUrl) return u.origin === new URL(pages.devUrl).origin
  } catch {
    // ungültige URL
  }
  return false
}

export interface SenderInfo {
  /** event.senderFrame === mainWindow.webContents.mainFrame */
  isMainWindowTopFrame: boolean
  /** senderFrame.url (leer, wenn der Frame bereits zerstört ist) */
  frameUrl: string | undefined | null
}

/** IPC-Sender-Prüfung: nur der Top-Frame des Hauptfensters auf der App-Seite. */
export function isTrustedIpcSender(sender: SenderInfo, pages: TrustedAppPages): boolean {
  return sender.isMainWindowTopFrame && isTrustedAppUrl(sender.frameUrl, pages)
}

/**
 * Berechtigungen: standardmäßig verboten. Erlaubt ist nur das Mikrofon (Diktat,
 * useListeningAudio) für die eigene App-Seite — keine Kamera. Zwischenablage
 * (clipboard-sanitized-write) nutzt der Renderer nicht (nur paste-Events,
 * die keine Berechtigung brauchen) und bleibt deshalb ebenfalls verboten.
 */
export function isPermissionAllowed(opts: {
  permission: string
  /** 'audio' | 'video' | 'unknown' bzw. die mediaTypes des Requests */
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
// CSP-Header (SEC-5)
// ---------------------------------------------------------------------------

/**
 * Spiegelt die Meta-CSP aus src/renderer/index.html (test/main/security.test.ts
 * prüft die Übereinstimmung) und ergänzt die Direktiven, die per <meta> nicht
 * wirken (frame-ancestors) bzw. nur als Header sinnvoll sind.
 *
 * Sandbox-iframe mit srcdoc (Mail-Renderer): srcdoc-Dokumente erben die CSP des
 * Eltern-Dokuments und werden nicht über frame-src geladen — dafür ist keine
 * zusätzliche Quelle nötig. frame-ancestors greift nur bei Netzwerk-Navigation
 * eines Frames, nicht bei srcdoc.
 */
export const APP_CSP_BASE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws:"

export const APP_CSP_EXTRA =
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export const APP_CSP = `${APP_CSP_BASE}; ${APP_CSP_EXTRA}`

// ---------------------------------------------------------------------------
// Fehler-Bereinigung (SEC-8)
// ---------------------------------------------------------------------------

/**
 * Was der Renderer von einem IPC-Fehler sieht. Zod-Issues (Pfade, erwartete
 * Typen, Eingabewerte) bleiben im Main-Log; handlerseitige Fehlermeldungen
 * (bewusst nutzerlesbar, z. B. „Postfachname bereits vergeben") laufen durch,
 * werden aber gekürzt.
 */
export function sanitizeIpcError(error: unknown, phase: 'input' | 'output' | 'handler'): Error {
  if (error instanceof ZodError) {
    return new Error(phase === 'output' ? 'Ungültige Antwort' : 'Ungültige Anfrage')
  }
  if (error instanceof ForbiddenKeyError) return new Error(error.message)
  const message = error instanceof Error ? error.message : String(error)
  return new Error(message.slice(0, 300) || 'Unbekannter Fehler')
}
