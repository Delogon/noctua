import type { ModelInfo } from './types'

/**
 * Modellliste eines OpenAI-kompatiblen Endpunkts: GET {baseUrl}/models.
 * Funktioniert mit Ollama, LM Studio, llama.cpp, vLLM und LiteLLM. Preise
 * kennen diese Server nicht — die Felder bleiben 0.
 */
export async function fetchOpenAiModels(
  baseUrl: string,
  apiKey: string | null,
  timeoutMs = 10_000
): Promise<ModelInfo[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`Modellliste: HTTP ${res.status}`)
  const body = (await res.json()) as {
    data?: Array<{ id?: unknown; context_length?: unknown }>
    models?: Array<{ id?: unknown; name?: unknown; model?: unknown }>
  }
  // llama.cpp/Ollama liefern teils `models` statt `data`
  const rows: Array<{ id?: unknown; name?: unknown; model?: unknown; context_length?: unknown }> =
    body.data ?? body.models ?? []
  const seen = new Set<string>()
  const models: ModelInfo[] = []
  for (const row of rows) {
    const id = [row.id, row.model, row.name].find((v) => typeof v === 'string' && v.length > 0)
    if (typeof id !== 'string' || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      promptPerM: 0,
      completionPerM: 0,
      context: typeof row.context_length === 'number' ? row.context_length : 0,
      audioIn: false
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
}
