import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { getSetting, setSetting } from '@main/db'
import { setLocalOnly } from '@main/privacy'
import { checkForUpdates, startUpdateChecks, stopUpdateChecks } from '@main/updates'
import {
  __setOrgConfigForTest,
  helpLinks,
  packagedAppName,
  productName,
  resolveUpdateFeed
} from '@main/org-config'
import {
  applyOrgDefaults,
  defaultAiEnabledForNewAccounts,
  resolveLanguageDefault,
  seedOrgProfiles
} from '@main/org-defaults'
import {
  deleteProfile,
  getProfile,
  getTaskProfileId,
  listProfiles,
  setProfileKey,
  setTaskAssignment,
  updateProfile
} from '@main/ai/providers/registry'
import { resolveGoogleClient } from '@main/auth/google'
import { resolveMicrosoftClientId } from '@main/auth/msal'
import { buildNetworkConnections } from '@main/network-connections'
import type { OrgConfig } from '@shared/org-config'
import { closeTestDb, createTestDb } from '../helpers/db'

vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: vi.fn() } } })
}))

let db: Database.Database
beforeEach(() => {
  db = createTestDb()
})
afterEach(() => {
  closeTestDb(db)
  __setOrgConfigForTest(undefined)
  vi.unstubAllGlobals()
  stopUpdateChecks()
})

const profileCfg = {
  id: 'acme-llm',
  name: 'Acme LLM',
  baseUrl: 'https://llm.example.com/v1/',
  apiStyle: 'chat' as const,
  isLocal: false,
  tasks: { triage: 'small', draft: 'large' }
}

describe('Ohne Org-Konfiguration: Upstream-Verhalten', () => {
  it('Defaults sind die Upstream-Werte', () => {
    expect(productName()).toBe('Noctua')
    expect(packagedAppName()).toBe('noctua-prod')
    expect(defaultAiEnabledForNewAccounts()).toBe(1)
    expect(resolveUpdateFeed()).toMatchObject({
      mode: 'github',
      repo: 'Schereo/noctua',
      apiUrl: 'https://api.github.com/repos/Schereo/noctua/releases/latest',
      pageUrl: 'https://github.com/Schereo/noctua/releases/latest'
    })
    expect(helpLinks()).toMatchObject({
      homepage: 'https://github.com/Schereo/noctua',
      homepageIsUpstream: true
    })
  })

  it('applyOrgDefaults und seedOrgProfiles ändern nichts', () => {
    applyOrgDefaults('de-DE')
    seedOrgProfiles(db)
    expect(getSetting('privacy.localOnly')).toBeNull()
    expect(getSetting('ui.language')).toBeNull()
    expect(getSetting('mail.remoteImagesDefault')).toBeNull()
    expect(listProfiles().map((p) => p.id)).toEqual(['openrouter'])
  })
})

describe('Org-Defaults überschreiben nie Nutzerwahlen', () => {
  const config: OrgConfig = {
    defaults: {
      localOnly: true,
      remoteImagesDefault: 'allow',
      language: 'en',
      aiEnabledForNewAccounts: false
    }
  }

  it('setzt Defaults, solange nichts gesetzt ist', () => {
    __setOrgConfigForTest(config)
    applyOrgDefaults('de-DE')
    expect(getSetting('privacy.localOnly')).toBe('1')
    expect(getSetting('mail.remoteImagesDefault')).toBe('1')
    expect(getSetting('ui.language')).toBe('en')
    expect(defaultAiEnabledForNewAccounts()).toBe(0)
  })

  it('lässt gesetzte Werte unangetastet — auch bei erneutem Start', () => {
    setSetting('privacy.localOnly', '0')
    setSetting('mail.remoteImagesDefault', '0')
    setSetting('ui.language', 'de')
    __setOrgConfigForTest(config)
    applyOrgDefaults('en-US')
    expect(getSetting('privacy.localOnly')).toBe('0')
    expect(getSetting('mail.remoteImagesDefault')).toBe('0')
    expect(getSetting('ui.language')).toBe('de')
  })

  it('der Nutzer kann einen Org-Default später ändern, ein Neustart stellt ihn nicht zurück', () => {
    __setOrgConfigForTest(config)
    applyOrgDefaults('de-DE')
    setLocalOnly(false)
    applyOrgDefaults('de-DE')
    expect(getSetting('privacy.localOnly')).toBe('0')
  })

  it('Sprache auto folgt der Systemsprache', () => {
    expect(resolveLanguageDefault('auto', 'de-AT')).toBe('de')
    expect(resolveLanguageDefault('auto', 'fr-FR')).toBe('en')
    expect(resolveLanguageDefault('de', 'en-US')).toBe('de')
    __setOrgConfigForTest({ defaults: { language: 'auto' } })
    applyOrgDefaults('de-DE')
    expect(getSetting('ui.language')).toBe('de')
  })

  it('remoteImagesDefault block schreibt 0', () => {
    __setOrgConfigForTest({ defaults: { remoteImagesDefault: 'block' } })
    applyOrgDefaults('de-DE')
    expect(getSetting('mail.remoteImagesDefault')).toBe('0')
  })
})

