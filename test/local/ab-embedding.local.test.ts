// Embedding-model A/B runner: evaluates the gold set against a snapshot
// whose message_vecs were rebuilt with a candidate model (see M96).
// Env: NOCTUA_AB=1, NOCTUA_AB_DB, NOCTUA_AB_GOLD, NOCTUA_AB_MODEL, NOCTUA_AB_CACHE
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'
import { describe, expect, it } from 'vitest'
import { pipeline, env as hfEnv } from '@huggingface/transformers'
import { semanticSearch } from '@main/search'

const enabled = process.env.NOCTUA_AB === '1'
const localDescribe = enabled ? describe : describe.skip

localDescribe('embedding model A/B', () => {
  it('reports gold metrics for the configured model/db', async () => {
    const dbPath = process.env.NOCTUA_AB_DB!
    const goldPath = process.env.NOCTUA_AB_GOLD!
    const modelId = process.env.NOCTUA_AB_MODEL!
    hfEnv.cacheDir = process.env.NOCTUA_AB_CACHE!

    const gold = JSON.parse(readFileSync(goldPath, 'utf8')) as {
      cases: Array<{
        id: string
        question: string
        expected: { messageIds?: number[]; threadKeys?: string[]; maxRank: number }
      }>
    }
    const extractor = await pipeline('feature-extraction', modelId, { dtype: 'q8' })
    const embedQuery = async (text: string): Promise<Float32Array[]> => {
      const output = await extractor([`query: ${text.slice(0, 1500)}`], {
        pooling: 'mean',
        normalize: true
      })
      return [new Float32Array(output.data as Float32Array)]
    }

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    sqliteVec.load(db)
    db.pragma('query_only = ON')

    const perCase: Array<{ id: string; rank: number | null }> = []
    try {
      for (const goldCase of gold.cases) {
        const result = await semanticSearch(db, { q: goldCase.question, limit: 10 }, { embedQuery })
        const ids = new Set(goldCase.expected.messageIds ?? [])
        const keys = new Set(goldCase.expected.threadKeys ?? [])
        const index = result.hits.findIndex((hit) =>
          ids.size > 0 ? ids.has(hit.messageId) : keys.has(hit.threadKey)
        )
        perCase.push({ id: goldCase.id, rank: index < 0 ? null : index + 1 })
      }
    } finally {
      db.close()
    }

    const n = perCase.length
    const at = (k: number): number =>
      perCase.filter((c) => c.rank !== null && c.rank <= k).length / n
    const mrr = perCase.reduce((s, c) => s + (c.rank === null ? 0 : 1 / c.rank), 0) / n
    console.log(
      `AB-RESULT ${modelId}: ${JSON.stringify({
        cases: n,
        recallAt1: Math.round(at(1) * 1000) / 1000,
        recallAt3: Math.round(at(3) * 1000) / 1000,
        recallAt5: Math.round(at(5) * 1000) / 1000,
        recallAt10: Math.round(at(10) * 1000) / 1000,
        mrr: Math.round(mrr * 1000) / 1000
      })}`
    )
    console.log(
      `AB-MISSES: ${perCase
        .filter((c) => c.rank === null || c.rank > 5)
        .map((c) => `${c.id}:${c.rank ?? 'miss'}`)
        .join(', ')}`
    )
    expect(n).toBeGreaterThan(0)
  })
})
