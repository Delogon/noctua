import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { getSetting } from '../db'
import { sendMail, type OutgoingMail } from './sender'
import { syncEngine } from '../sync/engine'
import { recordSentContacts } from '../db/repos/contacts'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

export interface OutboxPayload {
  to: string[]
  cc: string[]
  bcc?: string[]
  subject: string
  textBody: string
  htmlBody?: string
  replyToMessageId?: number
  /** Calendar invitation/response (iMIP, RFC 6047): sent as a text/calendar alternative. */
  icalEvent?: { method: string; content: string }
}

/** Maximum send attempts (incl. the first) on transient errors. */
export const MAX_SEND_ATTEMPTS = 5
const RETRY_BASE_MS = 30_000

/** Backoff before the next attempt: 30 s, 60 s, 120 s, 240 s. */
export function retryDelayMs(attempts: number): number {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1)
}

export type SendFailureKind = 'retry' | 'permanent' | 'unknown'

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ETIMEOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ESOCKET',
  'ECONNECTION',
  'EPIPE'
])

/**
 * Classifies a send error: 'retry' (transient, mail certainly not
 * delivered), 'permanent' (5xx, auth, configuration) or 'unknown'
 * (connection dropped during data transfer — possibly arrived,
 * so never resend automatically).
 */
export function classifySendError(error: unknown): SendFailureKind {
  const err = error as { code?: unknown; responseCode?: unknown; command?: unknown } | null
  const responseCode = typeof err?.responseCode === 'number' ? err.responseCode : null
  if (responseCode !== null) {
    if (responseCode >= 400 && responseCode < 500) return 'retry'
    return 'permanent'
  }
  const code = typeof err?.code === 'string' ? err.code : ''
  if (code === 'EAUTH' || code === 'EENVELOPE') return 'permanent'
  if (TRANSIENT_CODES.has(code)) {
    // Aborted after data transfer began: outcome uncertain
    return err?.command === 'DATA' ? 'unknown' : 'retry'
  }
  return 'permanent'
}

export function undoSeconds(): number {
  const n = Number(getSetting('compose.undoSeconds') ?? '30')
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : 30
}

/**
 * Undo Send: compose:send stores here, the worker sends once the
 * undo period expires. Cancel returns the draft to the composer.
 */
class OutboxWorker {
  private db: Database.Database | null = null
  private push: PushFn = () => {}
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  init(db: Database.Database, push: PushFn): void {
    this.db = db
    this.push = push
  }