describe('Org-AI-Profile: Seeding', () => {
  it('legt Profile als managed an und weist Aufgaben beim ersten Mal zu', () => {
    __setOrgConfigForTest({ aiProfiles: [profileCfg] })
    seedOrgProfiles(db)
    const p = getProfile('acme-llm')!
    expect(p).toMatchObject({
      name: 'Acme LLM',
      baseUrl: 'https://llm.example.com/v1',
      apiStyle: 'chat',
      isLocal: false,
      preset: 'custom',
      managed: true,
      hasKey: false
    })
    expect(getTaskProfileId('triage')).toBe('acme-llm')
    expect(getTaskProfileId('draft')).toBe('acme-llm')
    expect(getTaskProfileId('stt')).toBe('openrouter')
    expect(getSetting('ai.triageModel')).toBe('small')
    expect(getSetting('ai.draftModel')).toBe('large')
  })

  it('ist idempotent und weist Aufgaben nicht erneut zu', () => {
    __setOrgConfigForTest({ aiProfiles: [profileCfg] })
    seedOrgProfiles(db)
    // Nutzer stellt Triage auf OpenRouter zurück
    setTaskAssignment('triage', 'openrouter', '')
    seedOrgProfiles(db)
    seedOrgProfiles(db)
    expect(listProfiles().filter((p) => p.id === 'acme-llm')).toHaveLength(1)
    expect(getTaskProfileId('triage')).toBe('openrouter')
  })

  it('synchronisiert URL/Name eines bestehenden managed-Profils bei neuer Konfiguration', () => {
    __setOrgConfigForTest({ aiProfiles: [profileCfg] })
    seedOrgProfiles(db)
    __setOrgConfigForTest({
      aiProfiles: [{ ...profileCfg, name: 'Acme LLM 2', baseUrl: 'https://llm2.example.com/v1' }]
    })
    seedOrgProfiles(db)
    expect(getProfile('acme-llm')).toMatchObject({
      name: 'Acme LLM 2',
      baseUrl: 'https://llm2.example.com/v1'
    })
  })

  it('fasst ein eigenes (nicht managed) Profil mit gleicher ID nie an', () => {
    db.prepare(
      `INSERT INTO ai_profiles (id, name, base_url, api_style, is_local, preset, sort_order, created_at)
       VALUES ('acme-llm', 'Meins', 'http://localhost:1/v1', 'chat', 1, 'custom', 5, 1)`
    ).run()
    __setOrgConfigForTest({ aiProfiles: [profileCfg] })
    seedOrgProfiles(db)
    expect(getProfile('acme-llm')).toMatchObject({
      name: 'Meins',
      baseUrl: 'http://localhost:1/v1',
      managed: false
    })
    expect(getTaskProfileId('triage')).toBe('openrouter')
  })

  it('managed-Profile sind gesperrt, nur der Key ist änderbar', () => {
    __setOrgConfigForTest({ aiProfiles: [profileCfg] })
    seedOrgProfiles(db)
    const before = getProfile('acme-llm')!
    const after = updateProfile('acme-llm', {
      name: 'Hack',
      baseUrl: 'https://evil.test/v1',
      apiStyle: 'responses',
      isLocal: true
    })
    expect(after).toMatchObject({
      name: before.name,
      baseUrl: before.baseUrl,
      apiStyle: 'chat',
      isLocal: false
    })
    expect(() => deleteProfile('acme-llm')).toThrow(/Organisation/)
    setProfileKey('acme-llm', 'secret')
    expect(getProfile('acme-llm')!.hasKey).toBe(true)
  })

  it('lokale Profile und Aufgabe stt', () => {
    __setOrgConfigForTest({
      aiProfiles: [
        {
          id: 'stt-local',
          name: 'Whisper lokal',
          baseUrl: 'http://localhost:9000/v1',
          apiStyle: 'chat',
          isLocal: true,
          tasks: { stt: 'whisper-1' }
        }
      ]
    })
    seedOrgProfiles(db)
    expect(getProfile('stt-local')).toMatchObject({ isLocal: true, managed: true })
    expect(getTaskProfileId('stt')).toBe('stt-local')
  })
})

