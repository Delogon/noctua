import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { getSetting } from '../db'
import { syncEngine } from '../sync/engine'
import { budgetBlocks, resolveDecision, resolveTask } from './providers/registry'
import { decide, noulOf, type Questions } from './providers/systemone'
import { FOLLOWUP_EXPECTS_REPLY_THRESHOLD } from '@shared/decision-thresholds'
import {
  UNTRUSTED_SYSTEM_NOTE,
  sanitizeUntrusted,
  sanitizeUntrustedLine,
  wrapUntrusted
} from './untrusted'
import { htmlToText } from '../mail/parser'
import {
  isForwardWithoutRequest,
  isForwardedSubject,
  textBeforeForwardedMessage
} from '../mail/forwarded'
import { logUsage } from './budget'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const SCAN_INTERVAL_MS = 30 * 60_000
const MAX_AGE_DAYS = 21
const CHECK_BATCH = 10

/** Follow-up per Entscheidungsmodell: erwartet die GESENDETE Mail eine Antwort? */
export const EXPECTS_REPLY_QUESTIONS: Questions = {
  expects_reply: {
    type: 'noul',
    instructions:
      'Der Nutzer hat diese E-Mail GESENDET. Erwartet er darauf realistisch eine Antwort (Frage gestellt, Bitte geäußert, Angebot gemacht)? Reine Danksagungen, Bestätigungen und Informationen erwarten keine Antwort.',
    criteria: { false: 'Keine Antwort erwartet', true: 'Der Nutzer erwartet eine Antwort' }
  }
}

const verdictSchema = z.object({ expects_reply: z.boolean() })

interface CandidateRow {
  id: number
  thread_key: string
  account_id: number
  subject: string | null
  date: number
  to_json: string | null
  text_plain: string | null
  html_raw: string | null
  body_state: string
}

function waitDays(): number {
  return Number(getSetting('followup.waitDays') ?? '3')
}

/**
 * Follow-up-Radar: findet gesendete Mails, auf die seit X Tagen keine Antwort
 * kam. Ein einmaliger AI-Check filtert Mails, die gar keine Antwort erwarten
 * (Bestellbestätigungs-Antworten, "Danke!"-Mails). Nachfassen bleibt manuell.
 */
export class FollowupRadar {
  private db: Database.Database | null = null
  private push: PushFn = () => {}
  private timer: NodeJS.Timeout | null = null
  private scanning = false

  init(db: Database.Database, push: PushFn): void {
    this.db = db
    this.push = push
    if (this.dismissForwardsWithoutRequest()) this.push('followups:changed', {})
  }

