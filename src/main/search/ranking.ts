import type { SemanticSearchSignal } from '@shared/types'

export interface RankedSearchList {
  signal: Extract<SemanticSearchSignal, 'fulltext' | 'semantic' | 'sender'>
  messageIds: number[]
  weight?: number
}

export interface FusedSearchCandidate {
  messageId: number
  score: number
  signals: Array<Extract<SemanticSearchSignal, 'fulltext' | 'semantic' | 'sender'>>
  bestRank: number
}

/**
 * Reciprocal Rank Fusion combines ranked lists without forcing BM25 and
 * vector distances onto a supposedly common scale.
 */
export function reciprocalRankFusion(lists: RankedSearchList[], rrfK = 60): FusedSearchCandidate[] {
  const fused = new Map<number, FusedSearchCandidate>()

  for (const list of lists) {
    const seen = new Set<number>()
    const weight = list.weight ?? 1
    list.messageIds.forEach((messageId, index) => {
      if (seen.has(messageId)) return
      seen.add(messageId)
      const rank = index + 1
      const current = fused.get(messageId) ?? {
        messageId,
        score: 0,
        signals: [],
        bestRank: rank
      }
      current.score += weight / (rrfK + rank)
      current.bestRank = Math.min(current.bestRank, rank)
      if (!current.signals.includes(list.signal)) current.signals.push(list.signal)
      fused.set(messageId, current)
    })
  }

  return [...fused.values()].sort(
    (a, b) => b.score - a.score || a.bestRank - b.bestRank || a.messageId - b.messageId
  )
}

/**
 * Collapse the ranked messages to one hit per thread. The thread's position
 * comes from its best-ranked message, but the DISPLAYED evidence is the
 * NEWEST matching message of that thread: users search for "the mail from
 * Friday" — a long March forward winning bm25 must not mask it (all
 * candidates matched the query, so recency wins for presentation).
 */
export function dedupeByThread<T extends { threadKey: string; date?: number | null }>(
  rows: T[],
  limit: number
): T[] {
  const order: string[] = []
  const newest = new Map<string, T>()
  for (const row of rows) {
    const current = newest.get(row.threadKey)
    if (!current) {
      order.push(row.threadKey)
      newest.set(row.threadKey, row)
    } else if ((row.date ?? 0) > (current.date ?? 0)) {
      newest.set(row.threadKey, row)
    }
  }
  return order.slice(0, limit).map((threadKey) => newest.get(threadKey)!)
}
