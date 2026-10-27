import type Database from 'better-sqlite3-multiple-ciphers'
import { foldSharpS } from './fold'

/**
 * Typo-tolerant sender lookup (M92): "letzte Mail von jens buetfisch" must
 * find "Bütefisch, Jens <jens.buetefisch@…>" even though the query drops an
 * "e" and the index folds ü→u. Query terms are matched against the tokens of
 * every known sender (name words + address local-part) with a bounded edit
 * distance; matched senders feed a dedicated recency-ordered candidate list
 * into search fusion and the owl retrieval basket.
 */

/** Levenshtein distance with early exit once `max` is exceeded. */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution)
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > max) return max + 1
    previous = current
  }
  return previous[b.length]
}

/** Lowercase, fold ß→ss and strip diacritics — mirrors the FTS folding. */
export function normalizeToken(raw: string): string {
  return foldSharpS(raw.toLocaleLowerCase('de-DE'))
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
}

export function allowedDistance(length: number): number {
  if (length <= 4) return 0
  if (length <= 6) return 1
  return 2
}

/** Generic mailbox words that must never identify a sender. */
export const GENERIC_TOKENS = new Set([
  'info',
  'kontakt',
  'contact',
  'office',
  'noreply',
  'no-reply',
  'newsletter',
  'service',
  'support',
  'team',
  'hallo',
  'hello'
])

export interface SenderRow {
  addr: string
  name: string | null
  weight: number
}

export function senderTokens(row: SenderRow): string[] {
  const local = row.addr.split('@')[0] ?? ''
  const parts = [...local.split(/[._\-+]/), ...(row.name ?? '').split(/[\s,._\-"']+/)]
  return [...new Set(parts.map(normalizeToken).filter((token) => token.length >= 3))]
}

export interface FuzzySenderMatch {
  addr: string
  distance: number
  weight: number
}

/**
 * Sender inventory as a token index: each distinct token once, grouped by
 * length, pointing to the senders that carry it. Rebuilt when new messages
 * arrived (max id changed) or after SENDER_INDEX_TTL_MS (deletes, renames).
 */
interface SenderIndex {
  maxId: number
  builtAt: number
  senders: SenderRow[]
  tokensByLength: Map<number, Map<string, number[]>>
}

const SENDER_INDEX_TTL_MS = 60_000
const senderIndexes = new WeakMap<Database.Database, SenderIndex>()

function senderIndex(db: Database.Database): SenderIndex {
  const maxId = (db.prepare('SELECT max(id) FROM messages').pluck().get() as number | null) ?? 0
  const cached = senderIndexes.get(db)
  if (cached && cached.maxId === maxId && Date.now() - cached.builtAt < SENDER_INDEX_TTL_MS) {
    return cached
  }
  const senders = db
    .prepare(
      `SELECT lower(from_addr) AS addr, max(from_name) AS name, count(*) AS weight
       FROM messages
       WHERE from_addr IS NOT NULL AND from_addr <> ''
       GROUP BY lower(from_addr)`
    )
    .all() as SenderRow[]
  const tokensByLength = new Map<number, Map<string, number[]>>()
  senders.forEach((sender, index) => {
    for (const token of senderTokens(sender)) {
      if (GENERIC_TOKENS.has(token)) continue
      let byToken = tokensByLength.get(token.length)
      if (!byToken) tokensByLength.set(token.length, (byToken = new Map()))
      const owners = byToken.get(token)
      if (owners) owners.push(index)
      else byToken.set(token, [index])
    }
  })
  const index: SenderIndex = { maxId, builtAt: Date.now(), senders, tokensByLength }
  senderIndexes.set(db, index)
  return index
}

/**
 * Match query terms against all known senders. Returns the best few sender
 * addresses, closest edit distance first, message count as tie-breaker.
 */
export function fuzzySenderMatches(
  db: Database.Database,
  terms: string[],
  maxResults = 3
): FuzzySenderMatch[] {
  const candidates = terms
    .map(normalizeToken)
    .filter((term) => term.length >= 4 && !GENERIC_TOKENS.has(term))
  if (candidates.length === 0) return []

  const { senders, tokensByLength } = senderIndex(db)
  // Best distance per sender; each distinct token is compared once, and only
  // tokens whose length is within the edit budget
  const best = new Map<number, number>()
  for (const term of candidates) {
    const budget = allowedDistance(term.length)
    for (let length = term.length - budget; length <= term.length + budget; length++) {
      for (const [token, owners] of tokensByLength.get(length) ?? []) {
        const distance = boundedLevenshtein(term, token, budget)
        if (distance > budget) continue
        for (const owner of owners) {
          const previous = best.get(owner)
          if (previous === undefined || distance < previous) best.set(owner, distance)
        }
      }
    }
  }

  return [...best.entries()]
    .map(([index, distance]) => ({
      addr: senders[index].addr,
      distance,
      weight: senders[index].weight
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        b.weight - a.weight ||
        (a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0)
    )
    .slice(0, maxResults)
}

/** Newest messages of the matched senders — a ranked list for search fusion. */
export function fuzzySenderMessageIds(
  db: Database.Database,
  terms: string[],
  limit: number,
  accountId?: number
): number[] {
  const matched = fuzzySenderMatches(db, terms)
  if (matched.length === 0) return []
  const placeholders = matched.map(() => '?').join(', ')
  return (
    db
      .prepare(
        `SELECT m.id FROM messages m
         JOIN folders f ON f.id = m.folder_id
         WHERE lower(m.from_addr) IN (${placeholders})
           AND m.draft = 0
           AND lower(replace(coalesce(f.special_use, ''), char(92), ''))
               NOT IN ('junk', 'spam', 'trash', 'drafts')
           AND (? IS NULL OR m.account_id = ?)
         ORDER BY coalesce(m.date, m.internal_date, 0) DESC
         LIMIT ?`
      )
      .all(...matched.map((m) => m.addr), accountId ?? null, accountId ?? null, limit) as Array<{
      id: number
    }>
  ).map((row) => row.id)
}

/** Newest thread keys of the matched senders — for the owl retrieval basket. */
export function fuzzySenderThreadKeys(
  db: Database.Database,
  terms: string[],
  limit: number
): string[] {
  const matched = fuzzySenderMatches(db, terms)
  if (matched.length === 0) return []
  const placeholders = matched.map(() => '?').join(', ')
  return (
    db
      .prepare(
        `SELECT m.thread_key, max(coalesce(m.date, m.internal_date, 0)) AS newest
         FROM messages m
         WHERE lower(m.from_addr) IN (${placeholders})
         GROUP BY m.thread_key
         ORDER BY newest DESC
         LIMIT ?`
      )
      .all(...matched.map((m) => m.addr), limit) as Array<{ thread_key: string }>
  ).map((row) => row.thread_key)
}
