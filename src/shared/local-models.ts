// Model choice for local servers (onboarding): from a server's model list, suggest
// a small, fast model for sorting (triage) and the largest one for drafts.
// Pure heuristic based on the name — the user can change it.

/** Not chat models: embeddings, speech recognition, rerankers, image/audio. */
const NON_CHAT = /embed|nomic|bge-|minilm|e5-|whisper|rerank|clip|tts|stable-?diffusion|flux/i

/** Parameter count in billions from the name ("3b", "30b-a3b", "gemma-3-12b", "270m"); else null. */
export function modelSizeB(id: string): number | null {
  // Number right before b/m, not mid-word (llama3.2:3b → 3, qwen3:30b-a3b → 30)
  const re = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)([bm])(?![a-z])/gi
  let first: number | null = null
  for (const m of id.matchAll(re)) {
    const n = Number(m[1]) / (m[2].toLowerCase() === 'm' ? 1000 : 1)
    if (first === null) first = n
  }
  return first
}

export interface PickedModels {
  triage: string
  draft: string
}

/**
 * Triage: the smallest model from 3 B up (below that, JSON output is rarely usable),
 * otherwise the smallest known. Drafts: the largest. Without sizes, the first
 * chat model for both. Empty list → empty strings.
 */
export function pickLocalModels(ids: string[]): PickedModels {
  const chat = ids.filter((id) => !NON_CHAT.test(id))
  const pool = chat.length > 0 ? chat : ids
  if (pool.length === 0) return { triage: '', draft: '' }
  const sized = pool
    .map((id) => ({ id, size: modelSizeB(id) }))
    .filter((m): m is { id: string; size: number } => m.size !== null)
  if (sized.length === 0) return { triage: pool[0], draft: pool[0] }
  const bySize = [...sized].sort((a, b) => a.size - b.size || a.id.localeCompare(b.id))
  const triage = bySize.find((m) => m.size >= 3) ?? bySize[0]
  const draft = bySize[bySize.length - 1]
  return { triage: triage.id, draft: draft.id }
}
