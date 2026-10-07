import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { triageBudgetBlocked } from './providers/registry'
import { runTriage, PROMPT_VERSION } from './triage'
import { EVENT_CATEGORIES, runEventExtraction } from './events'
import { applyRulesPostTriage } from './rules'
import { maybeNotify, updateBadge } from '../notifications'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const MAX_ATTEMPTS = 5
const CONCURRENCY = 2
const POLL_INTERVAL_MS = 20_000
const TRIAGE_WINDOW_DAYS = 30
// Transiente Fehler (429/5xx/Netz) verbrennen keine Versuche; nach so vielen
// in Folge pausiert die ganze Queue (Circuit Breaker) statt Jobs zu verbrauchen.
const BREAKER_THRESHOLD = 5
const BREAKER_PAUSE_MS = 5 * 60_000
const TRANSIENT_BACKOFF_BASE_MS = 30_000
const TRANSIENT_BACKOFF_MAX_MS = 10 * 60_000
const PROMPT_VERSION_SETTING = 'ai.queuePromptVersion'
// Termin-Extraktion (Job 'events'): nur Mails, die NACH diesem Zeitpunkt ankamen — beim ersten
// Lauf mit Kalender-Konto gesetzt, damit nie das 30-Tage-Fenster rückwirkend bezahlt wird.
const EVENTS_SINCE_SETTING = 'ai.eventsSince'

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
 * Transient = Wiederholen lohnt sich, der Job selbst ist nicht schuld:
 * HTTP 408/429/5xx und Netzwerkfehler. Alles andere ist ein permanenter Fehler.
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
 * AI-Job-Queue: entdeckt triage-fähige Nachrichten (idempotent über
 * UNIQUE(message_id, kind) — nie doppelt scannen) und arbeitet sie mit
 * begrenzter Parallelität ab. Hartes Budget-Gate vor jedem Request.
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
   * Ein Absturz mitten im Request lässt Jobs auf 'running' zurück, die nie
   * wieder angefasst würden — beim Start zurück auf 'pending'.
   */
  recoverRunning(): number {
    if (!this.db) return 0
    return this.db.prepare(`UPDATE ai_jobs SET status = 'pending' WHERE status = 'running'`).run()
      .changes
  }

  /** Permanent gescheiterte Jobs (z. B. nach Prompt-/Modellwechsel) erneut versuchen. */
  requeueFailed(): number {
    if (!this.db) return 0
    return this.db
      .prepare(
        `UPDATE ai_jobs SET status = 'pending', attempts = 0, next_attempt_at = NULL
         WHERE status = 'error'`
      )
      .run().changes
  }

  /** Neue PROMPT_VERSION = neue Chance für Jobs, die am alten Prompt gescheitert sind. */
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

  /** Discovery + Drain anstoßen (nach Ingest, Body-Store, App-Start). */
  kick(): void {
    if (!this.db) return
    this.discover()
    void this.drain()
  }

  private discover(): void {
    this.discoverEvents()
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

  /**
   * Termin-Jobs nur für NEUE Mails (Ankunft nach ai.eventsSince), nur mit Kalender-Konto,
   * nur für bereits getriagte Mails der Kategorien personal/work/other und ohne
   * Einladungs-Teil (die hat die Einladungskarte). UNIQUE(message_id, kind) macht es idempotent.
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
        // Renderer lädt die Mail-Ansicht (Terminvorschläge) neu
        if (outcome === 'done') this.push('ai:annotated', { messageIds: [job.message_id] })
        return
      }
      const outcome = await runTriage(db, job.message_id)
      if (outcome === 'skipped-no-client') {
        // Kein API-Key hinterlegt — Job zurücklegen, ohne attempts zu verbrennen.
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
        maybeNotify(job.message_id)
        updateBadge()
      } catch (error) {
        console.warn('[ai] post-triage hooks:', error)
      }
      this.push('ai:annotated', { messageIds: [job.message_id] })
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error)
      const { transient, retryAfterMs } = classifyAiError(error)
      if (transient) {
        // Rate-Limit/Ausfall/Netz: Job zurücklegen ohne attempts zu verbrennen,
        // Retry-After des Servers respektieren, bei Serie die Queue pausieren.
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
