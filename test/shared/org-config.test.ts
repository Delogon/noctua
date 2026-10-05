import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  orgConfigSchema,
  parseOrgConfig,
  slugifyProductName,
  updateManifestSchema
} from '@shared/org-config'
import { invokeContract } from '@shared/ipc-contract'
import { networkConnectionsSchema } from '@shared/types'

describe('Org-Konfiguration: Schema', () => {
  it('die mitgelieferte Beispieldatei ist gültig', () => {
    const raw = readFileSync('build/org-config.example.json', 'utf8')
    const config = parseOrgConfig(raw)
    expect(config.productName).toBe('Acme Mail')
    expect(config.aiProfiles).toHaveLength(2)
  })

  it('leeres Objekt ist gültig (alles optional)', () => {
    expect(orgConfigSchema.parse({})).toEqual({})
  })

  it('akzeptiert alle drei Update-Modi', () => {
    expect(orgConfigSchema.safeParse({ updates: { mode: 'github', repo: 'a/b' } }).success).toBe(
      true
    )
    expect(
      orgConfigSchema.safeParse({ updates: { mode: 'url', url: 'https://x.test/latest.json' } })
        .success
    ).toBe(true)
    expect(orgConfigSchema.safeParse({ updates: { mode: 'off' } }).success).toBe(true)
  })

  it.each([
    ['unbekanntes Feld', { nope: 1 }],
    ['Update-URL ohne https', { updates: { mode: 'url', url: 'http://x.test/l.json' } }],
    ['Update-Repo ohne owner', { updates: { mode: 'github', repo: 'nur-name' } }],
    ['Modus url ohne url', { updates: { mode: 'url' } }],
    ['unbekannter Modus', { updates: { mode: 'ftp' } }],
    ['appId ohne Punkt', { appId: 'nodots' }],
    ['executableName mit Leerzeichen', { executableName: 'my app' }],
    ['Link ohne https', { links: { homepage: 'javascript:alert(1)' } }],
    ['ungültige Sprache', { defaults: { language: 'fr' } }],
    ['ungültiger Bilder-Default', { defaults: { remoteImagesDefault: 'ask' } }],
    [
      'Profil mit reservierter ID',
      {
        aiProfiles: [
          {
            id: 'openrouter',
            name: 'x',
            baseUrl: 'https://a.test',
            apiStyle: 'chat',
            isLocal: false
          }
        ]
      }
    ],
    [
      'Profil mit ungültiger ID',
      {
        aiProfiles: [
          { id: 'Big Id', name: 'x', baseUrl: 'https://a.test', apiStyle: 'chat', isLocal: false }
        ]
      }
    ],
    [
      'Profil mit ftp-URL',
      {
        aiProfiles: [
          { id: 'a', name: 'x', baseUrl: 'ftp://a.test', apiStyle: 'chat', isLocal: false }
        ]
      }
    ],
    [
      'doppelte Profil-ID',
      {
        aiProfiles: [
          { id: 'a', name: 'x', baseUrl: 'https://a.test', apiStyle: 'chat', isLocal: false },
          { id: 'a', name: 'y', baseUrl: 'https://b.test', apiStyle: 'chat', isLocal: false }
        ]
      }
    ],
    [
      'unbekannte Aufgabe',
      {
        aiProfiles: [
          {
            id: 'a',
            name: 'x',
            baseUrl: 'https://a.test',
            apiStyle: 'chat',
            isLocal: false,
            tasks: { chat: 'm' }
          }
        ]
      }
    ],
    ['Google ohne clientId', { oauth: { google: { clientSecret: 's' } } }]
  ])('lehnt ab: %s', (_name, input) => {
    expect(orgConfigSchema.safeParse(input).success).toBe(false)
  })

  it('parseOrgConfig nennt alle Probleme lesbar auf einmal', () => {
    expect(() => parseOrgConfig('{"appId":"x","bogus":true}')).toThrow(/appId[\s\S]*Unrecognized/)
    expect(() => parseOrgConfig('{kaputt')).toThrow(/kein gültiges JSON/)
  })

  it('Update-Manifest: version + https-url, notes optional', () => {
    expect(
      updateManifestSchema.safeParse({ version: '1.2.3', url: 'https://x.test/d' }).success
    ).toBe(true)
    expect(updateManifestSchema.safeParse({ version: 'abc', url: 'https://x.test' }).success).toBe(
      false
    )
    expect(updateManifestSchema.safeParse({ version: '1.0.0', url: 'http://x.test' }).success).toBe(
      false
    )
  })

  it('slugifyProductName', () => {
    expect(slugifyProductName('Acme Mail!')).toBe('acme-mail')
    expect(slugifyProductName('!!!')).toBe('app')
  })
})

describe('IPC: Netzwerkverbindungen und Org-Info', () => {
  it('Kanäle sind im Vertrag; Output hat Längengrenzen', () => {
    expect(invokeContract['privacy:networkConnections']).toBeDefined()
    expect(invokeContract['org:info']).toBeDefined()
    const long = 'x'.repeat(300)
    expect(
      networkConnectionsSchema.safeParse({
        localOnly: false,
        connections: [
          { kind: 'mail', label: long, host: 'h', scope: 'external', status: 'active', tasks: [] }
        ]
      }).success
    ).toBe(false)
  })
})
