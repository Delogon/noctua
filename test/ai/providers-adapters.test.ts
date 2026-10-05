import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { closeTestDb, createTestDb } from '../helpers/db'
import { setSetting } from '@main/db'
import type { AiProfile } from '@main/ai/providers/types'

const { chatCreate, responsesCreate, transcriptionCreate, factorySpy } = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
  transcriptionCreate: vi.fn(),
  factorySpy: vi.fn()
}))

vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: (opts: unknown) => {
    factorySpy(opts)
    return {
      chat: { completions: { create: chatCreate } },
      responses: { create: responsesCreate },
      audio: { transcriptions: { create: transcriptionCreate } }
    }
  }
}))

import { createChatCompletionsClient } from '@main/ai/providers/chat-completions'
import { createResponsesClient, toResponsesInput } from '@main/ai/providers/responses'

const openrouter: AiProfile = {
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiStyle: 'chat',
  isLocal: false,
  preset: 'openrouter',
  hasKey: true
}
const custom = (apiStyle: 'chat' | 'responses'): AiProfile => ({
  id: 'p_1',
  name: 'Lokal',
  baseUrl: 'http://localhost:11434/v1',
  apiStyle,
  isLocal: true,
  preset: 'custom',
  hasKey: false
})

async function* chunks(...parts: unknown[]): AsyncGenerator<unknown> {
  for (const part of parts) yield part
}

let db: Database.Database
beforeEach(() => {
  db = createTestDb()
})
afterEach(() => {
  closeTestDb(db)
  chatCreate.mockReset()
  responsesCreate.mockReset()
  transcriptionCreate.mockReset()
  factorySpy.mockReset()
})

const req = {
  model: 'm',
  messages: [
    { role: 'system' as const, content: 'Sys' },
    { role: 'user' as const, content: 'Hallo' }
  ],
  temperature: 0.1,
  maxTokens: 50
}

describe('Chat-Completions-Adapter — OpenRouter-Preset', () => {
  it('sendet Header, ZDR-Body und usage.include; liest Kosten aus der Response', async () => {
    chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Antwort' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 }
    })
    const client = createChatCompletionsClient({ profile: openrouter, apiKey: 'k' })
    const result = await client.complete(req)

    expect(factorySpy).toHaveBeenCalledWith({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'k',
      headers: { 'HTTP-Referer': 'https://github.com/Schereo/noctua', 'X-Title': 'Noctua' }
    })
    const body = chatCreate.mock.calls[0][0]
    expect(body).toMatchObject({
      model: 'm',
      messages: req.messages,
      temperature: 0.1,
      max_tokens: 50,
      provider: { data_collection: 'deny' },
      usage: { include: true }
    })
    expect(body.response_format).toBeUndefined()
    expect(result).toEqual({
      text: 'Antwort',
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.002 }
    })
  })

  it('ZDR lässt sich abschalten (ai.zdrOnly=0)', async () => {
    setSetting('ai.zdrOnly', '0')
    chatCreate.mockResolvedValueOnce({ choices: [{ message: { content: '' } }] })
    await createChatCompletionsClient({ profile: openrouter, apiKey: 'k' }).complete(req)
    expect(chatCreate.mock.calls[0][0].provider).toBeUndefined()
  })

  it('json → response_format json_object, nur wenn der Aufrufer es verlangt', async () => {
    chatCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] })
    const client = createChatCompletionsClient({ profile: openrouter, apiKey: 'k' })
    await client.complete({ ...req, json: true })
    await client.complete(req)
    expect(chatCreate.mock.calls[0][0].response_format).toEqual({ type: 'json_object' })
    expect(chatCreate.mock.calls[1][0].response_format).toBeUndefined()
  })

  it('Preis-Fallback greift bei OpenRouter ohne cost-Feld', async () => {
    chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }
    })
    const { usage } = await createChatCompletionsClient({
      profile: openrouter,
      apiKey: 'k'
    }).complete(req)
    expect(usage.costUsd).toBeCloseTo(0.42)
  })

  it('stream: Deltas, Usage aus dem letzten Chunk; Schätzung ohne Usage', async () => {
    chatCreate.mockResolvedValueOnce(
      chunks(
        { choices: [{ delta: { content: 'Hal' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, cost: 0.001 } }
      )
    )
    const deltas: string[] = []
    const client = createChatCompletionsClient({ profile: openrouter, apiKey: 'k' })
    const result = await client.stream(req, (d) => deltas.push(d))
    expect(deltas).toEqual(['Hal', 'lo'])
    expect(result).toEqual({
      text: 'Hallo',
      usage: { inputTokens: 7, outputTokens: 2, costUsd: 0.001 }
    })
    expect(chatCreate.mock.calls[0][0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true }
    })

    chatCreate.mockResolvedValueOnce(chunks({ choices: [{ delta: { content: 'x'.repeat(40) } }] }))
    const estimated = await client.stream(req, () => {})
    expect(estimated.usage).toEqual({
      inputTokens: 0,
      outputTokens: 10,
      costUsd: (10 * 25) / 1_000_000
    })
  })

  it('transcribe: Audio-Input-Chat mit input_audio (wie bisher)', async () => {
    chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: ' Text ' } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0001 }
    })
    const client = createChatCompletionsClient({ profile: openrouter, apiKey: 'k' })
    const result = await client.transcribe!('QUJD', 'wav', 'openai/gpt-audio-mini')
    expect(result.text).toBe('Text')
    expect(result.usage.costUsd).toBe(0.0001)
    const content = chatCreate.mock.calls[0][0].messages[0].content
    expect(content[1]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'QUJD', format: 'wav' }
    })
    expect(transcriptionCreate).not.toHaveBeenCalled()
  })
})

