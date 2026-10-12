import { performance } from 'node:perf_hooks'
import type Database from 'better-sqlite3-multiple-ciphers'
import { metrics, sqlFingerprint, type Metrics } from './metrics'

const INSTRUMENTED = Symbol.for('noctua.diagnostics.instrumented')

type StatementMethod = 'run' | 'get' | 'all'

type SqlCapture = (sql: string, args: unknown[]) => void
let capture: SqlCapture | null = null
/**
 * Benchmark only: reports executed SQL including parameters so that
 * EXPLAIN QUERY PLAN can run with the same values. The values never leave
 * the process; only the plan is exported.
 */
export function setSqlCapture(fn: SqlCapture | null): void {
  capture = fn
}

function rowsOf(method: StatementMethod, result: unknown): number {
  if (method === 'all') return Array.isArray(result) ? result.length : 0
  if (method === 'get') return result === undefined ? 0 : 1
  return (result as { changes?: number } | undefined)?.changes ?? 0
}

/**
 * Measures every SQL statement of the connection: compiling (prepare) and executing
 * (run/get/all) per normalized SQL text. This lets the export show which
 * queries cost time with large mailboxes — without parameter values. iterate()
 * stays unmeasured (its runtime depends on the caller). Idempotent.
 */
export function instrumentDb(db: Database.Database, target: Metrics = metrics): void {
  const marked = db as unknown as Record<symbol, boolean>
  if (marked[INSTRUMENTED]) return
  marked[INSTRUMENTED] = true

  const prepare = db.prepare.bind(db)
  const wrappedPrepare = (sql: string): Database.Statement => {
    if (!target.enabled && !capture) return prepare(sql)
    const start = performance.now()
    const stmt = prepare(sql)
    const fp = sqlFingerprint(sql)
    target.sqlPrepare(fp, performance.now() - start)
    for (const method of ['run', 'get', 'all'] as const) {
      const original = stmt[method] as (...args: unknown[]) => unknown
      Object.defineProperty(stmt, method, {
        configurable: true,
        writable: true,
        value: function (this: Database.Statement, ...args: unknown[]): unknown {
          capture?.(sql, args)
          if (!target.enabled) return original.apply(this, args)
          const t = performance.now()
          let result: unknown
          try {
            result = original.apply(this, args)
            return result
          } finally {
            target.sqlExec(fp, performance.now() - t, rowsOf(method, result))
          }
        }
      })
    }
    return stmt
  }
  db.prepare = wrappedPrepare as typeof db.prepare

  const exec = db.exec.bind(db)
  db.exec = ((sql: string) => {
    if (!target.enabled) return exec(sql)
    const t = performance.now()
    try {
      return exec(sql)
    } finally {
      target.sqlExec(sqlFingerprint(sql), performance.now() - t, 0)
    }
  }) as typeof db.exec
}
