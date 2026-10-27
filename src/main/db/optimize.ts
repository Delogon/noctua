import type Database from 'better-sqlite3-multiple-ciphers'
import { metrics } from '../diagnostics/metrics'

/**
 * Page cache per connection in KiB (~32 MB instead of SQLite's default 2 MB).
 * Every page read from the encrypted file is also decrypted, so a warm cache
 * saves both I/O and AES work on repeated list/count queries.
 */
export const CACHE_SIZE_KIB = 32_000

/** Delay of the first optimize after startup, so it stays off the hot path. */
export const STARTUP_OPTIMIZE_DELAY_MS = 60_000
/** Interval of the periodic optimize (picks up tables that grew, e.g. after backfill). */
export const OPTIMIZE_INTERVAL_MS = 6 * 60 * 60_000

export function configureCache(db: Database.Database): void {
  db.pragma(`cache_size = -${CACHE_SIZE_KIB}`)
}

/**
 * Internal tables of FTS5 and sqlite-vec: only accessed by rowid from inside
 * the virtual table, so statistics on them are never used but cost the most
 * time (they hold the full mail text).
 */
const SHADOW_TABLE = /^(?:messages_fts|message_vecs)_/

/**
 * Refreshes the planner statistics (`sqlite_stat1`) where they are missing or
 * stale. `full` checks every table (recommended once per long-lived
 * connection); otherwise only tables this connection has used. SQLite picks
 * the tables (no statistics yet, or row count changed about 25x since the last
 * ANALYZE), so repeated calls are cheap.
 *
 * - Each table is analysed in full: a sampled ANALYZE (`analysis_limit`)
 *   badly misjudges low-cardinality columns such as account_id/folder_id (it
 *   assumed ~400 rows per account in a single-account mailbox).
 * - Tables without an index are skipped: their only statistic is a row count,
 *   which costs a full read (message_bodies holds every mail text) and does
 *   not change any plan, as they are only read by rowid.
 * - One transaction for all tables: one commit instead of one per table.
 *
 * Returns the analysed tables.
 */
export function optimizeDb(db: Database.Database, full: boolean): string[] {
  return metrics.time('db.optimize', () => {
    // Debug bit (0x01): list the ANALYZE statements instead of running them
    const planned = db.pragma(full ? 'optimize = 0x10003' : 'optimize = 0x03') as Array<{
      optimize: string
    }>
    const hasIndex = db.prepare(
      `SELECT 1 FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? LIMIT 1`
    )
    const tables = planned
      .map(({ optimize: statement }) => /^ANALYZE "main"\."([^"]+)"$/.exec(statement)?.[1])
      .filter((table): table is string => !!table && !SHADOW_TABLE.test(table))
      .filter((table) => hasIndex.get(table) !== undefined)
    if (tables.length === 0) return []
    db.pragma('analysis_limit = 0')
    db.transaction(() => {
      for (const table of tables) db.exec(`ANALYZE "main"."${table}"`)
    })()
    return tables
  })
}

let startupTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null

/** Runs a full optimize shortly after startup and a cheap one periodically. */
export function startDbMaintenance(db: Database.Database): void {
  stopDbMaintenance()
  const run = (full: boolean): void => {
    try {
      optimizeDb(db, full)
    } catch (error) {
      console.warn('[db] optimize failed:', error)
    }
  }
  startupTimer = setTimeout(() => {
    startupTimer = null
    run(true)
  }, STARTUP_OPTIMIZE_DELAY_MS)
  startupTimer.unref?.()
  intervalTimer = setInterval(() => run(false), OPTIMIZE_INTERVAL_MS)
  intervalTimer.unref?.()
}

export function stopDbMaintenance(): void {
  if (startupTimer) clearTimeout(startupTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  startupTimer = null
  intervalTimer = null
}
