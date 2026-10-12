import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  clearOllamaCapsCache,
  isDecisionCapable,
  isDecisionOnly,
  listOllamaModelCaps
} from '@main/ai/providers/ollama-caps'
import { excludeDecisionOnly, listProfileModels, runDecisionTest } from '@main/ai/decision-service'
import {
  createProfile,
  getTaskProfileId,
  resolveDecision,
  setTaskAssignment,
  taskBlockReason
} from '@main/ai/providers/registry'
import { deleteProfile } from '@main/ai/providers/registry'
import { setLocalOnly } from '@main/privacy'
import { detectLocalServers } from '@main/ai/detect-local'
import { closeTestDb, createTestDb } from '../helpers/db'

vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: vi.fn() } } })
}))

/** Fake-Ollama: /api/tags, /api/show, /v1/models, /v1/systemone */
function fakeOllama(opts: {
  tags: Array<{ name: string; capabilities?: string[] }>
  show?: Record<string, string[]>
}): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/api/tags')) return Response.json({ models: opts.tags })
    if (u.endsWith('/api/show')) {
      const model = JSON.parse(String(init?.body)).model as string
      const caps = opts.show?.[model]
      return caps ? Response.json({ capabilities: caps }) : new Response('x', { status: 404 })
    }
    if (u.endsWith('/v1/models')) {
      return Response.json({ data: opts.tags.map((t) => ({ id: t.name })) })
    }
    if (u.endsWith('/v1/systemone')) {
      return Response.json({
        model: 'clef-flash',
        answers: {
          invoice: { type: 'noul', noul: 0.97 },
          urgency: {
            type: 'score',
            score: 1.6,
            legend: {},
            probabilities: { '0': 0.1, '1': 0.2, '2': 0.7 },
            confidence: 0.5
          }
        },
        usage: { input_tokens: 80, output_tokens: 1 }
      })
    }
    return new Response('nope', { status: 404 })
  })
  vi.stubGlobal('fetch', f)
  return f
}

describe('Fähigkeiten (capabilities)', () => {
  beforeEach(() => clearOllamaCapsCache())
  afterEach(() => vi.unstubAllGlobals())

  it('liest capabilities direkt aus /api/tags, ohne /api/show', async () => {
    const f = fakeOllama({
      tags: [
        { name: 'qwen3:30b', capabilities: ['completion', 'tools'] },
        { name: 'clef-flash:latest', capabilities: ['decision'] }
      ]
    })
    const caps = await listOllamaModelCaps('http://127.0.0.1:11434/v1')
    expect(caps.map((m) => [m.name, isDecisionCapable(m.capabilities)])).toEqual([
      ['qwen3:30b', false],
      ['clef-flash:latest', true]
    ])
    expect(f.mock.calls.every(([u]) => !String(u).endsWith('/api/show'))).toBe(true)
  })

  it('fragt fehlende capabilities per /api/show nach, höchstens showLimit Modelle', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => ({ name: `m${i}` }))
    tags.push({ name: 'nimble' })
    const f = fakeOllama({
      tags,
      show: { nimble: ['decision'], m0: ['completion'] }
    })
    const caps = await listOllamaModelCaps('http://127.0.0.1:11434', { showLimit: 5 })
    const shows = f.mock.calls.filter(([u]) => String(u).endsWith('/api/show'))
    expect(shows).toHaveLength(5)
    // bekannte Entscheidungsmodelle werden zuerst abgefragt und fallen nicht unters Limit
    expect(caps.find((m) => m.name === 'nimble')?.capabilities).toEqual(['decision'])
  })

  it('kein Ollama erreichbar: leere Liste, kein Wurf', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      })
    )
    expect(await listOllamaModelCaps('http://127.0.0.1:1')).toEqual([])
  })

  it('isDecisionOnly: nur decision ohne completion', () => {
    expect(isDecisionOnly(['decision'])).toBe(true)
    expect(isDecisionOnly(['decision', 'completion'])).toBe(false)
    expect(isDecisionOnly(['completion'])).toBe(false)
    expect(isDecisionOnly(null)).toBe(false)
  })
})

