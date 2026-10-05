import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { setSetting } from '@main/db'
import { isLocalOnly, setLocalOnly } from '@main/privacy'
import { checkForUpdates } from '@main/updates'
import {
  EMBEDDING_MODEL,
  EmbeddingIndexer,
  EmbeddingModelUnavailableError,
  embedQuery,
  isEmbeddingModelCached
} from '@main/ai/embeddings'
import { createProfile, getProfile } from '@main/ai/providers/registry'
import { getThreadMessages } from '@main/db/repos/threads'
import { storeBody, upsertEnvelope } from '@main/mail/ingest'
import {
  isRendererSecretKey,
  isRendererSettingReadable,
  isRendererSettingWritable
} from '@shared/settings-keys'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

// Pull in die Handler erst nach den Mocks (zieht sonst Wörterbücher als ?asset-Importe)
vi.mock('@main/spell', () => ({ getSpellEngine: vi.fn() }))
vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: vi.fn() } } })
}))

let db: Database.Database
beforeEach(() => {
  db = createTestDb()
})
afterEach(() => {
  closeTestDb(db)
  vi.restoreAllMocks()
  delete process.env.NOCTUA_MODEL_CACHE_DIR
})

describe('Local only: Schalter', () => {
  it('ist standardmäßig aus und lässt sich setzen', () => {
    expect(isLocalOnly()).toBe(false)
    setLocalOnly(true)
    expect(isLocalOnly()).toBe(true)
    setLocalOnly(false)
    expect(isLocalOnly()).toBe(false)
  })
})

describe('Local only: Update-Check nur auf Anforderung', () => {
  const release = { tag_name: 'v99.0.0', html_url: 'https://example.test/r' }

  it('automatisch (manual nicht gesetzt): kein Netzwerkzugriff', async () => {
    const fetchMock = vi.fn(async () => Response.json(release))
    vi.stubGlobal('fetch', fetchMock)
    setLocalOnly(true)
    const result = await checkForUpdates()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ updateAvailable: false, latest: null })
    vi.unstubAllGlobals()
  })

  it('manuell: fragt GitHub auch bei Local only', async () => {
    const fetchMock = vi.fn(async () => Response.json(release))
    vi.stubGlobal('fetch', fetchMock)
    setLocalOnly(true)
    const result = await checkForUpdates({ manual: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ updateAvailable: true, latest: 'v99.0.0' })
    vi.unstubAllGlobals()
  })

  it('ohne Local only: automatischer Check läuft wie bisher', async () => {
    const fetchMock = vi.fn(async () => Response.json(release))
    vi.stubGlobal('fetch', fetchMock)
    await checkForUpdates()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('Local only: Suchmodell (Embeddings)', () => {
  function emptyCacheDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'noctua-models-'))
    process.env.NOCTUA_MODEL_CACHE_DIR = dir
    return dir
  }

  it('erkennt den Modell-Cache', () => {
    const dir = emptyCacheDir()
    expect(isEmbeddingModelCached()).toBe(false)
    mkdirSync(join(dir, EMBEDDING_MODEL, 'onnx'), { recursive: true })
    writeFileSync(join(dir, EMBEDDING_MODEL, 'onnx', 'model_quantized.onnx'), 'x')
    expect(isEmbeddingModelCached()).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('embedQuery startet ohne Cache keinen Download — die Suche fällt auf FTS zurück', async () => {
    const dir = emptyCacheDir()
    setLocalOnly(true)
    await expect(embedQuery('Rechnung')).rejects.toBeInstanceOf(EmbeddingModelUnavailableError)
    rmSync(dir, { recursive: true, force: true })
  })

  it('der Indexer wartet still (kein Fehlerzustand), solange das Modell fehlt', async () => {
    const dir = emptyCacheDir()
    setLocalOnly(true)
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 1, messageId: '<e@t>' }))!
    storeBody(db, res.messageId, {
      messageId: '<e@t>',
      inReplyTo: null,
      references: [],
      subject: 'Test',
      from: { name: 'T', address: 't@example.org' },
      to: [],
      cc: [],
      replyTo: [],
      date: Date.now(),
      text: 'Inhalt',
      html: null,
      snippet: 'Inhalt',
      attachments: []
    })
    const indexer = new EmbeddingIndexer()
    indexer.init(db)
    indexer.kick()
    await vi.waitFor(() => expect(indexer.getStatus().running).toBe(false))
    const status = indexer.getStatus()
    expect(status.model).toMatchObject({ state: 'not_loaded', cached: false, error: null })
    expect(status.pending).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('Local only: Remote-Bilder', () => {
  function seedThread(): string {
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 1, messageId: '<img@t>', fromAddr: 'news@shop.example' })
    )!
    storeBody(db, res.messageId, {
      messageId: '<img@t>',
      inReplyTo: null,
      references: [],
      subject: 'Bilder',
      from: { name: 'Shop', address: 'news@shop.example' },
      to: [],
      cc: [],
      replyTo: [],
      date: Date.now(),
      text: 'x',
      html: '<img src="https://t.example/p.png">',
      snippet: 'x',
      attachments: []
    })
    return (
      db.prepare('SELECT thread_key FROM messages WHERE id = ?').get(res.messageId) as {
        thread_key: string
      }
    ).thread_key
  }

  it('Absender-Freigabe und globaler Default gelten ohne Local only', () => {
    const key = seedThread()
    expect(getThreadMessages(db, key)[0].remoteImagesAllowed).toBe(false)
    setSetting('images.allow.news@shop.example', '1')
    expect(getThreadMessages(db, key)[0].remoteImagesAllowed).toBe(true)
  })

  it('Local only ignoriert Freigabeliste und Default (manuelles „Anzeigen" bleibt im Renderer)', () => {
    const key = seedThread()
    setSetting('images.allow.news@shop.example', '1')
    setSetting('mail.remoteImagesDefault', '1')
    setLocalOnly(true)
    expect(getThreadMessages(db, key)[0].remoteImagesAllowed).toBe(false)
    setLocalOnly(false)
    expect(getThreadMessages(db, key)[0].remoteImagesAllowed).toBe(true)
  })
})

