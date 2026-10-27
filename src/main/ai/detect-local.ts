// Detection of locally running AI servers (onboarding). Probes EXCLUSIVELY
// hardwired loopback addresses — no host from user input, no
// credentials, no redirects. Hence also allowed under "Local only".

import { isDecisionCapable, isDecisionOnly, listOllamaModelCaps } from './providers/ollama-caps'

export type LocalServerKind = 'ollama' | 'lmstudio' | 'llamacpp' | 'localai'

export interface DetectedLocalServer {
  kind: LocalServerKind
  /** Base URL for a profile, incl. /v1 */
  baseUrl: string
  models: string[]
  /** Ollama only: decision models (capability `decision`), not included in `models` */
  decisionModels: string[]
}

interface Probe {
  kind: LocalServerKind
  base: string
}

/** Hardcoded candidates; Ollama additionally under "localhost". */
const PROBES: readonly Probe[] = [
  { kind: 'ollama', base: 'http://127.0.0.1:11434/v1' },
  { kind: 'ollama', base: 'http://localhost:11434/v1' },
  { kind: 'lmstudio', base: 'http://127.0.0.1:1234/v1' },
  { kind: 'llamacpp', base: 'http://127.0.0.1:8080/v1' },
  { kind: 'localai', base: 'http://127.0.0.1:8000/v1' }
]

const PROBE_TIMEOUT_MS = 800
const MAX_MODELS = 200
const MAX_ID_LEN = 200
/** Capability query during onboarding: keep it short, detection should stay snappy */
const CAPS_SHOW_LIMIT = 12

async function probeOne(probe: Probe): Promise<DetectedLocalServer | null> {
  try {
    const res = await fetch(`${probe.base}/models`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      data?: unknown
      models?: unknown
    }
    const rows = body.data ?? body.models ?? []
    if (!Array.isArray(rows)) return null
    const seen = new Set<string>()
    for (const row of rows) {
      const r = (row ?? {}) as { id?: unknown; model?: unknown; name?: unknown }
      const id = [r.id, r.model, r.name].find((v) => typeof v === 'string' && v.length > 0)
      if (typeof id === 'string' && id.length <= MAX_ID_LEN) seen.add(id)
      if (seen.size >= MAX_MODELS) break
    }
    let models = [...seen].sort()
    let decisionModels: string[] = []
    if (probe.kind === 'ollama') {
      // Decision models (clef-flash, nimble …) only report `decision` and don't belong in
      // the chat selection; if `capabilities` is missing in /api/tags, briefly ask /api/show.
      const caps = await listOllamaModelCaps(probe.base, {
        tagsTimeoutMs: PROBE_TIMEOUT_MS,
        showTimeoutMs: 600,
        showLimit: CAPS_SHOW_LIMIT
      })
      decisionModels = caps
        .filter((m) => isDecisionCapable(m.capabilities))
        .map((m) => m.name)
        .sort()
      const decisionOnly = new Set(
        caps.filter((m) => isDecisionOnly(m.capabilities)).map((m) => m.name)
      )
      models = models.filter((id) => !decisionOnly.has(id))
    }
    return { kind: probe.kind, baseUrl: probe.base, models, decisionModels }
  } catch {
    return null
  }
}

/** Probe all candidates in parallel; hits in fixed order, once per port. */
export async function detectLocalServers(): Promise<{ found: DetectedLocalServer[] }> {
  const results = await Promise.all(PROBES.map(probeOne))
  const found: DetectedLocalServer[] = []
  for (const r of results) {
    if (!r) continue
    // localhost and 127.0.0.1 on the same port are the same server
    const port = new URL(r.baseUrl).port
    if (!found.some((f) => new URL(f.baseUrl).port === port)) found.push(r)
  }
  return { found }
}
