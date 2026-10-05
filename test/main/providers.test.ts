import { describe, it, expect } from 'vitest'
import { buildImapOptions, isLoopbackHost, PROVIDER_DEFAULTS } from '@main/auth/providers'

const base = { email: 'x@test.de', provider: 'imap' as const, imap_host: 'imap.test', imap_port: 993 }

describe('buildImapOptions', () => {
  it('nutzt Passwort-Auth für klassische Konten', () => {
    const opts = buildImapOptions(base, { user: 'x@test.de', pass: 'geheim' })
    expect(opts.auth).toEqual({ user: 'x@test.de', pass: 'geheim' })
    expect(opts.secure).toBe(true)
  })

  it('nutzt XOAUTH2-Token, wenn eines vorhanden ist', () => {
    const opts = buildImapOptions(base, { user: 'x@test.de', accessToken: 'tok123' })
    expect(opts.auth).toEqual({ user: 'x@test.de', accessToken: 'tok123' })
    expect('pass' in opts.auth).toBe(false)
  })

  it('markiert Nicht-993-Ports als STARTTLS (secure=false)', () => {
    const opts = buildImapOptions({ ...base, imap_port: 1143 }, { user: 'x', pass: 'p' })
    expect(opts.secure).toBe(false)
  })

  it('akzeptiert selbstsignierte Zertifikate NUR auf Loopback (Proton Bridge)', () => {
    const bridge = buildImapOptions(
      { ...base, imap_host: '127.0.0.1', imap_port: 1143 },
      { user: 'x', pass: 'p' }
    )
    expect(bridge.tls).toEqual({ rejectUnauthorized: false })
    // Für echte Hosts bleibt die Zertifikatsprüfung strikt an
    const remote = buildImapOptions(base, { user: 'x', pass: 'p' })
    expect(remote.tls).toBeUndefined()
  })
})

describe('buildImapOptions — Transportsicherheit (SEC-3)', () => {
  const creds = { user: 'x', pass: 'p' }

  it('993 = implizites TLS, ohne doSTARTTLS (imapflow verbietet die Kombination)', () => {
    const opts = buildImapOptions(base, creds)
    expect(opts.secure).toBe(true)
    expect(opts.doSTARTTLS).toBeUndefined()
  })

  it('Nicht-Loopback auf anderem Port: STARTTLS ist Pflicht', () => {
    const opts = buildImapOptions({ ...base, imap_port: 143 }, creds)
    expect(opts.secure).toBe(false)
    expect(opts.doSTARTTLS).toBe(true)
  })

  it('Loopback (Bridge) bleibt opportunistisch', () => {
    const opts = buildImapOptions({ ...base, imap_host: '127.0.0.1', imap_port: 1143 }, creds)
    expect(opts.secure).toBe(false)
    expect(opts.doSTARTTLS).toBeUndefined()
  })

  it('setzt Timeouts; socketTimeout bleibt IDLE-tauglich (>= 5 min)', () => {
    const opts = buildImapOptions(base, creds)
    expect(opts.connectionTimeout).toBeGreaterThan(0)
    expect(opts.greetingTimeout).toBeGreaterThan(0)
    expect(opts.socketTimeout).toBeGreaterThanOrEqual(5 * 60_000)
  })
})

describe('isLoopbackHost', () => {
  it('erkennt Loopback-Varianten', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('LOCALHOST ')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
  })

  it('lehnt alles andere ab — auch Ähnliches', () => {
    expect(isLoopbackHost('imap.gmail.com')).toBe(false)
    expect(isLoopbackHost('localhost.evil.de')).toBe(false)
    expect(isLoopbackHost('127.0.0.1.evil.de')).toBe(false)
  })
})

describe('PROVIDER_DEFAULTS', () => {
  it('Microsoft nutzt Outlook-Hosts mit OAuth-Credential-Typ', () => {
    expect(PROVIDER_DEFAULTS.microsoft.imapHost).toBe('outlook.office365.com')
    expect(PROVIDER_DEFAULTS.microsoft.smtpPort).toBe(587)
    expect(PROVIDER_DEFAULTS.microsoft.credentialType).toBe('oauth-ms')
  })
})
