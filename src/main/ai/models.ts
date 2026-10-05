// Live-Modellliste von OpenRouter (README-Vorgabe: keine hartkodierten IDs).
// Gefiltert auf brauchbare Text-Modelle; Kuratierung (scan vs. write) macht
// der Renderer aus Preis/Kontext.

interface OpenRouterModel {
  id: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[] }
}

export interface ModelInfo {
  id: string
  promptPerM: number
  completionPerM: number
  context: number
  /** nimmt Audio als Input (Diktat-Transkription) */
  audioIn: boolean
}

const PROVIDERS = /^(anthropic|openai|google|mistralai|deepseek|meta-llama|qwen|x-ai)\//

let cache: { at: number; models: ModelInfo[] } | null = null

export async function listModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.models
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`OpenRouter-Modellliste: HTTP ${res.status}`)
  const body = (await res.json()) as { data?: OpenRouterModel[] }
  const models = (body.data ?? [])
    .filter((m) => PROVIDERS.test(m.id))
    .filter((m) => !m.id.includes(':free') && !m.id.includes('-exp'))
    .map((m) => ({
      id: m.id,
      promptPerM: Math.round(parseFloat(m.pricing?.prompt ?? '0') * 1_000_000 * 100) / 100,
      completionPerM: Math.round(parseFloat(m.pricing?.completion ?? '0') * 1_000_000 * 100) / 100,
      context: m.context_length ?? 0,
      audioIn: (m.architecture?.input_modalities ?? []).includes('audio')
    }))
    .filter((m) => m.promptPerM > 0 && (m.context >= 32_000 || m.audioIn))
  cache = { at: Date.now(), models }
  return models
}