describe('Modelllisten: Chat-Picker schließen Entscheidungsmodelle aus', () => {
  let db: Database.Database
  beforeEach(() => {
    clearOllamaCapsCache()
    db = createTestDb()
  })
  afterEach(() => {
    closeTestDb(db)
    vi.unstubAllGlobals()
  })

  const tags = [
    { name: 'qwen3:30b', capabilities: ['completion'] },
    { name: 'clef-flash:latest', capabilities: ['decision'] },
    { name: 'nimble:latest', capabilities: ['decision'] }
  ]

  it('chat: nur Chat-Modelle; decision: nur Entscheidungsmodelle', async () => {
    fakeOllama({ tags })
    const profile = createProfile({
      name: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiStyle: 'chat',
      isLocal: true
    })
    expect((await listProfileModels(profile, 'chat')).map((m) => m.id)).toEqual(['qwen3:30b'])
    expect((await listProfileModels(profile, 'decision')).map((m) => m.id)).toEqual([
      'clef-flash:latest',
      'nimble:latest'
    ])
  })

  it('externe Profile: kein zusätzlicher Fähigkeiten-Request (Chat-Liste ungefiltert)', async () => {
    const f = fakeOllama({ tags })
    const profile = createProfile({
      name: 'Extern',
      baseUrl: 'https://llm.example.com/v1',
      apiStyle: 'chat',
      isLocal: false
    })
    const ids = (await listProfileModels(profile, 'chat')).map((m) => m.id)
    expect(ids).toHaveLength(3)
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/'))).toBe(false)
  })

  it('excludeDecisionOnly ist rein', () => {
    const models = ['a', 'b'].map((id) => ({
      id,
      promptPerM: 0,
      completionPerM: 0,
      context: 0,
      audioIn: false
    }))
    expect(
      excludeDecisionOnly(models, [
        { name: 'a', capabilities: ['decision'] },
        { name: 'b', capabilities: null }
      ]).map((m) => m.id)
    ).toEqual(['b'])
  })

  it('Testknopf: zwei Fragen, Antworten und Latenz', async () => {
    fakeOllama({ tags })
    const profile = createProfile({
      name: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiStyle: 'chat',
      isLocal: true
    })
    const result = await runDecisionTest(profile.id, 'clef-flash')
    expect(result.ok).toBe(true)
    expect(result.answers).toEqual([
      { name: 'invoice', text: '97 %' },
      { name: 'urgency', text: '1.60 / 2' }
    ])
  })

  it('Testknopf unter Local only: externes Profil wird nicht angefragt', async () => {
    const f = fakeOllama({ tags })
    const profile = createProfile({
      name: 'Extern',
      baseUrl: 'https://llm.example.com/v1',
      apiStyle: 'chat',
      isLocal: false
    })
    setLocalOnly(true)
    const result = await runDecisionTest(profile.id, 'clef-flash')
    expect(result.ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('Aufgabe „decision" im Registry', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => closeTestDb(db))

  const local = {
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiStyle: 'chat' as const,
    isLocal: true
  }

  it('ist standardmäßig aus (kein Profil, kein Entscheidungsmodell)', () => {
    expect(getTaskProfileId('decision')).toBe('')
    expect(taskBlockReason('decision')).toBe('no-profile')
    expect(resolveDecision()).toBeNull()
  })

  it('wird einem lokalen Profil samt Modell zugewiesen und löst auf', () => {
    const p = createProfile(local)
    setTaskAssignment('decision', p.id, 'clef-flash')
    const resolved = resolveDecision()
    expect(resolved?.model).toBe('clef-flash')
    expect(resolved?.profile.id).toBe(p.id)
  })

  it('OpenRouter ist für Entscheidungen nicht erlaubt', () => {
    expect(() => setTaskAssignment('decision', 'openrouter', 'x')).toThrow(/lokalen Ollama/)
  })

  it('Local only: externes Profil blockiert die Aufgabe (wie die anderen)', () => {
    const p = createProfile({
      ...local,
      name: 'Extern',
      baseUrl: 'https://x.example.com/v1',
      isLocal: false
    })
    setTaskAssignment('decision', p.id, 'clef-flash')
    expect(resolveDecision()).not.toBeNull()
    setLocalOnly(true)
    expect(taskBlockReason('decision')).toBe('local-only')
    expect(resolveDecision()).toBeNull()
  })

  it('leeres Profil schaltet aus; Profil löschen schaltet aus statt auf OpenRouter', () => {
    const p = createProfile(local)
    setTaskAssignment('decision', p.id, 'clef-flash')
    deleteProfile(p.id)
    expect(getTaskProfileId('decision')).toBe('')
    const q = createProfile(local)
    setTaskAssignment('decision', q.id, 'clef-flash')
    setTaskAssignment('decision', '', '')
    expect(resolveDecision()).toBeNull()
  })
})

describe('Onboarding-Erkennung (ai:detectLocal)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('liefert Entscheidungsmodelle von Ollama getrennt und nimmt sie aus models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.startsWith('http://127.0.0.1:11434/v1/models')) {
          return Response.json({ data: [{ id: 'qwen3:30b' }, { id: 'clef-flash:latest' }] })
        }
        if (u === 'http://127.0.0.1:11434/api/tags') {
          return Response.json({
            models: [
              { name: 'qwen3:30b', capabilities: ['completion'] },
              { name: 'clef-flash:latest', capabilities: ['decision'] }
            ]
          })
        }
        throw new Error('down')
      })
    )
    const { found } = await detectLocalServers()
    expect(found).toEqual([
      {
        kind: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: ['qwen3:30b'],
        decisionModels: ['clef-flash:latest']
      }
    ])
  })

  it('ohne Entscheidungsmodell: leere decisionModels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.startsWith('http://127.0.0.1:11434/v1/models')) {
          return Response.json({ data: [{ id: 'llama3' }] })
        }
        if (u === 'http://127.0.0.1:11434/api/tags') {
          return Response.json({ models: [{ name: 'llama3', capabilities: ['completion'] }] })
        }
        throw new Error('down')
      })
    )
    const { found } = await detectLocalServers()
    expect(found[0].decisionModels).toEqual([])
  })
})
