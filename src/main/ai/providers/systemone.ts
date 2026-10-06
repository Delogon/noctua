import { z } from 'zod'

// Typisierter Client für Ollamas „System One"-API (Entscheidungsmodelle wie
// clef-flash, clef, nimble, tev1): POST {root}/v1/systemone. Kein Chat, keine
// Generierung, kein Streaming — das Modell beantwortet getippte Fragen
// (choice / noul / score) mit Wahrscheinlichkeiten über einem gemeinsamen
// `state`. Läuft nur lokal; Nutzung kostet 0 (Tokens werden trotzdem geloggt).

/** Ollama lehnt Bodies > 64 KiB (ohne Bilder) mit 413 ab; wir bleiben deutlich darunter. */
export const MAX_BODY_BYTES = 60 * 1024
/** Obergrenze für den state-Text (Mail), bevor der Body-Guard greift. */
export const MAX_STATE_BYTES = 40 * 1024
export const MAX_QUESTIONS = 64
const DEFAULT_TIMEOUT_MS = 60_000
const TRUNCATION_MARKER = '\n[… gekürzt]'

// --- Schemas (spiegeln docs/capabilities/decision + openapi.yaml) ------------------------------

const instructionsSchema = z.string().trim().min(1)

const choiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: instructionsSchema,
  criteria: z
    .record(z.string().regex(/\S/), z.string())
    .refine((c) => Object.keys(c).length >= 2 && Object.keys(c).length <= 26, '2–26 Kriterien')
})
const noulQuestionSchema = z.object({
  type: z.literal('noul'),
  instructions: instructionsSchema,
  criteria: z.object({ false: z.string().optional(), true: z.string().optional() }).optional()
})
const scoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: instructionsSchema,
  criteria: z.array(z.string().min(1)).min(2).max(26)
})
export const questionSchema = z.discriminatedUnion('type', [
  choiceQuestionSchema,
  noulQuestionSchema,
  scoreQuestionSchema
])
export type Question = z.infer<typeof questionSchema>
export type Questions = Record<string, Question>

const probabilities = z.record(z.string(), z.number().min(0).max(1))
const choiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities,
  confidence: z.number().min(0).max(1)
})
const noulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number().min(0).max(1)
})
const scoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number().min(0).max(25),
  legend: z.record(z.string(), z.string()).default({}),
  probabilities,
  confidence: z.number().min(0).max(1)
})
export const answerSchema = z.discriminatedUnion('type', [
  choiceAnswerSchema,
  noulAnswerSchema,
  scoreAnswerSchema
])
export type Answer = z.infer<typeof answerSchema>
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>

export const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0)
  })
})
export type SystemOneResponse = z.infer<typeof responseSchema>

// --- Fehler -----------------------------------------------------------------------------------

export type SystemOneErrorKind =
  | 'model-missing' // 404: Modell nicht heruntergeladen
  | 'not-decision' // 400: kein Entscheidungsmodell / nicht unterstützt
  | 'context' // 400: Eingabe länger als das geladene Kontextfenster
  | 'too-large' // 413
  | 'server' // 5xx
  | 'network' // nicht erreichbar / Timeout
  | 'invalid-response'
  | 'invalid-request'

/**
 * `status` ist bewusst eine eigene Eigenschaft: classifyAiError() der AI-Queue
 * wertet sie aus (5xx = transient, 4xx = permanent) — ohne Sonderfall hier.
 */
export class SystemOneError extends Error {
  readonly status?: number
  readonly kind: SystemOneErrorKind
  constructor(kind: SystemOneErrorKind, message: string, status?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'SystemOneError'
    this.kind = kind
    this.status = status
  }
}

/** Konfigurationsfehler: Wiederholen hilft nicht, die klassische Triage kann übernehmen. */
export function isDecisionConfigError(error: unknown): boolean {
  return (
    error instanceof SystemOneError &&
    (error.kind === 'model-missing' || error.kind === 'not-decision' || error.kind === 'context')
  )
}

export function mapHttpError(status: number, body: string, model: string): SystemOneError {
  let detail = body.trim().slice(0, 300)
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string') detail = parsed.error.slice(0, 300)
  } catch {
    // Rohtext behalten
  }
  if (status === 404) {
    return new SystemOneError(
      'model-missing',
      `Entscheidungsmodell „${model}“ nicht gefunden – im Terminal „ollama pull ${model}“ ausführen (Ollama ab 0.35)`,
      404
    )
  }
  if (status === 413) {
    return new SystemOneError(
      'too-large',
      `Anfrage zu groß für das Entscheidungsmodell: ${detail}`,
      413
    )
  }
  if (status === 400) {
    if (/context|too (?:long|large)|exceed/i.test(detail)) {
      return new SystemOneError(
        'context',
        `Eingabe länger als das Kontextfenster des Modells: ${detail}`,
        400
      )
    }
    return new SystemOneError(
      'not-decision',
      `„${model}“ ist kein Entscheidungsmodell (oder wird nicht unterstützt): ${detail}`,
      400
    )
  }
  if (status >= 500) {
    return new SystemOneError(
      'server',
      `Entscheidungsmodell: Serverfehler ${status}: ${detail}`,
      status
    )
  }
  return new SystemOneError('server', `Entscheidungsmodell: HTTP ${status}: ${detail}`, status)
}

