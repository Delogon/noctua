// Modellwahl für lokale Server (Onboarding): aus der Modellliste eines Servers
// ein kleines, schnelles Modell für die Sortierung (Triage) und das größte für
// Entwürfe vorschlagen. Reine Heuristik über den Namen — der Nutzer kann ändern.

/** Keine Chat-Modelle: Embeddings, Spracherkennung, Reranker, Bild/Ton. */
const NON_CHAT = /embed|nomic|bge-|minilm|e5-|whisper|rerank|clip|tts|stable-?diffusion|flux/i

/** Parameter-Anzahl in Milliarden aus dem Namen („3b", „30b-a3b", „gemma-3-12b", „270m"); sonst null. */
export function modelSizeB(id: string): number | null {
  // Zahl direkt vor b/m, nicht mitten in einem Wort (llama3.2:3b → 3, qwen3:30b-a3b → 30)
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
 * Triage: das kleinste Modell ab 3 B (darunter taugt JSON-Ausgabe selten),
 * sonst das kleinste bekannte. Entwürfe: das größte. Ohne Größenangaben das
 * erste Chat-Modell für beides. Leere Liste → leere Strings.
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