  start(): void {
    setTimeout(() => void this.scan(), 20_000)
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async scan(): Promise<void> {
    if (this.scanning || !this.db) return
    this.scanning = true
    try {
      const changedIgnored = this.dismissForwardsWithoutRequest()
      const changedResolve = this.resolveAnswered()
      const changedNew = await this.discoverCandidates()
      if (changedIgnored || changedResolve || changedNew) this.push('followups:changed', {})
    } catch (error) {
      console.warn('[followups]', error)
    } finally {
      this.scanning = false
    }
  }

  /** Bereits erzeugte Stupse aus Weiterleitungen ohne Auftrag sofort ausblenden. */
  private dismissForwardsWithoutRequest(): boolean {
    if (!this.db) return false
    const rows = this.db
      .prepare(
        `SELECT fu.message_id, m.subject, m.body_state, b.text_plain, b.html_raw
         FROM followups fu JOIN messages m ON m.id = fu.message_id
         LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE fu.state = 'waiting' AND fu.expects_reply = 1`
      )
      .all() as Array<{
      message_id: number
      subject: string | null
      body_state: string
      text_plain: string | null
      html_raw: string | null
    }>
    const dismiss = this.db.prepare(
      `UPDATE followups
       SET state = 'dismissed', expects_reply = 0, nudge_draft = NULL
       WHERE message_id = ? AND state = 'waiting'`
    )
    let changed = false
    for (const row of rows) {
      if (!isForwardedSubject(row.subject)) continue
      const text = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
      if (!text && row.body_state === 'none') continue
      if (isForwardWithoutRequest(row.subject, text)) {
        changed = dismiss.run(row.message_id).changes > 0 || changed
      }
    }
    return changed
  }

  /** waiting-Einträge auflösen, wenn inzwischen eine fremde Antwort da ist. */
  private resolveAnswered(): boolean {
    const result = this.db!.prepare(
      `UPDATE followups SET state = 'resolved', resolved_at = ?
       WHERE state = 'waiting' AND EXISTS (
         SELECT 1 FROM messages r
         JOIN messages sent ON sent.id = followups.message_id
         JOIN accounts a ON a.id = sent.account_id
         WHERE r.thread_key = followups.thread_key
           AND r.date > sent.date
           AND lower(coalesce(r.from_addr, '')) != lower(a.email)
       )`
    ).run(Date.now())
    return result.changes > 0
  }

  private async discoverCandidates(): Promise<boolean> {
    const db = this.db!
    const now = Date.now()
    const cutoff = now - waitDays() * 24 * 3600 * 1000
    const maxAge = now - MAX_AGE_DAYS * 24 * 3600 * 1000

    const candidates = db
      .prepare(
        `SELECT m.id, m.thread_key, m.account_id, m.subject, m.date, m.to_json,
                b.text_plain, b.html_raw, m.body_state
         FROM messages m
         JOIN folders f ON f.id = m.folder_id
         JOIN accounts a ON a.id = m.account_id
         LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE f.special_use = '\\Sent'
           AND m.date BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM followups fu WHERE fu.message_id = m.id)
           AND NOT EXISTS (
             SELECT 1 FROM messages r WHERE r.thread_key = m.thread_key
               AND r.date > m.date AND lower(coalesce(r.from_addr, '')) != lower(a.email)
           )
         ORDER BY m.date DESC LIMIT ?`
      )
      .all(maxAge, cutoff, CHECK_BATCH) as CandidateRow[]

    let changed = false
    for (const candidate of candidates) {
      // Reine Selbst-Mails (Tests, Notizen an sich selbst) überspringen
      const ownEmail = (
        db.prepare('SELECT email FROM accounts WHERE id = ?').get(candidate.account_id) as {
          email: string
        }
      ).email.toLowerCase()
      let recipients: string[] = []
      try {
        recipients = (JSON.parse(candidate.to_json ?? '[]') as Array<{ address?: string }>)
          .map((r) => r.address?.toLowerCase() ?? '')
          .filter(Boolean)
      } catch {
        // leer lassen
      }
      const foreign = recipients.filter((r) => r !== ownEmail)
      if (foreign.length === 0) {
        db.prepare(
          `INSERT OR IGNORE INTO followups (message_id, thread_key, state, expects_reply, checked_at)
           VALUES (?, ?, 'dismissed', 0, ?)`
        ).run(candidate.id, candidate.thread_key, now)
        continue
      }

      const expects = await this.checkExpectsReply(candidate)
      db.prepare(
        `INSERT OR IGNORE INTO followups (message_id, thread_key, state, expects_reply, checked_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        candidate.id,
        candidate.thread_key,
        expects ? 'waiting' : 'dismissed',
        expects ? 1 : 0,
        now
      )
      if (expects) changed = true
    }
    return changed
  }

  /** Einmaliger, günstiger AI-Check: erwartet diese gesendete Mail eine Antwort? */
  private async checkExpectsReply(candidate: CandidateRow): Promise<boolean> {
    if (candidate.body_state === 'none') {
      await syncEngine.fetchBody(candidate.id)
      const body = this.db!.prepare(
        'SELECT text_plain, html_raw FROM message_bodies WHERE message_id = ?'
      ).get(candidate.id) as { text_plain: string | null; html_raw: string | null } | undefined
      candidate.text_plain = body?.text_plain ?? null
      candidate.html_raw = body?.html_raw ?? null
    }
    const fullText = candidate.text_plain?.trim() || htmlToText(candidate.html_raw ?? '')
    if (isForwardWithoutRequest(candidate.subject, fullText)) return false
    const text = textBeforeForwardedMessage(candidate.subject, fullText).slice(0, 2500)
    if (!text) return true

    // Entscheidungsmodell: eine Ja/Nein-Wahrscheinlichkeit statt Textgenerierung
    const decision = resolveDecision()
    if (decision) {
      try {
        const result = await decide({
          baseUrl: decision.profile.baseUrl,
          apiKey: decision.apiKey,
          model: decision.model,
          state: `${UNTRUSTED_SYSTEM_NOTE}\n\nBetreff: ${sanitizeUntrustedLine(candidate.subject, 300)}\n\n${wrapUntrusted('MAIL', sanitizeUntrusted(text, 2500))}`,
          questions: EXPECTS_REPLY_QUESTIONS
        })
        logUsage(this.db!, decision.model, result.usage.inputTokens, result.usage.outputTokens, 0)
        return noulOf(result.answers, 'expects_reply') >= FOLLOWUP_EXPECTS_REPLY_THRESHOLD
      } catch {
        return true // im Zweifel anzeigen
      }
    }

    const resolved = resolveTask('triage')
    if (!resolved || budgetBlocks(this.db!, resolved)) return true // konservativ: anzeigen

    const { client, model } = resolved
    try {
      const result = await client.complete({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Der Nutzer hat diese E-Mail GESENDET. Beurteile, ob er darauf realistisch eine Antwort erwartet (Frage gestellt, Bitte geäußert, Angebot gemacht). Antworte NUR mit JSON: {"expects_reply": true|false}'
          },
          { role: 'user', content: `Betreff: ${candidate.subject ?? ''}\n\n${text}` }
        ],
        json: true,
        temperature: 0,
        maxTokens: 50
      })
      const { inputTokens, outputTokens, costUsd } = result.usage
      logUsage(this.db!, model, inputTokens, outputTokens, costUsd)
      return verdictSchema.parse(JSON.parse(result.text)).expects_reply
    } catch {
      return true // im Zweifel anzeigen
    }
  }

  list(): Array<{
    messageId: number
    threadKey: string
    accountId: number
    subject: string | null
    toAddrs: string[]
    sentAt: number
    daysWaiting: number
    nudgeDraft: string | null
    nudgedAt: number | null
  }> {
    const rows = this.db!.prepare(
      `SELECT fu.message_id, fu.thread_key, fu.nudge_draft, fu.nudged_at, m.account_id, m.subject,
                m.to_json, m.date, m.body_state, b.text_plain, b.html_raw
         FROM followups fu JOIN messages m ON m.id = fu.message_id
         LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE fu.state = 'waiting' AND fu.expects_reply = 1
         ORDER BY m.date ASC`
    ).all() as Array<{
      message_id: number
      thread_key: string
      account_id: number
      nudge_draft: string | null
      nudged_at: number | null
      subject: string | null
      to_json: string | null
      date: number
      body_state: string
      text_plain: string | null
      html_raw: string | null
    }>
    const now = Date.now()
    return rows
      .filter((r) => {
        const text = r.text_plain?.trim() || htmlToText(r.html_raw ?? '')
        return !(text || r.body_state !== 'none') || !isForwardWithoutRequest(r.subject, text)
      })
      .map((r) => {
        let toAddrs: string[] = []
        try {
          toAddrs = (JSON.parse(r.to_json ?? '[]') as Array<{ address?: string }>)
            .map((x) => x.address ?? '')
            .filter(Boolean)
        } catch {
          // leer
        }
        return {
          messageId: r.message_id,
          threadKey: r.thread_key,
          accountId: r.account_id,
          subject: r.subject,
          toAddrs,
          sentAt: r.date,
          daysWaiting: Math.floor((now - r.date) / (24 * 3600 * 1000)),
          nudgeDraft: r.nudge_draft,
          nudgedAt: r.nudged_at
        }
      })
  }

  markNudged(messageId: number): void {
    this.db!.prepare('UPDATE followups SET nudged_at = ? WHERE message_id = ?').run(
      Date.now(),
      messageId
    )
    this.push('followups:changed', {})
  }

  dismiss(messageId: number): void {
    this.db!.prepare(`UPDATE followups SET state = 'dismissed' WHERE message_id = ?`).run(messageId)
    this.push('followups:changed', {})
  }
}

export const followupRadar = new FollowupRadar()