  start(): void {
    // Restart/crash: nothing stays stuck in 'sending'
    try {
      this.recoverInterrupted()
    } catch (error) {
      console.warn(
        `[outbox] Wiederherstellung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.timer = setInterval(() => void this.tick(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Rows that were still 'sending' at shutdown (or are already 'unknown')
   * may have been delivered. If the Message-ID is in the local Sent folder →
   * 'sent'. Otherwise 'unknown' — the user decides, we never blindly resend.
   */
  recoverInterrupted(): void {
    const rows = this.db!.prepare(
      `SELECT id, account_id, message_id, state FROM outbox WHERE state IN ('sending', 'unknown')`
    ).all() as Array<{ id: number; account_id: number; message_id: string | null; state: string }>
    for (const row of rows) {
      if (row.message_id && this.isInSentFolder(row.account_id, row.message_id)) {
        this.db!.prepare(`UPDATE outbox SET state = 'sent' WHERE id = ?`).run(row.id)
        this.push('outbox:changed', { outboxId: row.id, state: 'sent' })
      } else if (row.state === 'sending') {
        this.db!.prepare(`UPDATE outbox SET state = 'unknown', last_error = ? WHERE id = ?`).run(
          'Versand unterbrochen — Ausgang ungewiss',
          row.id
        )
        this.push('outbox:changed', { outboxId: row.id, state: 'unknown' })
      } else {
        this.push('outbox:changed', { outboxId: row.id, state: 'unknown' })
      }
    }
  }

  private isInSentFolder(accountId: number, messageId: string): boolean {
    const bare = messageId.replace(/^<|>$/g, '')
    const row = this.db!.prepare(
      `SELECT 1 FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE m.account_id = ? AND f.special_use = '\\Sent' AND m.message_id IN (?, ?) LIMIT 1`
    ).get(accountId, bare, `<${bare}>`)
    return row !== undefined
  }

  enqueue(
    accountId: number,
    payload: OutboxPayload,
    opts: { immediate?: boolean } = {}
  ): { outboxId: number; sendAt: number } {
    // System messages (iMIP responses) need no undo window
    const sendAt = Date.now() + (opts.immediate ? 0 : undoSeconds() * 1000)
    // Stable Message-ID already at enqueue: survives restarts and makes
    // the mail recognizable in the Sent folder.
    const account = this.db!.prepare('SELECT email FROM accounts WHERE id = ?').get(accountId) as
      { email: string } | undefined
    const domain = account?.email.split('@')[1] || 'noctua.local'
    const messageId = `<${randomUUID()}@${domain}>`
    const result = this.db!.prepare(
      `INSERT INTO outbox (account_id, payload_json, send_at, state, created_at, message_id)
         VALUES (?, ?, ?, 'pending', ?, ?)`
    ).run(accountId, JSON.stringify(payload), sendAt, Date.now(), messageId)
    const outboxId = Number(result.lastInsertRowid)
    this.push('outbox:changed', { outboxId, state: 'pending' })
    return { outboxId, sendAt }
  }

  /** Cancels a pending send; returns the draft (composer reopen). */
  cancel(outboxId: number): {
    ok: boolean
    accountId: number | null
    draft: (OutboxPayload & { bcc: string[] }) | null
  } {
    const row = this.db!.prepare(
      `SELECT account_id, payload_json, state FROM outbox WHERE id = ?`
    ).get(outboxId) as { account_id: number; payload_json: string; state: string } | undefined
    if (!row || row.state !== 'pending') return { ok: false, accountId: null, draft: null }
    this.db!.prepare(`UPDATE outbox SET state = 'canceled' WHERE id = ? AND state = 'pending'`).run(
      outboxId
    )
    this.push('outbox:changed', { outboxId, state: 'canceled' })
    const draft = JSON.parse(row.payload_json) as Omit<OutboxPayload, 'bcc'> & { bcc?: string[] }
    return { ok: true, accountId: row.account_id, draft: { ...draft, bcc: draft.bcc ?? [] } }
  }

  private async tick(): Promise<void> {
    // No overlapping run: otherwise a slow SMTP send would be triggered
    // again by the next one-second tick.
    if (this.ticking) return
    this.ticking = true
    try {
      await this.processDue()
    } finally {
      this.ticking = false
    }
  }

  private async processDue(): Promise<void> {
    const due = this.db!.prepare(
      `SELECT id, account_id, payload_json, message_id, attempts FROM outbox
         WHERE state = 'pending' AND send_at <= ? ORDER BY id LIMIT 5`
    ).all(Date.now()) as Array<{
      id: number
      account_id: number
      payload_json: string
      message_id: string | null
      attempts: number
    }>

    for (const row of due) {
      // Claim against double sending (idempotent with a parallel tick)
      const claimed = this.db!.prepare(
        `UPDATE outbox SET state = 'sending', attempts = attempts + 1 WHERE id = ? AND state = 'pending'`
      ).run(row.id)
      if (claimed.changes === 0) continue
      const attempts = row.attempts + 1
      // Push 'sending' too — the sent echo in the renderer knows the
      // state but never got to see it so far (QA finding).
      this.push('outbox:changed', { outboxId: row.id, state: 'sending' })

      const payload = JSON.parse(row.payload_json) as Omit<OutboxPayload, 'bcc'> & {
        bcc?: string[]
      }
      const mail: OutgoingMail = {
        accountId: row.account_id,
        ...payload,
        bcc: payload.bcc ?? [],
        ...(row.message_id ? { messageId: row.message_id } : {})
      }
      try {
        await sendMail(this.db!, mail)
        this.db!.prepare(`UPDATE outbox SET state = 'sent' WHERE id = ?`).run(row.id)
        try {
          recordSentContacts(this.db!, row.account_id, [
            ...mail.to,
            ...mail.cc,
            ...(mail.bcc ?? [])
          ])
        } catch (error) {
          console.warn(
            `[contacts] Gesendete Empfaenger konnten nicht lokal gespeichert werden: ${error instanceof Error ? error.message : String(error)}`
          )
        }
        this.push('outbox:changed', { outboxId: row.id, state: 'sent' })
        syncEngine.resyncSent(row.account_id)
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 400) : String(error)
        const kind = classifySendError(error)
        if (kind === 'retry' && attempts < MAX_SEND_ATTEMPTS) {
          // Transient error: back to pending with backoff, same Message-ID
          this.db!.prepare(
            `UPDATE outbox SET state = 'pending', send_at = ?, last_error = ? WHERE id = ?`
          ).run(Date.now() + retryDelayMs(attempts), message, row.id)
          this.push('outbox:changed', { outboxId: row.id, state: 'pending' })
          console.warn(
            `[outbox] Versand #${row.id} Versuch ${attempts} fehlgeschlagen, neuer Versuch folgt: ${message}`
          )
          continue
        }
        const state = kind === 'unknown' ? 'unknown' : 'error'
        this.db!.prepare(`UPDATE outbox SET state = ?, last_error = ? WHERE id = ?`).run(
          state,
          message,
          row.id
        )
        this.push('outbox:changed', { outboxId: row.id, state })
        console.warn(`[outbox] Versand fehlgeschlagen (#${row.id}): ${message}`)
      }
    }
  }
}

export const outboxWorker = new OutboxWorker()
