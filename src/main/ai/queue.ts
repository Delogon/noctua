import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { isBudgetExceeded } from './budget'
import { runTriage, PROMPT_VERSION } from './triage'
import { applyRules } from './rules'
import { maybeNotify, updateBadge } from '../notifications'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const MAX_ATTEMPTS = 5
const CONCURRENCY = 2
const POLL_INTERVAL_MS = 20_000
const TRIAGE_WINDOW_DAYS = 30

/**
 * AI-Job-Queue: entdeckt triage-fähige Nachrichten (idempotent über
 * UNIQUE(message_id, kind) — nie doppelt scannen) und arbeitet sie mit
 * begrenzter Parallelität ab. Hartes Budget-Gate vor jedem Request.
 */
class AiQueue {
  private db: Database.Database | null = null
  private push: PushFn = () => {}
  private running = 0
  private draining = false
  private timer: NodeJS.Timeout | null = null

  init(db: Database.Database, push: PushFn): void {
    this.db = db
    this.push = push
  }

  start(): void {
    this.kick()
    this.timer = setInterval(() => this.kick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Discovery + Drain anstoßen (nach Ingest, Body-Store, App-Start). */
  kick(): void {
    if (!this.db) return
    this.discover()
    void this.drain()
  }

  private discover(): void {
    const since = Date.now() - TRIAGE_WINDOW_DAYS * 24 * 3600 * 1000
    this.db!.prepare(
      `INSERT OR IGNORE INTO ai_jobs (message_id, kind, status)
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
    ).run(since, PROMPT_VERSION)
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.running < CONCURRENCY) {
        if (isBudgetExceeded(this.db!)) break
        const job = this.db!
          .prepare(
            `SELECT id, message_id, attempts FROM ai_jobs
             WHERE kind = 'triage' AND status = 'pending'
               AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             ORDER BY id LIMIT 1`
          )
          .get(Date.now()) as { id: number; message_id: number; attempts: number } | undefined
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
  }): Promise<void> {
    const db = this.db!
    try {
      const outcome = await runTriage(db, job.message_id)
      if (outcome === 'skipped-no-client') {
        // Kein API-Key hinterlegt — Job zurücklegen, ohne attempts zu verbrennen.
        db.prepare(
          `UPDATE ai_jobs SET status = 'pending', next_attempt_at = ? WHERE id = ?`
        ).run(Date.now() + 5 * 60_000, job.id)
        return
      }
      db.prepare(`UPDATE ai_jobs SET status = 'done', last_error = NULL WHERE id = ?`).run(job.id)
      try {
        applyRules(db, job.message_id, 'post-triage')
        maybeNotify(job.message_id)
        updateBadge()
      } catch (error) {
        console.warn('[ai] post-triage hooks:', error)
      }
      this.push('ai:annotated', { messageIds: [job.message_id] })
    } catch (error) {
      const attempts = job.attempts + 1
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error)
      if (attempts >= MAX_ATTEMPTS) {
        db.prepare(
          `UPDATE ai_jobs SET status = 'error', attempts = ?, last_error = ? WHERE id = ?`
        ).run(attempts, message, job.id)
        console.warn(`[ai] job ${job.id} failed permanently: ${message}`)
      } else {
        const backoff = 30_000 * 2 ** attempts
        db.prepare(
          `UPDATE ai_jobs SET status = 'pending', attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`
        ).run(attempts, message, Date.now() + backoff, job.id)
      }
    }
  }
}

export const aiQueue = new AiQueue()
