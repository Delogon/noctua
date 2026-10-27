import { ollamaRoot } from './systemone'

// Capabilities of Ollama models: GET {root}/api/tags (newer versions include
// `capabilities` per model) or POST {root}/api/show {model}. Decision
// models report ONLY `decision` – they must never be picked for chat/generation
// (the server responds with errors there).

export interface OllamaModelCaps {
  name: string
  /** null = unknown (server reports no capabilities) */
  capabilities: string[] | null
}

const SHOW_LIMIT = 40
const SHOW_CONCURRENCY = 4
const CACHE_MS = 60_000

/** Pure decision model: can do `decision`, but no text generation. */
export function isDecisionOnly(caps: string[] | null | undefined): boolean {
  return !!caps && caps.includes('decision') && !caps.includes('completion')
}

export function isDecisionCapable(caps: string[] | null | undefined): boolean {
  return !!caps && caps.includes('decision')
}

function readCaps(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((c): c is string => typeof c === 'string').slice(0, 20)
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const res = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface ListCapsOptions {
  apiKey?: string | null
  tagsTimeoutMs?: number
  showTimeoutMs?: number
  /** query at most this many models via /api/show (default 40) */
  showLimit?: number
  fetchImpl?: typeof fetch
}

/**
 * Models with their capabilities. /api/tags first; if `capabilities` is missing
 * there, queries /api/show for at most SHOW_LIMIT models (short timeouts, parallel).
 * No Ollama (or unreachable) → empty list, never a throw.
 */
export async function listOllamaModelCaps(
  baseUrl: string,
  opts: ListCapsOptions = {}
): Promise<OllamaModelCaps[]> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const root = ollamaRoot(baseUrl)
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {})
  }
  let rows: unknown[]
  try {
    const body = (await fetchJson(
      `${root}/api/tags`,
      { headers },
      opts.tagsTimeoutMs ?? 2000,
      fetchImpl
    )) as { models?: unknown }
    rows = Array.isArray(body.models) ? body.models : []
  } catch {
    return []
  }
  const models: OllamaModelCaps[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const r = (row ?? {}) as { name?: unknown; model?: unknown; capabilities?: unknown }
    const name = [r.name, r.model].find((v) => typeof v === 'string' && v.length > 0)
    if (typeof name !== 'string' || name.length > 200 || seen.has(name)) continue
    seen.add(name)
    models.push({ name, capabilities: readCaps(r.capabilities) })
  }

  // Known decision models first so they don't fall outside the limit
  const unknown = models
    .filter((m) => m.capabilities === null)
    .sort((a, b) => Number(looksLikeDecision(b.name)) - Number(looksLikeDecision(a.name)))
    .slice(0, opts.showLimit ?? SHOW_LIMIT)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < unknown.length) {
      const m = unknown[next++]
      try {
        const body = (await fetchJson(
          `${root}/api/show`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m.name })
          },
          opts.showTimeoutMs ?? 1500,
          fetchImpl
        )) as { capabilities?: unknown }
        m.capabilities = readCaps(body.capabilities)
      } catch {
        // stays unknown (= treated like a chat model)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SHOW_CONCURRENCY, unknown.length) }, worker))
  return models
}

/** Name heuristic only for ordering the /api/show queries, never as a verdict. */
function looksLikeDecision(name: string): boolean {
  return /^(clef|nimble|tev)/i.test(name.replace(/^.*\//, ''))
}

const capsCache = new Map<string, { at: number; models: OllamaModelCaps[] }>()

/** Like listOllamaModelCaps, cached for 60 s (model pickers fire repeatedly). */
export async function getOllamaModelCaps(
  baseUrl: string,
  opts: ListCapsOptions = {}
): Promise<OllamaModelCaps[]> {
  const key = ollamaRoot(baseUrl)
  const hit = capsCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.models
  const models = await listOllamaModelCaps(baseUrl, opts)
  capsCache.set(key, { at: Date.now(), models })
  return models
}

export function clearOllamaCapsCache(): void {
  capsCache.clear()
}
