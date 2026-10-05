import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  APP_CSP,
  isAsarAppPath,
  isPermissionAllowed,
  isTrustedAppUrl,
  isTrustedIpcSender,
  resolveIsDev,
  safeDevRendererUrl,
  sanitizeIpcError,
  type TrustedAppPages
} from '@main/security'
import {
  assertSecretKey,
  assertSettingReadable,
  assertSettingWritable,
  ForbiddenKeyError
} from '@shared/settings-keys'

const prod: TrustedAppPages = {
  indexPath: '/Applications/Noctua.app/Contents/Resources/app.asar/out/renderer/index.html',
  devUrl: null
}
const dev: TrustedAppPages = {
  indexPath: '/repo/out/renderer/index.html',
  devUrl: 'http://localhost:5173/'
}

describe('isTrustedAppUrl / isTrustedIpcSender', () => {
  it('akzeptiert nur die gebaute index.html', () => {
    expect(isTrustedAppUrl(`file://${prod.indexPath}`, prod)).toBe(true)
    expect(isTrustedAppUrl(`file://${prod.indexPath}#/inbox`, prod)).toBe(true)
    expect(isTrustedAppUrl('file:///etc/passwd', prod)).toBe(false)
    expect(isTrustedAppUrl('https://evil.example/', prod)).toBe(false)
    expect(isTrustedAppUrl('about:srcdoc', prod)).toBe(false)
    expect(isTrustedAppUrl('', prod)).toBe(false)
    expect(isTrustedAppUrl(undefined, prod)).toBe(false)
  })

  it('akzeptiert den Dev-Server nur mit exaktem Origin', () => {
    expect(isTrustedAppUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isTrustedAppUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isTrustedAppUrl('http://localhost:5173.evil.com/', dev)).toBe(false)
    expect(isTrustedAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedAppUrl('http://localhost:5173/', prod)).toBe(false)
  })

  it('Sender: nur Top-Frame des Hauptfensters auf der App-Seite', () => {
    const url = `file://${prod.indexPath}`
    expect(isTrustedIpcSender({ isMainWindowTopFrame: true, frameUrl: url }, prod)).toBe(true)
    // Subframe (z. B. Mail-iframe) oder anderes Fenster
    expect(isTrustedIpcSender({ isMainWindowTopFrame: false, frameUrl: url }, prod)).toBe(false)
    // Top-Frame, aber auf fremder Seite
    expect(
      isTrustedIpcSender({ isMainWindowTopFrame: true, frameUrl: 'https://evil.example/' }, prod)
    ).toBe(false)
    // Zerstörter Frame
    expect(isTrustedIpcSender({ isMainWindowTopFrame: true, frameUrl: undefined }, prod)).toBe(
      false
    )
  })
})

