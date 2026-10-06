import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BODY_BYTES,
  MAX_QUESTIONS,
  SystemOneError,
  buildRequestBody,
  choiceOf,
  decide,
  fitState,
  isDecisionConfigError,
  noulOf,
  ollamaRoot,
  scoreOf,
  type Questions
} from '@main/ai/providers/systemone'
import { classifyAiError } from '@main/ai/queue'

const questions: Questions = {
  label: {
    type: 'choice',
    instructions: 'Welches Label?',
    criteria: { billing: 'Zahlungen', bug: 'Fehler' }
  },
  refund: { type: 'noul', instructions: 'Rückerstattung?' },
  urgency: {
    type: 'score',
    instructions: 'Dringlichkeit?',
    criteria: ['Routine', 'Bald', 'Sofort']
  }
}

const okBody = {
  model: 'clef-flash',
  answers: {
    label: {
      type: 'choice',
      choice: 'bug',
      probabilities: { billing: 0.1, bug: 0.9 },
      confidence: 0.7
    },
    refund: { type: 'noul', noul: 0.99 },
    urgency: {
      type: 'score',
      score: 0.83,
      legend: { '0': 'Routine', '1': 'Bald', '2': 'Sofort' },
      probabilities: { '0': 0.2, '1': 0.6, '2': 0.2 },
      confidence: 0.4
    }
  },
  usage: { input_tokens: 174, output_tokens: 1 }
}

function fetchReturning(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
  )
}

function call(
  fetchImpl: unknown,
  over: Partial<Parameters<typeof decide>[0]> = {}
): ReturnType<typeof decide> {
  return decide({
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'clef-flash',
    state: 'Unser Checkout liefert 500er.',
    questions,
    fetchImpl: fetchImpl as typeof fetch,
    ...over
  })
}

describe('systemone: Request', () => {
  it('postet an {root}/v1/systemone (ohne doppeltes /v1) mit model, state, questions', async () => {
    const f = fetchReturning(200, okBody)
    await call(f)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:11434/v1/systemone')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('clef-flash')
    expect(body.state).toBe('Unser Checkout liefert 500er.')
    expect(Object.keys(body.questions)).toEqual(['label', 'refund', 'urgency'])
    expect(body.keep_alive).toBeUndefined()
  })

  it('ollamaRoot entfernt /v1 und Slashes', () => {
    expect(ollamaRoot('http://h:11434/v1/')).toBe('http://h:11434')
    expect(ollamaRoot('http://h:11434')).toBe('http://h:11434')
  })

  it('sendet Bearer-Key nur, wenn vorhanden, und keep_alive nur auf Wunsch', async () => {
    const f = fetchReturning(200, okBody)
    await call(f, { apiKey: 'sk-x', keepAlive: '10m' })
    const [, init] = f.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
    expect(JSON.parse(init.body as string).keep_alive).toBe('10m')
  })

  it('lehnt 0 und mehr als 64 Fragen ab, ohne zu senden', async () => {
    const f = fetchReturning(200, okBody)
    await expect(call(f, { questions: {} })).rejects.toMatchObject({ kind: 'invalid-request' })
    const many: Questions = {}
    for (let i = 0; i < MAX_QUESTIONS + 1; i++) many[`q${i}`] = { type: 'noul', instructions: 'x?' }
    await expect(call(f, { questions: many })).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(f).not.toHaveBeenCalled()
  })

  it('akzeptiert genau 64 Fragen', async () => {
    const many: Questions = {}
    const answers: Record<string, unknown> = {}
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      many[`q${i}`] = { type: 'noul', instructions: 'x?' }
      answers[`q${i}`] = { type: 'noul', noul: 0.5 }
    }
    const f = fetchReturning(200, { ...okBody, answers })
    const result = await call(f, { questions: many })
    expect(Object.keys(result.answers)).toHaveLength(64)
  })

  it('validiert Kriterien (choice: 2–26, score: 2–26)', async () => {
    const f = fetchReturning(200, okBody)
    await expect(
      call(f, {
        questions: { a: { type: 'choice', instructions: 'x', criteria: { only: 'one' } } }
      })
    ).rejects.toMatchObject({ kind: 'invalid-request' })
    await expect(
      call(f, { questions: { a: { type: 'score', instructions: 'x', criteria: ['eins'] } } })
    ).rejects.toMatchObject({ kind: 'invalid-request' })
    expect(f).not.toHaveBeenCalled()
  })

  it('leerer state wird abgelehnt', async () => {
    await expect(call(fetchReturning(200, okBody), { state: '  ' })).rejects.toMatchObject({
      kind: 'invalid-request'
    })
  })
})