describe('Update-Quelle', () => {
  it('github-Modus nutzt das konfigurierte Repo', async () => {
    __setOrgConfigForTest({ updates: { mode: 'github', repo: 'acme/mail' } })
    const fetchMock = vi.fn(async () =>
      Response.json({ tag_name: 'v9.0.0', html_url: 'https://github.com/acme/mail/releases/v9' })
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await checkForUpdates()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/mail/releases/latest',
      expect.anything()
    )
    expect(result).toMatchObject({ updateAvailable: true, latest: 'v9.0.0' })
  })

  it('url-Modus liest {version, url, notes}', async () => {
    __setOrgConfigForTest({ updates: { mode: 'url', url: 'https://u.test/latest.json' } })
    const fetchMock = vi.fn(async () =>
      Response.json({ version: '2.0.0', url: 'https://u.test/dl', notes: 'Neu: X' })
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await checkForUpdates()
    expect(fetchMock).toHaveBeenCalledWith('https://u.test/latest.json', expect.anything())
    expect(result).toEqual({
      updateAvailable: true,
      latest: '2.0.0',
      url: 'https://u.test/dl',
      note: 'Neu: X'
    })
  })

  it('url-Modus: nicht neuer → kein Update; ungültiges Format → Fehlernotiz', async () => {
    __setOrgConfigForTest({ updates: { mode: 'url', url: 'https://u.test/latest.json' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ version: '0.0.0', url: 'https://u.test/dl' }))
    )
    expect(await checkForUpdates()).toMatchObject({ updateAvailable: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ version: '9.0.0', url: 'http://unsicher.test' }))
    )
    const bad = await checkForUpdates()
    expect(bad.updateAvailable).toBe(false)
    expect(bad.note).toMatch(/ungültiges Format/)
  })

  it('off: nie ein Request, auch nicht manuell, und kein Timer', async () => {
    __setOrgConfigForTest({ updates: { mode: 'off' } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await checkForUpdates()).toMatchObject({ updateAvailable: false, latest: null })
    expect((await checkForUpdates({ manual: true })).note).toMatch(/deaktiviert/)
    expect(fetchMock).not.toHaveBeenCalled()
    const spy = vi.spyOn(globalThis, 'setTimeout')
    startUpdateChecks(() => {})
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it.each([
    ['github', { mode: 'github', repo: 'acme/mail' } as const],
    ['url', { mode: 'url', url: 'https://u.test/latest.json' } as const]
  ])('Local only (%s): automatisch kein Netz, manuell schon', async (_n, updates) => {
    __setOrgConfigForTest({ updates })
    const fetchMock = vi.fn(async () =>
      updates.mode === 'github'
        ? Response.json({ tag_name: 'v9.0.0' })
        : Response.json({ version: '9.0.0', url: 'https://u.test/dl' })
    )
    vi.stubGlobal('fetch', fetchMock)
    setLocalOnly(true)
    await checkForUpdates()
    expect(fetchMock).not.toHaveBeenCalled()
    const manual = await checkForUpdates({ manual: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(manual.updateAvailable).toBe(true)
  })

  it('Links: Homepage ersetzt GitHub, Support optional', () => {
    expect(helpLinks({ links: { homepage: 'https://h.test', support: 'https://s.test' } })).toEqual(
      { homepage: 'https://h.test', support: 'https://s.test', homepageIsUpstream: false }
    )
  })
})

describe('Branding', () => {
  it('eigener App-Name nur mit Org-Branding', () => {
    __setOrgConfigForTest({ productName: 'Acme Mail' })
    expect(packagedAppName()).toBe('acme-mail-prod')
    __setOrgConfigForTest({ productName: 'Acme Mail', executableName: 'acme' })
    expect(packagedAppName()).toBe('acme-prod')
    __setOrgConfigForTest({ defaults: { language: 'de' } })
    expect(packagedAppName()).toBe('noctua-prod')
  })
})

describe('OAuth-Vorrang', () => {
  const none = { clientId: null, clientSecret: null }

  it('Google: ohne Org der Thunderbird-Default', () => {
    const r = resolveGoogleClient(none, null)
    expect(r.clientId).toMatch(/^406964657835-/)
    expect(r.clientSecret).not.toBe('')
  })

  it('Google: Org-Client schlägt Default und bekommt NIE das Thunderbird-Secret', () => {
    const org = { oauth: { google: { clientId: 'org-id' } } }
    expect(resolveGoogleClient(none, org)).toEqual({ clientId: 'org-id', clientSecret: '' })
    expect(
      resolveGoogleClient(none, { oauth: { google: { clientId: 'org-id', clientSecret: 'sec' } } })
    ).toEqual({ clientId: 'org-id', clientSecret: 'sec' })
  })

  it('Google: ein explizites Main-Setting schlägt die Org-Konfiguration', () => {
    const org = { oauth: { google: { clientId: 'org-id', clientSecret: 'org-sec' } } }
    expect(resolveGoogleClient({ clientId: ' my-id ', clientSecret: 'my-sec' }, org)).toEqual({
      clientId: 'my-id',
      clientSecret: 'my-sec'
    })
  })

  it('Microsoft: Setting > Org > Default', () => {
    const org = { oauth: { microsoft: { clientId: 'ms-org' } } }
    expect(resolveMicrosoftClientId(null, null)).toMatch(/^[0-9a-f-]{36}$/)
    expect(resolveMicrosoftClientId(null, org)).toBe('ms-org')
    expect(resolveMicrosoftClientId('ms-set', org)).toBe('ms-set')
  })
})

describe('Netzwerkverbindungen', () => {
  const base = {
    accounts: [
      {
        email: 'a@x.test',
        credentialType: 'oauth-google',
        imapHost: 'imap.gmail.com',
        smtpHost: 'smtp.gmail.com'
      },
      {
        email: 'b@x.test',
        credentialType: 'oauth-google',
        imapHost: 'imap.gmail.com',
        smtpHost: 'smtp.gmail.com'
      },
      { email: 'c@x.test', credentialType: 'bridge', imapHost: '127.0.0.1', smtpHost: '127.0.0.1' }
    ],
    profiles: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiStyle: 'chat' as const,
        isLocal: false,
        preset: 'openrouter' as const,
        managed: false,
        hasKey: true
      },
      {
        id: 'ollama',
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiStyle: 'chat' as const,
        isLocal: true,
        preset: 'custom' as const,
        managed: false,
        hasKey: false
      },
      {
        id: 'unused',
        name: 'Unbenutzt',
        baseUrl: 'https://unused.test/v1',
        apiStyle: 'chat' as const,
        isLocal: false,
        preset: 'custom' as const,
        managed: false,
        hasKey: false
      }
    ],
    taskProfiles: { triage: 'openrouter', draft: 'ollama', stt: 'apple' },
    localOnly: false,
    feed: resolveUpdateFeed(null),
    embeddingsCached: false
  }

  it('listet Mailserver je Konto, OAuth je Anbieter einmal, genutzte AI-Profile, Update-Quelle, Modell', () => {
    const list = buildNetworkConnections(base)
    expect(list.filter((c) => c.kind === 'mail')).toHaveLength(6)
    expect(list.find((c) => c.host === '127.0.0.1')).toMatchObject({ scope: 'local' })
    expect(list.filter((c) => c.kind === 'oauth').map((c) => c.host)).toEqual([
      'accounts.google.com',
      'oauth2.googleapis.com'
    ])
    const ai = list.filter((c) => c.kind === 'ai')
    expect(ai.map((c) => c.label)).toEqual(['OpenRouter', 'Ollama'])
    expect(ai[0]).toMatchObject({ host: 'openrouter.ai', scope: 'external', tasks: ['triage'] })
    expect(ai[1]).toMatchObject({ host: 'localhost', scope: 'local', tasks: ['draft'] })
    expect(list.find((c) => c.kind === 'updates')).toMatchObject({
      host: 'api.github.com',
      status: 'active'
    })
    expect(list.find((c) => c.kind === 'embeddings')).toMatchObject({
      host: 'huggingface.co',
      status: 'on-demand'
    })
  })

  it('Local only: externe Profile gesperrt, Update/Modell nur auf Anfrage', () => {
    const list = buildNetworkConnections({ ...base, localOnly: true })
    expect(list.find((c) => c.label === 'OpenRouter')!.status).toBe('blocked')
    expect(list.find((c) => c.label === 'Ollama')!.status).toBe('active')
    expect(list.find((c) => c.kind === 'updates')!.status).toBe('manual-only')
    expect(list.find((c) => c.kind === 'embeddings')!.status).toBe('manual-only')
  })

  it('Update-Quelle aus, url-Modus und Modell im Cache', () => {
    const off = buildNetworkConnections({
      ...base,
      feed: resolveUpdateFeed({ updates: { mode: 'off' } })
    })
    expect(off.find((c) => c.kind === 'updates')).toMatchObject({ host: null, status: 'off' })
    const url = buildNetworkConnections({
      ...base,
      feed: resolveUpdateFeed({ updates: { mode: 'url', url: 'https://u.example.com/l.json' } }),
      embeddingsCached: true
    })
    expect(url.find((c) => c.kind === 'updates')!.host).toBe('u.example.com')
    expect(url.find((c) => c.kind === 'embeddings')!.status).toBe('cached')
  })
})
