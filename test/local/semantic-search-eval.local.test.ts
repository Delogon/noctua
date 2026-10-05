import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'
import { describe, expect, it } from 'vitest'
import { semanticSearch } from '@main/search'

interface GoldExpectation {
  messageIds?: number[]
  threadKeys?: string[]
  maxRank: number
}

interface GoldCase {
  id: string
  question: string
  answer: string
  expected: GoldExpectation
}

interface GoldDataset {
  schemaVersion: number
  locale: string
  privacy: string
  cases: GoldCase[]
}

interface EvaluatedCase {
  id: string
  question: string
  expectedAnswer: string
  rank: number | null
  threadRank: number | null
  expectedMaxRank: number
  latencyMs: number
  topHits: Array<{
    rank: number
    messageId: number
    threadKey: string
    subject: string | null
    from: string | null
    date: string | null
    signals: string[]
  }>
}

function defaultUserDataPath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'noctua')
  }
  return join(homedir(), '.noctua')
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function expectedRank(
  hits: Awaited<ReturnType<typeof semanticSearch>>['hits'],
  expected: GoldExpectation
): number | null {
  const messageIds = new Set(expected.messageIds ?? [])
  const threadKeys = new Set(expected.threadKeys ?? [])
  const index = hits.findIndex((hit) =>
    messageIds.size > 0 ? messageIds.has(hit.messageId) : threadKeys.has(hit.threadKey)
  )
  return index < 0 ? null : index + 1
}

function expectedThreadRank(
  hits: Awaited<ReturnType<typeof semanticSearch>>['hits'],
  expected: GoldExpectation
): number | null {
  const threadKeys = new Set(expected.threadKeys ?? [])
  if (threadKeys.size === 0) return expectedRank(hits, expected)
  const index = hits.findIndex((hit) => threadKeys.has(hit.threadKey))
  return index < 0 ? null : index + 1
}

const enabled = process.env.NOCTUA_SEMANTIC_EVAL === '1'
const localDescribe = enabled ? describe : describe.skip

localDescribe('local semantic-search gold evaluation', () => {
  it('findet die verifizierten echten Mails mit belastbarer Qualität', async () => {
    const userData = defaultUserDataPath()
    const databasePath =
      process.env.NOCTUA_SEMANTIC_EVAL_DB?.trim() || join(userData, 'noctua.sqlite')
    const goldPath =
      process.env.NOCTUA_SEMANTIC_EVAL_GOLD?.trim() ||
      join(dirname(databasePath), 'evaluation', 'semantic-search-gold.json')
    const reportPath =
      process.env.NOCTUA_SEMANTIC_EVAL_REPORT?.trim() ||
      join(dirname(databasePath), 'evaluation', 'semantic-search-report.json')

    expect(existsSync(databasePath), `Lokale Maildatenbank fehlt: ${databasePath}`).toBe(true)
    expect(existsSync(goldPath), `Lokaler Gold-Datensatz fehlt: ${goldPath}`).toBe(true)

    const gold = JSON.parse(readFileSync(goldPath, 'utf8')) as GoldDataset
    expect(gold.schemaVersion).toBe(1)
    expect(gold.privacy).toContain('local-only')
    expect(gold.cases.length).toBeGreaterThanOrEqual(12)

    process.env.NOCTUA_MODEL_CACHE_DIR ??= join(dirname(databasePath), 'models')

    const db = new Database(databasePath, { readonly: true, fileMustExist: true })
    sqliteVec.load(db)
    db.pragma('query_only = ON')

    const evaluated: EvaluatedCase[] = []
    try {
      for (const goldCase of gold.cases) {
        const startedAt = performance.now()
        const result = await semanticSearch(db, { q: goldCase.question, limit: 10 })
        const latencyMs = performance.now() - startedAt
        evaluated.push({
          id: goldCase.id,
          question: goldCase.question,
          expectedAnswer: goldCase.answer,
          rank: expectedRank(result.hits, goldCase.expected),
          threadRank: expectedThreadRank(result.hits, goldCase.expected),
          expectedMaxRank: goldCase.expected.maxRank,
          latencyMs: rounded(latencyMs),
          topHits: result.hits.slice(0, 5).map((hit, index) => ({
            rank: index + 1,
            messageId: hit.messageId,
            threadKey: hit.threadKey,
            subject: hit.subject,
            from: hit.fromName ?? hit.fromAddr,
            date: hit.date === null ? null : new Date(hit.date).toISOString(),
            signals: hit.signals
          }))
        })
      }
    } finally {
      db.close()
    }

    const count = evaluated.length
    const recallAt = (rank: number): number =>
      evaluated.filter((entry) => entry.rank !== null && entry.rank <= rank).length / count
    const threadRecallAt = (rank: number): number =>
      evaluated.filter((entry) => entry.threadRank !== null && entry.threadRank <= rank).length /
      count
    const expectedRankRate =
      evaluated.filter((entry) => entry.rank !== null && entry.rank <= entry.expectedMaxRank)
        .length / count
    const meanReciprocalRank =
      evaluated.reduce((sum, entry) => sum + (entry.rank === null ? 0 : 1 / entry.rank), 0) / count
    const threadMeanReciprocalRank =
      evaluated.reduce(
        (sum, entry) => sum + (entry.threadRank === null ? 0 : 1 / entry.threadRank),
        0
      ) / count
    const latencies = evaluated.map((entry) => entry.latencyMs)
    const warmLatencies = latencies.slice(1)
    const metrics = {
      cases: count,
      recallAt1: rounded(recallAt(1)),
      recallAt3: rounded(recallAt(3)),
      recallAt5: rounded(recallAt(5)),
      recallAt10: rounded(recallAt(10)),
      threadRecallAt1: rounded(threadRecallAt(1)),
      threadRecallAt3: rounded(threadRecallAt(3)),
      threadRecallAt5: rounded(threadRecallAt(5)),
      expectedRankRate: rounded(expectedRankRate),
      meanReciprocalRank: rounded(meanReciprocalRank),
      threadMeanReciprocalRank: rounded(threadMeanReciprocalRank),
      coldStartMs: rounded(latencies[0] ?? 0),
      warmMeanMs: rounded(
        warmLatencies.reduce((sum, latency) => sum + latency, 0) / Math.max(1, warmLatencies.length)
      ),
      warmP95Ms: rounded(percentile(warmLatencies, 0.95))
    }

    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          privacy: 'local-only; no raw mail bodies or excerpts',
          model: 'Xenova/multilingual-e5-small',
          databasePath,
          goldPath,
          metrics,
          cases: evaluated
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    console.log(
      `\nLokaler Semantic-Search-Benchmark: ${JSON.stringify(metrics)}\nBericht: ${reportPath}`
    )

    // Bewusst moderate erste Qualitätsbarriere. Der Bericht bleibt auch bei
    // einem Fehlschlag erhalten und zeigt die konkreten Problemfälle.
    expect(metrics.recallAt5).toBeGreaterThanOrEqual(0.7)
    expect(metrics.expectedRankRate).toBeGreaterThanOrEqual(0.65)
    expect(metrics.meanReciprocalRank).toBeGreaterThanOrEqual(0.45)
  }, 120_000)
})
