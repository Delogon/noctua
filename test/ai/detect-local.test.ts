import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLocalServers } from '@main/ai/detect-local'

afterEach(() => vi.unstubAllGlobals())

function stubServers(live: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const base = String(url).replace(/\/models$/, '')
    if (!(base in live)) throw new Error('ECONNREFUSED')
    return Response.json(live[base])
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('detectLocalServers', () => {
  it('sondiert nur fest verdrahtete Loopback-Adressen, ohne Zugangsdaten', async () => {
    const fetchMock = stubServers({})
    expect(await detectLocalServers()).toEqual({ found: [] })
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort()
    expect(urls).toEqual(
      [
        'http://127.0.0.1:11434/v1/models',
        'http://127.0.0.1:1234/v1/models',
        'http://127.0.0.1:8000/v1/models',
        'http://127.0.0.1:8080/v1/models',
        'http://localhost:11434/v1/models'
      ].sort()
    )
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      expect(Object.keys(init.headers as object)).toEqual(['Accept'])
      expect(init.redirect).toBe('error')
    }
  })

  it('findet laufende Server mit Modellen; localhost/127.0.0.1 nur einmal', async () => {
    stubServers({
      'http://127.0.0.1:11434/v1': { data: [{ id: 'qwen3:30b' }, { id: 'llama3.2:3b' }] },
      'http://localhost:11434/v1': { data: [{ id: 'llama3.2:3b' }] },
      'http://127.0.0.1:1234/v1': { data: [{ id: 'gemma-3-12b' }] },
      // llama.cpp: `models` statt `data`
      'http://127.0.0.1:8080/v1': { models: [{ model: 'm.gguf' }] }
    })
    const { found } = await detectLocalServers()
    expect(found.map((f) => [f.kind, f.baseUrl, f.models])).toEqual([
      ['ollama', 'http://127.0.0.1:11434/v1', ['llama3.2:3b', 'qwen3:30b']],
      ['lmstudio', 'http://127.0.0.1:1234/v1', ['gemma-3-12b']],
      ['llamacpp', 'http://127.0.0.1:8080/v1', ['m.gguf']]
    ])
  })

  it('ignoriert Fehlerstatus, Müll-Antworten und überlange Modell-IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes(':1234')) return new Response('nope', { status: 500 })
        if (String(url).includes(':8080')) return Response.json({ data: 'kaputt' })
        if (String(url).includes(':8000'))
          return Response.json({ data: [{ id: 'x'.repeat(300) }, { id: 'ok' }, null] })
        throw new Error('down')
      })
    )
    const { found } = await detectLocalServers()
    expect(found).toEqual([
      { kind: 'localai', baseUrl: 'http://127.0.0.1:8000/v1', models: ['ok'], decisionModels: [] }
    ])
  })
})