describe('Chat-Completions-Adapter — eigenes Profil', () => {
  it('keine OpenRouter-Extras, keine Header, Kosten immer 0', async () => {
    chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
      // selbst ein cost-Feld oder große Token-Zahlen erzeugen keine Kosten
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, cost: 5 }
    })
    const client = createChatCompletionsClient({ profile: custom('chat'), apiKey: null })
    const result = await client.complete({ ...req, json: true })

    expect(factorySpy).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: null,
      headers: undefined
    })
    const body = chatCreate.mock.calls[0][0]
    expect(body.provider).toBeUndefined()
    expect(body.usage).toBeUndefined()
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(result.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 0 })
  })

  it('stream-Schätzung ohne Usage kostet nichts', async () => {
    chatCreate.mockResolvedValueOnce(chunks({ choices: [{ delta: { content: 'abcd' } }] }))
    const result = await createChatCompletionsClient({
      profile: custom('chat'),
      apiKey: null
    }).stream(req, () => {})
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 1, costUsd: 0 })
  })

  it('transcribe: audio.transcriptions (Whisper-kompatibel) statt Chat', async () => {
    transcriptionCreate.mockResolvedValueOnce({ text: ' Hallo Welt ' })
    const client = createChatCompletionsClient({ profile: custom('chat'), apiKey: null })
    const result = await client.transcribe!('QUJD', 'mp3', 'whisper-1')
    expect(result).toEqual({
      text: 'Hallo Welt',
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    })
    const arg = transcriptionCreate.mock.calls[0][0]
    expect(arg.model).toBe('whisper-1')
    expect(arg.file.name).toBe('audio.mp3')
    expect(chatCreate).not.toHaveBeenCalled()
  })
})

