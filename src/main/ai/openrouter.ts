import { getSetting } from '../db'

// OpenRouter-Spezifika (ZDR-Routing, Kostenauslese). Der Client selbst kommt aus
// der Provider-Schicht (providers/registry.ts).

/**
 * Zero Data Retention (M86): standardmäßig routet OpenRouter nur zu
 * Anbietern, die Prompts nicht speichern (`data_collection: 'deny'`).
 * Abschaltbar über ai.zdrOnly = '0' — dann stehen mehr Modelle bereit,
 * aber ohne ZDR-Garantie.
 */
export function zdrOnly(): boolean {
  return getSetting('ai.zdrOnly') !== '0'
}

/** OpenRouter-Zusatzfelder für chat.completions.create — bei allen Calls spreaden. */
export function providerBody(): Record<string, unknown> {
  return zdrOnly() ? { provider: { data_collection: 'deny' } } : {}
}

/** Default-Modelle des OpenRouter-Profils (ohne ausdrückliche Wahl in den Settings). */
export const OPENROUTER_DEFAULT_MODELS = {
  triage: 'deepseek/deepseek-v4-flash',
  draft: 'anthropic/claude-opus-4.8',
  // Diktat-Transkription. Hinweis: dediziertes Whisper (openai/whisper-large-v3)
  // listet OpenRouter derzeit nicht — gpt-audio-mini ist der günstigste
  // Audio-Input-Chat; die Auswahl in den Einstellungen speist sich live
  // aus dem Katalog und zeigt Whisper automatisch, sobald es existiert.
  stt: 'openai/gpt-audio-mini'
} as const

export function getTriageModel(): string {
  return getSetting('ai.triageModel') ?? OPENROUTER_DEFAULT_MODELS.triage
}

/** Wer rechnet die Triage: OpenRouter (Cloud) oder Apple Intelligence (lokal). */
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

/** Kosten aus der OpenRouter-Response; Fallback: Preisschätzung fürs Default-Modell. */
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
