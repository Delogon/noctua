import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { triageBudgetBlocked } from './providers/registry'
import { runTriage, PROMPT_VERSION } from './triage'
import { EVENT_CATEGORIES, runEventExtraction } from './events'
import { applyRulesPostTriage } from './rules'
import { maybeAutoJunk } from './threat-check'
import { maybeNotify, updateBadge } from '../notifications'
import { metrics } from '../diagnostics/metrics'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const MAX_ATTEMPTS = 5
const CONCURRENCY = 2
const POLL_INTERVAL_MS = 20_000
const TRIAGE_WINDOW_DAYS = 30
// Transient errors (429/5xx/network) don't burn attempts; after this many
// in a row the whole queue pauses (circuit breaker) instead of consuming jobs.
const BREAKER_THRESHOLD = 5
const BREAKER_PAUSE_MS = 5 * 60_000
const TRANSIENT_BACKOFF_BASE_MS = 30_000
const TRANSIENT_BACKOFF_MAX_MS = 10 * 60_000
const PROMPT_VERSION_SETTING = 'ai.queuePromptVersion'
// Appointment extraction (job 'events'): only mails that arrived AFTER this time — set on the
// first run with a calendar account so the 30-day window is never paid for retroactively.
const EVENTS_SINCE_SETTING = 'ai.eventsSince'

/**
 * Enqueue triage candidates (parameters: since, PROMPT_VERSION). Exported
 * so the diagnostic benchmark measures the same query.
 */
export const TRIAGE_DISCOVERY_SQL = `INSERT OR IGNORE INTO ai_jobs (message_id, kind, status)
  SELECT m.id, 'triage', 'pending'
  FROM messages m
  JOIN folders f ON f.id = m.folder_id
  JOIN accounts a ON a.id = m.account_id
  WHERE f.special_use = '\\Inbox'
    AND m.body_state = 'full'
    AND a.ai_enabled = 1
    AND coalesce(m.date, m.internal_date, 0) >= ?
    AND NOT EXISTS (
      SELECT 1 FROM ai_annotations an
      WHERE an.message_id = m.id AND an.prompt_version = ?
    )`
export const TRIAGE_WINDOW_MS = TRIAGE_WINDOW_DAYS * 24 * 3600 * 1000

const TRANSIENT_NET_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
])
const TRANSIENT_MESSAGE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|connection error|timed? ?out/i

function readRetryAfterMs(headers: unknown): number | null {
  if (!headers || typeof headers !== 'object') return null
  const h = headers as { get?: (name: string) => string | null } & Record<string, unknown>
  const raw = typeof h.get === 'function' ? h.get('retry-after') : h['retry-after']
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60 * 60_000)
  const date = Date.parse(String(raw))
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

/**
 * Transient = retrying is worthwhile, the job itself is not at fault:
 * HTTP 408/429/5xx and network errors. Everything else is a permanent error.
 */