describe('Dev-Erkennung (SEC-10)', () => {
  const asar = '/Applications/Noctua.app/Contents/Resources/app.asar'
  it('nicht verpackt = Dev', () => {
    expect(resolveIsDev({ isPackaged: false, devEnv: undefined, appPath: '/repo' })).toBe(true)
  })
  it('gebrandeter Dev-Wrapper (packaged, kein asar) mit NOCTUA_DEV = Dev', () => {
    expect(resolveIsDev({ isPackaged: true, devEnv: '1', appPath: '/repo' })).toBe(true)
  })
  it('Produktions-Bundle ignoriert NOCTUA_DEV', () => {
    expect(resolveIsDev({ isPackaged: true, devEnv: '1', appPath: asar })).toBe(false)
    expect(resolveIsDev({ isPackaged: true, devEnv: undefined, appPath: '/repo' })).toBe(false)
  })
  it('erkennt asar-Pfade', () => {
    expect(isAsarAppPath(asar)).toBe(true)
    expect(isAsarAppPath('C:\\x\\resources\\app.asar')).toBe(true)
    expect(isAsarAppPath('/repo/my.asar.d/app')).toBe(false)
  })
  it('Dev-Renderer-URL nur Loopback', () => {
    expect(safeDevRendererUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
    expect(safeDevRendererUrl('http://127.0.0.1:5173')).not.toBeNull()
    expect(safeDevRendererUrl('https://evil.example/')).toBeNull()
    expect(safeDevRendererUrl('file:///etc/passwd')).toBeNull()
    expect(safeDevRendererUrl(undefined)).toBeNull()
  })
})

describe('Berechtigungen (SEC-5)', () => {
  const url = `file://${prod.indexPath}`
  const base = { fromMainWindow: true, requestingUrl: url, pages: prod }
  it('erlaubt nur Mikrofon für die App-Seite', () => {
    expect(isPermissionAllowed({ ...base, permission: 'media', mediaTypes: ['audio'] })).toBe(true)
    expect(
      isPermissionAllowed({ ...base, permission: 'media', mediaTypes: ['audio', 'video'] })
    ).toBe(false)
    expect(isPermissionAllowed({ ...base, permission: 'media', mediaTypes: ['video'] })).toBe(false)
    expect(isPermissionAllowed({ ...base, permission: 'media' })).toBe(false)
    for (const permission of [
      'geolocation',
      'notifications',
      'clipboard-sanitized-write',
      'openExternal'
    ])
      expect(isPermissionAllowed({ ...base, permission, mediaTypes: ['audio'] })).toBe(false)
  })
  it('verweigert fremde Seiten, srcdoc und andere Fenster', () => {
    const m = { permission: 'media', mediaTypes: ['audio'] }
    expect(isPermissionAllowed({ ...base, ...m, requestingUrl: 'https://evil.example/' })).toBe(
      false
    )
    expect(isPermissionAllowed({ ...base, ...m, requestingUrl: 'about:srcdoc' })).toBe(false)
    expect(isPermissionAllowed({ ...base, ...m, fromMainWindow: false })).toBe(false)
  })
})

describe('CSP-Header (SEC-5)', () => {
  it('spiegelt die Meta-CSP aus index.html und härtet zusätzlich', () => {
    const html = readFileSync(join(__dirname, '../../src/renderer/index.html'), 'utf8')
    const meta = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
    expect(meta).toBeTruthy()
    const header = new Set(APP_CSP.split(';').map((d) => d.trim()))
    for (const directive of meta!.split(';').map((d) => d.trim())) {
      expect(header.has(directive), `Header-CSP weicht von der Meta-CSP ab: ${directive}`).toBe(
        true
      )
    }
    for (const d of [
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ])
      expect(header.has(d)).toBe(true)
  })
})

describe('IPC-Fehler bereinigen (SEC-8)', () => {
  it('versteckt zod-Issues', () => {
    const err = z.object({ a: z.string() }).safeParse({ a: 5 }).error!
    expect(sanitizeIpcError(err, 'input').message).toBe('Ungültige Anfrage')
    expect(sanitizeIpcError(err, 'output').message).toBe('Ungültige Antwort')
    expect(sanitizeIpcError(err, 'input').message).not.toMatch(/expected|path|invalid_type/i)
  })
  it('reicht Handler-Meldungen gekürzt durch', () => {
    expect(sanitizeIpcError(new Error('Postfachname vergeben'), 'handler').message).toBe(
      'Postfachname vergeben'
    )
    expect(sanitizeIpcError(new Error('x'.repeat(1000)), 'handler').message).toHaveLength(300)
    expect(sanitizeIpcError('boom', 'handler').message).toBe('boom')
  })
})

describe('Handler-seitige Schlüssel-Prüfung (SEC-2)', () => {
  it('lehnt OAuth-Client-Konfiguration und fremde Secrets ab', () => {
    for (const key of ['google.clientId', 'google.clientSecret', 'ms.clientId']) {
      expect(() => assertSettingReadable(key)).toThrow(ForbiddenKeyError)
      expect(() => assertSettingWritable(key)).toThrow(ForbiddenKeyError)
    }
    expect(() => assertSecretKey('account:1:password')).toThrow(ForbiddenKeyError)
    expect(() => assertSecretKey('openrouter.apiKey')).not.toThrow()
    expect(() => assertSettingWritable('sig.5')).not.toThrow()
    expect(() => assertSettingWritable('ai.styleMeta')).toThrow(ForbiddenKeyError)
    expect(() => assertSettingReadable('ai.styleMeta')).not.toThrow()
  })
})