describe('systemone: Größenlimit', () => {
  it('kürzt einen riesigen state, sodass der Body unter dem Limit bleibt', async () => {
    const f = fetchReturning(200, okBody)
    const huge = 'Ä„"\n'.repeat(60_000) // viele Mehrbyte- und Escape-Zeichen
    const result = await call(f, { state: huge })
    const [, init] = f.mock.calls[0] as [string, RequestInit]
    expect(new TextEncoder().encode(init.body as string).length).toBeLessThanOrEqual(MAX_BODY_BYTES)
    expect(result.truncated).toBe(true)
    expect(JSON.parse(init.body as string).state).toMatch(/gekürzt\]$/)
  })

  it('lässt kurze states unangetastet', async () => {
    const f = fetchReturning(200, okBody)
    const result = await call(f, { state: 'kurz' })
    expect(result.truncated).toBe(false)
  })

  it('fitState schneidet kein Surrogatpaar entzwei', () => {
    const emoji = '😀'.repeat(30_000)
    const out = fitState(emoji, (s) => buildRequestBody('m', s, questions), 4000)
    expect(out.truncated).toBe(true)
    // gültiges UTF-16: keine einzelnen Surrogate
    expect(out.state).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(
      new TextEncoder().encode(buildRequestBody('m', out.state, questions)).length
    ).toBeLessThanOrEqual(4000)
  })
})

describe('systemone: Antwort', () => {
  it('parst choice, noul und score samt Usage', async () => {
    const result = await call(fetchReturning(200, okBody))
    expect(choiceOf(result.answers, 'label')).toMatchObject({ choice: 'bug', confidence: 0.7 })
    expect(noulOf(result.answers, 'refund')).toBeCloseTo(0.99)
    expect(scoreOf(result.answers, 'urgency')?.score).toBeCloseTo(0.83)
    expect(result.usage).toEqual({ inputTokens: 174, outputTokens: 1 })
  })

  it('wirft bei fehlender Antwort oder falschem Typ', async () => {
    const missing = { ...okBody, answers: { label: okBody.answers.label } }
    await expect(call(fetchReturning(200, missing))).rejects.toMatchObject({
      kind: 'invalid-response'
    })
    const wrongType = {
      ...okBody,
      answers: { ...okBody.answers, refund: { type: 'noul', noul: 2 } }
    }
    await expect(call(fetchReturning(200, wrongType))).rejects.toMatchObject({
      kind: 'invalid-response'
    })
    await expect(call(fetchReturning(200, 'kein json'))).rejects.toMatchObject({
      kind: 'invalid-response'
    })
  })
})

describe('systemone: Fehler', () => {
  it('404: Modell fehlt – Hinweis auf ollama pull', async () => {
    const err = await call(fetchReturning(404, { error: 'model not found' })).catch((e) => e)
    expect(err).toBeInstanceOf(SystemOneError)
    expect(err.kind).toBe('model-missing')
    expect(err.message).toContain('ollama pull clef-flash')
    expect(err.status).toBe(404)
    expect(isDecisionConfigError(err)).toBe(true)
  })

  it('400: kein Entscheidungsmodell', async () => {
    const err = await call(
      fetchReturning(400, { error: 'model does not support systemone' })
    ).catch((e) => e)
    expect(err.kind).toBe('not-decision')
    expect(err.message).toMatch(/kein Entscheidungsmodell/)
    expect(isDecisionConfigError(err)).toBe(true)
  })

  it('400: Kontextfenster überschritten', async () => {
    const err = await call(
      fetchReturning(400, { error: 'prompt exceeds the context window' })
    ).catch((e) => e)
    expect(err.kind).toBe('context')
  })

  it('413 ist permanent, 500 transient (Queue-Klassifikation)', async () => {
    const tooLarge = await call(fetchReturning(413, { error: 'too big' })).catch((e) => e)
    expect(tooLarge.kind).toBe('too-large')
    expect(classifyAiError(tooLarge).transient).toBe(false)
    expect(isDecisionConfigError(tooLarge)).toBe(false)

    const server = await call(fetchReturning(500, { error: 'scoring failed' })).catch((e) => e)
    expect(server.kind).toBe('server')
    expect(classifyAiError(server).transient).toBe(true)
  })

  it('Netzfehler und Timeout sind transient', async () => {
    const down = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    const err = await call(down).catch((e) => e)
    expect(err.kind).toBe('network')
    expect(classifyAiError(err).transient).toBe(true)

    const slow = vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      )
      return new Response('{}')
    })
    const timeout = await call(slow, { timeoutMs: 20 }).catch((e) => e)
    expect(timeout.kind).toBe('network')
    expect(timeout.message).toMatch(/timeout/)
    expect(classifyAiError(timeout).transient).toBe(true)
  })
})
