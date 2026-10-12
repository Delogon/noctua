import { getSetting } from '../db'

// OpenRouter specifics (ZDR routing, cost extraction). The client itself comes from
// the provider layer (providers/registry.ts).

/**
 * Zero Data Retention (M86): by default OpenRouter only routes to
 * providers that don't store prompts (`data_collection: 'deny'`).
 * Can be disabled via ai.zdrOnly = '0' — then more models are available,
 * but without a ZDR guarantee.
 */
export function zdrOnly(): boolean {
  return getSetting('ai.zdrOnly') !== '0'
}

/** OpenRouter extra fields for chat.completions.create — spread into every call. */
export function providerBody(): Record<string, unknown> {
  return zdrOnly() ? { provider: { data_collection: 'deny' } } : {}
}

/** Default models of the OpenRouter profile (without an explicit choice in settings). */
export const OPENROUTER_DEFAULT_MODELS = {
  triage: 'deepseek/deepseek-v4-flash',
  draft: 'anthropic/claude-opus-4.8',
  // Dictation transcription. Note: OpenRouter currently doesn't list dedicated Whisper
  // (openai/whisper-large-v3) — gpt-audio-mini is the cheapest
  // audio-input chat; the selection in settings is fed live
  // from the catalog and shows Whisper automatically once it exists.
  stt: 'openai/gpt-audio-mini'
} as const

export function getTriageModel(): string {
  return getSetting('ai.triageModel') ?? OPENROUTER_DEFAULT_MODELS.triage
}

/** Who computes triage: OpenRouter (cloud) or Apple Intelligence (local). */
export function getTriageProvider(): 'openrouter' | 'apple' {
  return getSetting('ai.triageProvider') === 'apple' ? 'apple' : 'openrouter'
}

export function getDraftModel(): string {
  return getSetting('ai.draftModel') ?? OPENROUTER_DEFAULT_MODELS.draft
}

export function getSttModel(): string {
  return getSetting('ai.sttModel')?.trim() || OPENROUTER_DEFAULT_MODELS.stt
}

interface UsageLike {
  prompt_tokens?: number
  completion_tokens?: number
  cost?: number
}

/** Costs from the OpenRouter response; fallback: price estimate for the default model. */
export function extractUsage(usage: unknown): {
  inputTokens: number
  outputTokens: number
  costUsd: number
} {
  const u = (usage ?? {}) as UsageLike
  const inputTokens = u.prompt_tokens ?? 0
  const outputTokens = u.completion_tokens ?? 0
  const costUsd =
    typeof u.cost === 'number' && u.cost > 0
      ? u.cost
      : (inputTokens * 0.14 + outputTokens * 0.28) / 1_000_000
  return { inputTokens, outputTokens, costUsd }
}
