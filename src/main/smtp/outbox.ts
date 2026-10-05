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
}

export function undoSeconds(): number {
  const n = Number(getSetting('compose.undoSeconds') ?? '30')
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 120) : 30
}

/**
 * Undo Send: compose:send legt hier ab, der Worker versendet nach Ablauf der
 * Rückgängig-Frist. Cancel gibt den Entwurf zurück in den Composer.
 */
class OutboxWorker {
  private db: Database.Database | null = null
  private push: PushFn = () => {}
  private timer: NodeJS.Timeout | null = null

  init(db: Database.Database, push: PushFn): void {
    this.db = db
    this.push = push
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  enqueue(accountId: number, payload: OutboxPayload): { outboxId: number; sendAt: number } {
    const sendAt = Date.now() + undoSeconds() * 1000
    const result = this.db!
      .prepare(
        `INSERT INTO outbox (account_id, payload_json, send_at, state, created_at)
         VALUES (?, ?, ?, 'pending', ?)`
      )
      .run(accountId, JSON.stringify(payload), sendAt, Date.now())
    const outboxId = Number(result.lastInsertRowid)
    this.push('outbox:changed', { outboxId, state: 'pending' })
    return { outboxId, sendAt }
  }

  /** Bricht einen wartenden Versand ab; gibt den Entwurf zurück (Composer reopen). */
  cancel(outboxId: number): {
    ok: boolean
    accountId: number | null
    draft: (OutboxPayload & { bcc: string[] }) | null
  } {
    const row = this.db!
      .prepare(`SELECT account_id, payload_json, state FROM outbox WHERE id = ?`)
      .get(outboxId) as { account_id: number; payload_json: string; state: string } | undefined
    if (!row || row.state !== 'pending') return { ok: false, accountId: null, draft: null }
    this.db!.prepare(`UPDATE outbox SET state = 'canceled' WHERE id = ? AND state = 'pending'`).run(
      outboxId
    )
    this.push('outbox:changed', { outboxId, state: 'canceled' })
    const draft = JSON.parse(row.payload_json) as Omit<OutboxPayload, 'bcc'> & { bcc?: string[] }
    return { ok: true, accountId: row.account_id, draft: { ...draft, bcc: draft.bcc ?? [] } }
  }

  private async tick(): Promise<void> {
    const due = this.db!
      .prepare(
        `SELECT id, account_id, payload_json FROM outbox
         WHERE state = 'pending' AND send_at <= ? ORDER BY id LIMIT 5`
      )
      .all(Date.now()) as Array<{ id: number; account_id: number; payload_json: string }>

    for (const row of due) {
      // Claim gegen Doppel-Versand (idempotent bei parallelem Tick)
      const claimed = this.db!
        .prepare(`UPDATE outbox SET state = 'sending' WHERE id = ? AND state = 'pending'`)
        .run(row.id)
      if (claimed.changes === 0) continue
      // Auch 'sending' pushen — das Gesendet-Echo im Renderer kennt den
      // Zustand, bekam ihn bisher aber nie zu sehen (QA-Befund).
      this.push('outbox:changed', { outboxId: row.id, state: 'sending' })

      const payload = JSON.parse(row.payload_json) as Omit<OutboxPayload, 'bcc'> & { bcc?: string[] }
      const mail: OutgoingMail = { accountId: row.account_id, ...payload, bcc: payload.bcc ?? [] }
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
        this.db!
          .prepare(`UPDATE outbox SET state = 'error', last_error = ? WHERE id = ?`)
          .run(message, row.id)
        this.push('outbox:changed', { outboxId: row.id, state: 'error' })
        console.warn(`[outbox] Versand fehlgeschlagen (#${row.id}): ${message}`)
      }
    }
  }
}

export const outboxWorker = new OutboxWorker()