describe('Local only: Modellkatalog (Handler ai:profileModels)', () => {
  it('holt externe Kataloge bei Local only nicht automatisch, lokale und manuelle schon', async () => {
    const { handlers } = await import('@main/ipc/handlers')
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'm1' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const local = createProfile({
      name: 'Lokal',
      baseUrl: 'http://localhost:11434/v1',
      apiStyle: 'chat',
      isLocal: true
    })
    const cloud = createProfile({
      name: 'Cloud',
      baseUrl: 'https://api.example.com/v1',
      apiStyle: 'chat',
      isLocal: false
    })
    expect(getProfile(cloud.id)).not.toBeNull()
    setLocalOnly(true)

    expect(await handlers['ai:profileModels']({ profileId: cloud.id, manual: false })).toEqual({
      models: [],
      skipped: true
    })
    expect(fetchMock).not.toHaveBeenCalled()

    // OpenRouter-Katalog ebenso
    expect(
      await handlers['ai:profileModels']({ profileId: 'openrouter', manual: false })
    ).toMatchObject({ skipped: true })
    expect(fetchMock).not.toHaveBeenCalled()

    const localResult = await handlers['ai:profileModels']({ profileId: local.id, manual: false })
    expect(localResult.skipped).toBe(false)
    expect(localResult.models.map((m) => m.id)).toEqual(['m1'])

    // ausdrücklich angefordert
    const manual = await handlers['ai:profileModels']({ profileId: cloud.id, manual: true })
    expect(manual.skipped).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('privacy:setLocalOnly schaltet und gibt den neuen Stand zurück', async () => {
    const { handlers } = await import('@main/ipc/handlers')
    expect(await handlers['privacy:setLocalOnly']({ localOnly: true })).toEqual({
      localOnly: true
    })
    expect(await handlers['privacy:getLocalOnly'](undefined)).toEqual({ localOnly: true })
  })
})

describe('Settings-Allowlist (Phase 1)', () => {
  it('Profil-Zuordnung und Local only: Renderer darf lesen, aber nicht direkt schreiben', () => {
    for (const key of [
      'ai.triageProfile',
      'ai.draftProfile',
      'ai.sttProfile',
      'privacy.localOnly'
    ]) {
      expect(isRendererSettingReadable(key)).toBe(true)
      expect(isRendererSettingWritable(key)).toBe(false)
    }
  })

  it('Profil-Keys sind nicht über das generische secrets:* erreichbar', () => {
    expect(isRendererSecretKey('ai.profile.p_abc123.apiKey')).toBe(false)
    expect(isRendererSettingReadable('ai.profile.p_abc123.apiKey')).toBe(false)
    expect(isRendererSecretKey('openrouter.apiKey')).toBe(true)
  })

  it('bestehende Modell-Keys bleiben schreibbar', () => {
    for (const key of ['ai.triageModel', 'ai.draftModel', 'ai.sttModel', 'ai.triageProvider']) {
      expect(isRendererSettingWritable(key)).toBe(true)
    }
  })
})