describe('Responses-Adapter', () => {
  it('toResponsesInput: system → instructions, einzelne User-Nachricht als String', () => {
    expect(
      toResponsesInput([
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'user', content: 'Frage' }
      ])
    ).toEqual({ instructions: 'A\n\nB', input: 'Frage' })
  })

  it('toResponsesInput: Verlauf bleibt als Items, Text-Parts werden zusammengesetzt', () => {
    expect(
      toResponsesInput([
        { role: 'user', content: 'eins' },
        { role: 'assistant', content: 'zwei' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'drei' },
            { type: 'text', text: '!' }
          ]
        }
      ])
    ).toEqual({
      instructions: undefined,
      input: [
        { role: 'user', content: 'eins' },
        { role: 'assistant', content: 'zwei' },
        { role: 'user', content: 'drei!' }
      ]
    })
  })

  it('complete: Request-Mapping, json → text.format, Usage-Mapping', async () => {
    responsesCreate.mockResolvedValueOnce({
      output_text: '{"a":1}',
      usage: { input_tokens: 12, output_tokens: 4 }
    })
    const client = createResponsesClient({ profile: custom('responses'), apiKey: 'k' })
    const result = await client.complete({ ...req, json: true })
    expect(responsesCreate.mock.calls[0][0]).toEqual({
      model: 'm',
      instructions: 'Sys',
      input: 'Hallo',
      temperature: 0.1,
      max_output_tokens: 50,
      text: { format: { type: 'json_object' } },
      store: false
    })
    expect(result).toEqual({
      text: '{"a":1}',
      usage: { inputTokens: 12, outputTokens: 4, costUsd: 0 }
    })
    expect(chatCreate).not.toHaveBeenCalled()
  })

  it('complete: ohne json und ohne output_text → Text aus den Output-Items', async () => {
    responsesCreate.mockResolvedValueOnce({
      output: [
        { type: 'reasoning' },
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'Hal' },
            { type: 'output_text', text: 'lo' }
          ]
        }
      ]
    })
    const client = createResponsesClient({ profile: custom('responses'), apiKey: null })
    const result = await client.complete(req)
    expect(result.text).toBe('Hallo')
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
    expect(responsesCreate.mock.calls[0][0].text).toBeUndefined()
  })

  it('stream: output_text.delta-Events, Usage aus response.completed', async () => {
    responsesCreate.mockResolvedValueOnce(
      chunks(
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: 'Gu' },
        { type: 'response.output_text.delta', delta: 'ten Tag' },
        {
          type: 'response.completed',
          response: { usage: { input_tokens: 9, output_tokens: 3 } }
        }
      )
    )
    const deltas: string[] = []
    const client = createResponsesClient({ profile: custom('responses'), apiKey: null })
    const result = await client.stream(req, (d) => deltas.push(d))
    expect(deltas).toEqual(['Gu', 'ten Tag'])
    expect(result).toEqual({
      text: 'Guten Tag',
      usage: { inputTokens: 9, outputTokens: 3, costUsd: 0 }
    })
    expect(responsesCreate.mock.calls[0][0].stream).toBe(true)
  })

  it('stream: fehlgeschlagene Antwort wirft; fehlende Usage wird geschätzt', async () => {
    responsesCreate.mockResolvedValueOnce(
      chunks({ type: 'response.failed', response: { error: { message: 'Modell fehlt' } } })
    )
    const client = createResponsesClient({ profile: custom('responses'), apiKey: null })
    await expect(client.stream(req, () => {})).rejects.toThrow('Modell fehlt')

    responsesCreate.mockResolvedValueOnce(
      chunks({ type: 'response.output_text.delta', delta: 'abcdefgh' })
    )
    const est = await client.stream(req, () => {})
    expect(est.usage).toEqual({ inputTokens: 0, outputTokens: 2, costUsd: 0 })
  })
})

describe('listModels (GET /models)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('liest OpenAI-Format, sortiert und dedupliziert; sendet Key als Bearer', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ id: 'qwen3:8b' }, { id: 'llama3.2:latest' }, { id: 'qwen3:8b' }, {}]
      })
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const client = createChatCompletionsClient({ profile: custom('chat'), apiKey: 'sk-x' })
    const models = await client.listModels()
    expect(models.map((m) => m.id)).toEqual(['llama3.2:latest', 'qwen3:8b'])
    expect(models[0]).toMatchObject({ promptPerM: 0, completionPerM: 0, audioIn: false })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
  })

  it('akzeptiert llama.cpp-Form {models:[{model}]} und meldet HTTP-Fehler', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ models: [{ model: 'gemma-3' }] })
    ) as unknown as typeof fetch
    const client = createResponsesClient({ profile: custom('responses'), apiKey: null })
    expect((await client.listModels()).map((m) => m.id)).toEqual(['gemma-3'])

    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 401 })
    ) as unknown as typeof fetch
    await expect(client.listModels()).rejects.toThrow('HTTP 401')
  })
})