export function classifyAiError(error: unknown): {
  transient: boolean
  retryAfterMs: number | null
} {
  const e = error as {
    status?: unknown
    code?: unknown
    name?: unknown
    message?: unknown
    headers?: unknown
    cause?: { code?: unknown; message?: unknown }
  } | null
  const status = typeof e?.status === 'number' ? e.status : null
  if (status !== null) {
    const transient = status === 408 || status === 429 || status >= 500
    return { transient, retryAfterMs: transient ? readRetryAfterMs(e?.headers) : null }
  }
  const code = String(e?.code ?? e?.cause?.code ?? '')
  const message = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`
  const name = String(e?.name ?? '')
  const transient =
    TRANSIENT_NET_CODES.has(code) ||
    name === 'APIConnectionError' ||
    name === 'APIConnectionTimeoutError' ||
    TRANSIENT_MESSAGE.test(message)
  return { transient, retryAfterMs: null }
}

/**
 * AI job queue: discovers triage-eligible messages (idempotent via
 * UNIQUE(message_id, kind) — never scan twice) and processes them with
 * limited parallelism. Hard budget gate before every request.
 */
export class AiQueue {
  private db: Database.Database | null = null
  private push: PushFn = () => {}
  private running = 0
  private draining = false
  private timer: NodeJS.Timeout | null = null
  private consecutiveTransient = 0
  private pausedUntil = 0

  init(db: Database.Database, push: PushFn): void {
    this.db = db
    this.push = push
  }

  start(): void {
    this.recoverRunning()
    this.requeueOnPromptChange()
    this.kick()
    this.timer = setInterval(() => this.kick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * A crash mid-request leaves jobs in 'running' that would never
   * be touched again — reset to 'pending' on startup.
   */
  recoverRunning(): number {
    if (!this.db) return 0
    return this.db.prepare(`UPDATE ai_jobs SET status = 'pending' WHERE status = 'running'`).run()
      .changes
  }

  /** Retry permanently failed jobs (e.g. after a prompt/model change). */
  requeueFailed(): number {
    if (!this.db) return 0
    return this.db
      .prepare(
        `UPDATE ai_jobs SET status = 'pending', attempts = 0, next_attempt_at = NULL
         WHERE status = 'error'`
      )
      .run().changes
  }

  /** New PROMPT_VERSION = new chance for jobs that failed on the old prompt. */
  private requeueOnPromptChange(): void {
    const db = this.db!
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(PROMPT_VERSION_SETTING) as { value: string } | undefined
    if (row?.value === String(PROMPT_VERSION)) return
    if (row) this.requeueFailed()
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(PROMPT_VERSION_SETTING, String(PROMPT_VERSION))
  }

  /** Kick off discovery + drain (after ingest, body store, app start). */
  kick(): void {
    if (!this.db) return
    this.discover()
    void this.drain()
  }

  private discover(): void {
    metrics.time('ai.queue.discover', () => {
      this.discoverEvents()
      const since = Date.now() - TRIAGE_WINDOW_MS
      this.db!.prepare(TRIAGE_DISCOVERY_SQL).run(since, PROMPT_VERSION)
    })
  }

  /**
   * Appointment jobs only for NEW mails (arrival after ai.eventsSince), only with a calendar
   * account, only for already triaged mails of the categories personal/work/other and without
   * an invitation part (the invitation card covers those). UNIQUE(message_id, kind) makes it idempotent.
   */
  private discoverEvents(): void {
    const db = this.db!
    if (!db.prepare('SELECT 1 FROM cal_accounts LIMIT 1').get()) return
    let since = Number(
      (
        db.prepare('SELECT value FROM settings WHERE key = ?').get(EVENTS_SINCE_SETTING) as
          { value: string } | undefined
      )?.value
    )
    if (!Number.isFinite(since) || since <= 0) {
      since = Date.now()
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(EVENTS_SINCE_SETTING, String(since))
    }
    const categories = EVENT_CATEGORIES.map((c) => `'${c}'`).join(',')
    db.prepare(
      `INSERT OR IGNORE INTO ai_jobs (message_id, kind, status)
       SELECT m.id, 'events', 'pending'
       FROM messages m
       JOIN folders f ON f.id = m.folder_id
       JOIN accounts a ON a.id = m.account_id
       JOIN ai_annotations an ON an.message_id = m.id
       WHERE f.special_use = '\\Inbox'
         AND m.body_state = 'full'
         AND a.ai_enabled = 1
         AND coalesce(m.internal_date, m.date, 0) >= ?
         AND coalesce(an.user_override_category, an.category) IN (${categories})
         AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.message_id = m.id)`
    ).run(since)
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.running < CONCURRENCY) {
        if (Date.now() < this.pausedUntil) break
        if (triageBudgetBlocked(this.db!)) break
        const job = this.db!.prepare(
          `SELECT id, message_id, attempts, kind FROM ai_jobs
             WHERE kind IN ('triage', 'events') AND status = 'pending'
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             ORDER BY (kind = 'events'), id LIMIT 1`
        ).get(Date.now()) as
          | { id: number; message_id: number; attempts: number; kind: 'triage' | 'events' }
          | undefined
        if (!job) break

        this.db!.prepare(`UPDATE ai_jobs SET status = 'running' WHERE id = ?`).run(job.id)
        this.running += 1
        void this.processJob(job).finally(() => {
          this.running -= 1
          void this.drain()
        })
      }
    } finally {
      this.draining = false
    }
  }

  private async processJob(job: {
    id: number
    message_id: number
    attempts: number
    kind?: 'triage' | 'events'
  }): Promise<void> {
    const db = this.db!
    const endJob = metrics.span(`ai.job.${job.kind ?? 'triage'}`)
    try {
      if (job.kind === 'events') {
        const outcome = await runEventExtraction(db, job.message_id)
        if (outcome === 'skipped-no-client') {
          db.prepare(`UPDATE ai_jobs SET status = 'pending', next_attempt_at = ? WHERE id = ?`).run(
            Date.now() + 5 * 60_000,
            job.id
          )
          return
        }
        this.consecutiveTransient = 0
        db.prepare(`UPDATE ai_jobs SET status = 'done', last_error = NULL WHERE id = ?`).run(job.id)
        // Renderer reloads the mail view (appointment suggestions)
        if (outcome === 'done') this.push('ai:annotated', { messageIds: [job.message_id] })
        return
      }
      const outcome = await runTriage(db, job.message_id)
      if (outcome === 'skipped-no-client') {
        // No API key stored — put the job back without burning attempts.
        db.prepare(`UPDATE ai_jobs SET status = 'pending', next_attempt_at = ? WHERE id = ?`).run(
          Date.now() + 5 * 60_000,
          job.id
        )
        return
      }
      this.consecutiveTransient = 0
      db.prepare(`UPDATE ai_jobs SET status = 'done', last_error = NULL WHERE id = ?`).run(job.id)
      try {
        await applyRulesPostTriage(db, job.message_id)
        // Filtered-out spam doesn't trigger a notification
        if (!maybeAutoJunk(db, job.message_id)) maybeNotify(job.message_id)
        updateBadge()
      } catch (error) {
        console.warn('[ai] post-triage hooks:', error)
      }
      this.push('ai:annotated', { messageIds: [job.message_id] })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error)
      const { transient, retryAfterMs } = classifyAiError(error)
      if (transient) {
        // Rate limit/outage/network: put the job back without burning attempts,
        // respect the server's Retry-After, pause the queue on a streak.
        this.consecutiveTransient += 1
        const backoff = Math.min(
          TRANSIENT_BACKOFF_MAX_MS,
          TRANSIENT_BACKOFF_BASE_MS * 2 ** Math.min(this.consecutiveTransient, 6)
        )
        const delay = Math.max(backoff, retryAfterMs ?? 0)
        db.prepare(
          `UPDATE ai_jobs SET status = 'pending', last_error = ?, next_attempt_at = ? WHERE id = ?`
        ).run(message, Date.now() + delay, job.id)
        if (this.consecutiveTransient >= BREAKER_THRESHOLD) {
          this.pausedUntil = Date.now() + BREAKER_PAUSE_MS
          this.consecutiveTransient = 0
          console.warn(`[ai] ${BREAKER_THRESHOLD} transiente Fehler in Folge — Queue pausiert`)
        }
        return
      }
      this.consecutiveTransient = 0
      const attempts = job.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        db.prepare(
          `UPDATE ai_jobs SET status = 'error', attempts = ?, last_error = ? WHERE id = ?`
        ).run(attempts, message, job.id)
        console.warn(`[ai] job ${job.id} failed permanently: ${message}`)
        metrics.count('ai.job.failedPermanently')
      } else {
        const backoff = 30_000 * 2 ** attempts
        db.prepare(
          `UPDATE ai_jobs SET status = 'pending', attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`
        ).run(attempts, message, Date.now() + backoff, job.id)
      }
    } finally {
      endJob()
    }
  }
}

export const aiQueue = new AiQueue()
