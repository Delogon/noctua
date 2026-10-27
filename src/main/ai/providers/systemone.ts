import { z } from 'zod'

// Typed client for Ollama's "System One" API (decision models like
// clef-flash, clef, nimble, tev1): POST {root}/v1/systemone. No chat, no
// generation, no streaming — the model answers typed questions
// (choice / noul / score) with probabilities over a shared
// `state`. Runs only locally; usage costs 0 (tokens are logged anyway).

/** Ollama rejects bodies > 64 KiB (without images) with 413; we stay well below that. */
export const MAX_BODY_BYTES = 60 * 1024
/** Upper bound for the state text (mail) before the body guard kicks in. */
export const MAX_STATE_BYTES = 40 * 1024
export const MAX_QUESTIONS = 64
const DEFAULT_TIMEOUT_MS = 60_000
const TRUNCATION_MARKER = '\n[… gekürzt]'

// --- Schemas (mirror the System One API: capabilities/decision + openapi.yaml) -------------------------------

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

// --- Errors -----------------------------------------------------------------------------------

export type SystemOneErrorKind =
  | 'model-missing' // 404: model not downloaded
  | 'not-decision' // 400: not a decision model / not supported
  | 'context' // 400: input longer than the loaded context window
  | 'too-large' // 413
  | 'server' // 5xx
  | 'network' // unreachable / timeout
  | 'invalid-response'
  | 'invalid-request'

/**
 * `status` is deliberately a separate property: the AI queue's classifyAiError()
 * evaluates it (5xx = transient, 4xx = permanent) — no special case here.
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

/** Configuration error: retrying won't help, classic triage can take over. */
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
    // keep raw text
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

// --- Request building -------------------------------------------------------------------------

const encoder = new TextEncoder()
const byteLength = (s: string): number => encoder.encode(s).length

/** Truncate `state` so the JSON body stays under `maxBytes` (never inside a surrogate pair). */
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
  // JSON escaping (\n, \", \uXXXX) inflates — truncate proportionally, iteratively
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
  // no half surrogate pair at the end
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end) + TRUNCATION_MARKER
}

export interface DecideParams {
  /** Base URL of the profile (with or without /v1) */
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

/** Ollama root: base URL without trailing /v1 and without slash. */
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

/** A System One request. Validates request and response; throws SystemOneError. */
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

export interface DecideEachResult extends DecideResult {
  /** Number of System One requests made */
  calls: number
}

/**
 * One request per question, run concurrently, each with its own state. Answers
 * are merged and usage summed. Throws the first error (a config error on any
 * call means the model is unusable; a transient one fails the whole decision).
 */
export async function decideEach(
  params: Omit<DecideParams, 'questions' | 'state'>,
  questions: Questions,
  stateFor: (name: string) => string
): Promise<DecideEachResult> {
  const names = Object.keys(questions)
  const results = await Promise.all(
    names.map((name) =>
      decide({ ...params, questions: { [name]: questions[name] }, state: stateFor(name) })
    )
  )
  return {
    answers: Object.assign({}, ...results.map((r) => r.answers)),
    usage: {
      inputTokens: results.reduce((sum, r) => sum + r.usage.inputTokens, 0),
      outputTokens: results.reduce((sum, r) => sum + r.usage.outputTokens, 0)
    },
    truncated: results.some((r) => r.truncated),
    model: results[0]?.model ?? params.model,
    calls: results.length
  }
}

// --- Response helpers -------------------------------------------------------------------------

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
