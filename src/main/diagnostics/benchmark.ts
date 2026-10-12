import { performance } from 'node:perf_hooks'
import type Database from 'better-sqlite3-multiple-ciphers'
import { listFolders, listThreads, getThreadMessages, mboxCounts } from '../db/repos/threads'
import { rebuildContactStats } from '../db/repos/contacts'
import { searchSemantic, semanticIndexStatus } from '../search'
import { TRIAGE_DISCOVERY_SQL, TRIAGE_WINDOW_MS } from '../ai/queue'
import { PROMPT_VERSION } from '../ai/triage'
import { sqlFingerprint } from './metrics'
import { setSqlCapture } from './db-profiler'

// Benchmark against the real, local database: the operations that stand out with
// large mailboxes (list, counters, folders, open thread, search, AI discovery,
// contact stats), each measured several times. Writing operations run in a
// SAVEPOINT and are rolled back. Plus EXPLAIN QUERY PLAN for every query that
// ran — plans only name tables/indexes, no values.

export interface BenchmarkCase {
  name: string
  runs: number
  minMs: number
  medianMs: number
  maxMs: number
  /** Statements per run (reveals N+1 patterns) */
  statements: number
  error: string | null
}

export interface QueryPlan {
  sql: string
  usedBy: string[]
  plan: string[]
  /** Tables read in full without an index */
  fullScans: string[]
  /** Tables whose index is traversed completely (no targeted SEARCH) */
  indexScans: string[]
  /** Temporary B-trees for ORDER BY / GROUP BY / DISTINCT */
  tempBtrees: number
}

export interface BenchmarkResult {
  startedAt: number
  durationMs: number
  cases: BenchmarkCase[]
  plans: QueryPlan[]
}

type CaseSpec =
  | { name: string; write?: false; run: () => unknown }
  /** Write cases must be synchronous (SAVEPOINT/ROLLBACK in the same tick). */
  | { name: string; write: true; run: () => void }

const MAX_PLANS = 80

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Evaluate plan rows: `SCAN t` reads the whole table, `SCAN t USING INDEX i`
 * the whole index (also O(n), just cheaper). `SEARCH` is a targeted access.
 */
export function analysePlan(lines: string[]): {
  fullScans: string[]
  indexScans: string[]
  tempBtrees: number
} {
  const scans = lines
    .map((l) => l.match(/^SCAN (\S+)(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null && !/VIRTUAL TABLE/.test(m[2]))
  const fullScans = scans.filter((m) => !/USING (?:COVERING )?INDEX/.test(m[2])).map((m) => m[1])
  const indexScans = scans.filter((m) => /USING (?:COVERING )?INDEX/.test(m[2])).map((m) => m[1])
  const tempBtrees = lines.filter((l) => /USE TEMP B-TREE/.test(l)).length
  return { fullScans: [...new Set(fullScans)], indexScans: [...new Set(indexScans)], tempBtrees }
}

function specs(db: Database.Database): CaseSpec[] {
  const firstAccount = (
    db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get() as { id: number } | undefined
  )?.id
  const newestInboxThread = (
    db
      .prepare(
        `SELECT m.thread_key FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE f.special_use = '\\Inbox' ORDER BY m.date DESC LIMIT 1`
      )
      .get() as { thread_key: string } | undefined
  )?.thread_key
  const out: CaseSpec[] = [
    { name: 'threads.list.inbox(300)', run: () => listThreads(db, 300, undefined, 'inbox') },
    { name: 'threads.list.sent(300)', run: () => listThreads(db, 300, undefined, 'sent') },
    { name: 'threads.list.spam(300)', run: () => listThreads(db, 300, undefined, 'spam') },
    { name: 'threads.mboxCounts', run: () => mboxCounts(db) },
    { name: 'folders.list', run: () => listFolders(db) },
    { name: 'search.index.status', run: () => semanticIndexStatus(db) },
    {
      // fixed, generic search term; full text + sender channel only (no model)
      name: 'search.lexical("rechnung meeting")',
      run: () =>
        searchSemantic(db, { q: 'rechnung meeting', limit: 30 }, { embedQuery: async () => [] })
    },
    {
      name: 'ai.queue.discoverTriage',
      write: true,
      run: () => db.prepare(TRIAGE_DISCOVERY_SQL).run(Date.now() - TRIAGE_WINDOW_MS, PROMPT_VERSION)
    }
  ]
  if (newestInboxThread) {
    out.splice(5, 0, {
      name: 'thread.open(newest inbox)',
      run: () => getThreadMessages(db, newestInboxThread)
    })
  }
  if (firstAccount !== undefined) {
    out.push({
      name: 'contacts.rebuildStats(account 1)',
      write: true,
      run: () => rebuildContactStats(db, firstAccount)
    })
  }
  return out
}

/**
 * Runs the benchmark. Blocks the main process for the duration of the runs
 * (intended: these queries block exactly like this in everyday use).
 */
export async function runBenchmark(
  db: Database.Database,
  options: { runs?: number } = {}
): Promise<BenchmarkResult> {
  const runs = Math.max(1, Math.min(10, options.runs ?? 3))
  const startedAt = Date.now()
  const started = performance.now()
  const captured = new Map<string, { sql: string; args: unknown[]; usedBy: Set<string> }>()
  const cases: BenchmarkCase[] = []

  for (const spec of specs(db)) {
    const times: number[] = []
    let statements = 0
    let error: string | null = null
    setSqlCapture((sql, args) => {
      statements += 1
      const fp = sqlFingerprint(sql)
      const entry = captured.get(fp)
      if (entry) entry.usedBy.add(spec.name)
      else if (captured.size < MAX_PLANS) {
        captured.set(fp, { sql, args, usedBy: new Set([spec.name]) })
      }
    })
    try {
      for (let i = 0; i < runs; i++) {
        const t = performance.now()
        if (spec.write) {
          // Strictly synchronous: between SAVEPOINT and ROLLBACK no other
          // task (sync, AI queue) may write – otherwise it would be rolled back too.
          db.exec('SAVEPOINT noctua_bench')
          try {
            spec.run()
          } finally {
            times.push(performance.now() - t)
            db.exec('ROLLBACK TO noctua_bench; RELEASE noctua_bench')
          }
        } else {
          try {
            await spec.run()
          } finally {
            times.push(performance.now() - t)
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : String(e)
    } finally {
      setSqlCapture(null)
    }
    cases.push({
      name: spec.name,
      runs: times.length,
      minMs: round(times.length ? Math.min(...times) : 0),
      medianMs: round(median(times)),
      maxMs: round(Math.max(0, ...times)),
      statements: times.length ? Math.round(statements / times.length) : 0,
      error
    })
    // Briefly yield the event loop between cases
    await new Promise((resolve) => setImmediate(resolve))
  }

  const plans: QueryPlan[] = []
  for (const [fp, entry] of captured) {
    if (!/^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE)/i.test(entry.sql)) continue
    try {
      const rows = db.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).all(...entry.args) as Array<{
        detail: string
      }>
      const lines = rows.map((r) => r.detail)
      plans.push({ sql: fp, usedBy: [...entry.usedBy], plan: lines, ...analysePlan(lines) })
    } catch {
      // Plan not determinable (e.g. virtual table without parameters) — skip
    }
  }
  plans.sort(
    (a, b) =>
      b.fullScans.length - a.fullScans.length ||
      b.indexScans.length - a.indexScans.length ||
      b.tempBtrees - a.tempBtrees
  )

  return { startedAt, durationMs: round(performance.now() - started), cases, plans }
}