// --- Request-Aufbau ---------------------------------------------------------------------------

const encoder = new TextEncoder()
const byteLength = (s: string): number => encoder.encode(s).length

/** `state` so kürzen, dass der JSON-Body unter `maxBytes` bleibt (nie mitten in einem Surrogatpaar). */
export function fitState(
  state: string,
  buildBody: (state: string) => string,
  maxBytes = MAX_BODY_BYTES
): { state: string; truncated: boolean } {
  let current = state
  let truncated = false
  if (byteLength(current) > MAX_STATE_BYTES) {
    current = cutText(current, MAX_STATE_BYTES)
    truncated = true
  }
  // JSON-Escaping (\n, \", \uXXXX) bläht auf — iterativ proportional kürzen
  for (let i = 0; i < 12; i++) {
    const size = byteLength(buildBody(current))
    if (size <= maxBytes) return { state: current, truncated }
    const keep = Math.max(0, Math.floor(byteLength(current) * (maxBytes / size) * 0.95) - 16)
    current = cutText(current, keep)
    truncated = true
  }
  return { state: '', truncated: true }
}

function cutText(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  const marker = byteLength(TRUNCATION_MARKER)
  const budget = Math.max(0, maxBytes - marker)
  let end = Math.min(text.length, budget)
  while (end > 0 && byteLength(text.slice(0, end)) > budget) end = Math.floor(end * 0.9)
  // kein halbes Surrogatpaar am Ende
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end) + TRUNCATION_MARKER
}

export interface DecideParams {
  /** Basis-URL des Profils (mit oder ohne /v1) */
  baseUrl: string
  apiKey?: string | null
  model: string
  state: string
  questions: Questions
  keepAlive?: string | number
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface DecideResult {
  answers: Record<string, Answer>
  usage: { inputTokens: number; outputTokens: number }
  truncated: boolean
  model: string
}

/** Ollama-Wurzel: Basis-URL ohne abschließenden /v1 und ohne Slash. */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function buildRequestBody(
  model: string,
  state: string,
  questions: Questions,
  keepAlive?: string | number
): string {
  return JSON.stringify({
    model,
    state,
    questions,
    ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {})
  })
}

/** Eine System-One-Anfrage. Validiert Anfrage und Antwort; wirft SystemOneError. */
export async function decide(params: DecideParams): Promise<DecideResult> {
  const names = Object.keys(params.questions)
  if (names.length === 0 || names.length > MAX_QUESTIONS) {
    throw new SystemOneError(
      'invalid-request',
      `1–${MAX_QUESTIONS} Fragen erlaubt, nicht ${names.length}`
    )
  }
  for (const [name, q] of Object.entries(params.questions)) {
    const parsed = questionSchema.safeParse(q)
    if (!parsed.success) {
      throw new SystemOneError(
        'invalid-request',
        `Frage „${name}“ ungültig: ${parsed.error.message.slice(0, 200)}`
      )
    }
  }
  if (!params.state.trim())
    throw new SystemOneError('invalid-request', 'state darf nicht leer sein')

  const fitted = fitState(params.state, (s) =>
    buildRequestBody(params.model, s, params.questions, params.keepAlive)
  )
  if (!fitted.state.trim()) {
    throw new SystemOneError('too-large', 'Fragen allein überschreiten das Größenlimit', 413)
  }
  const body = buildRequestBody(params.model, fitted.state, params.questions, params.keepAlive)

  const doFetch = params.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(params.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout
  let res: Response
  try {
    res = await doFetch(`${ollamaRoot(params.baseUrl)}/v1/systemone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {})
      },
      body,
      redirect: 'error',
      signal
    })
  } catch (error) {
    const timedOut = timeout.aborted
    throw new SystemOneError(
      'network',
      timedOut
        ? 'Entscheidungsmodell: Zeitüberschreitung (timeout)'
        : `Entscheidungsmodell nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error
    )
  }
  const text = await res.text()
  if (!res.ok) throw mapHttpError(res.status, text, params.model)

  let parsed: SystemOneResponse
  try {
    parsed = responseSchema.parse(JSON.parse(text))
  } catch (error) {
    throw new SystemOneError(
      'invalid-response',
      `Ungültige Antwort des Entscheidungsmodells: ${error instanceof Error ? error.message.slice(0, 200) : 'parse error'}`
    )
  }
  for (const name of names) {
    if (!(name in parsed.answers)) {
      throw new SystemOneError('invalid-response', `Antwort ohne „${name}“`)
    }
    if (parsed.answers[name].type !== params.questions[name].type) {
      throw new SystemOneError('invalid-response', `Antwort „${name}“ hat falschen Typ`)
    }
  }
  return {
    answers: parsed.answers,
    usage: { inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens },
    truncated: fitted.truncated,
    model: parsed.model
  }
}

// --- Antwort-Helfer ---------------------------------------------------------------------------

export function noulOf(answers: Record<string, Answer>, name: string): number {
  const a = answers[name]
  return a?.type === 'noul' ? a.noul : 0
}

export function scoreOf(answers: Record<string, Answer>, name: string): ScoreAnswer | null {
  const a = answers[name]
  return a?.type === 'score' ? a : null
}

export function choiceOf(answers: Record<string, Answer>, name: string): ChoiceAnswer | null {
  const a = answers[name]
  return a?.type === 'choice' ? a : null
}
