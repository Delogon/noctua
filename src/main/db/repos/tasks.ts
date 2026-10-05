import type Database from 'better-sqlite3-multiple-ciphers'
import type { TaskItem } from '@shared/types'
import { getSetting } from '../index'
import { htmlToText } from '../../mail/parser'
import { isForwardWithoutRequest } from '../../mail/forwarded'
import { taskAddresseeVerdict } from '../../ai/addressee'

export interface ExtractedActionItem {
  title: string
  due: string | null
}

function autoCreateEnabled(): boolean {
  return (getSetting('tasks.autoCreate') ?? '1') === '1'
}

/**
 * Login-/Security-Benachrichtigungen erzeugen nie Aufgaben (Triage v4 verbietet
 * es dem Modell; dieser Guard fängt Ausreißer und Alt-Annotationen ab).
 */
export function isSecurityNotification(subject: string | null | undefined): boolean {
  if (!subject) return false
  return /(anmeldung|login|sign.?in|verifizier|verification|passwort|password|sicherheits|security alert|2fa|einmal.?code|one.?time.?code)/i.test(
    subject
  )
}

/**
 * Eine Nachricht stammt vom Nutzer selbst, wenn sie im Gesendet-Ordner liegt
 * oder ihr Absender einer beliebigen verbundenen Adresse entspricht. Letzteres
 * deckt Kopien ab, die von Konto A an das ebenfalls verbundene Konto B gingen.
 */
export function isUserAuthoredMail(
  db: Database.Database,
  fromAddr: string | null | undefined,
  folderSpecialUse?: string | null
): boolean {
  if (folderSpecialUse === '\\Sent') return true
  if (!fromAddr) return false
  return !!db
    .prepare('SELECT 1 FROM accounts WHERE lower(email) = lower(?) LIMIT 1')
    .get(fromAddr.trim())
}

function taskCategories(): Set<string> {
  return new Set(
    (getSetting('tasks.categories') ?? 'personal,work,transactional')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

/**
 * Legt Aufgaben aus einer Triage-Annotation an. Regeln: global aktivierbar,
 * nur konfigurierte Kategorien; needs_reply erzeugt eine „Antworten"-Aufgabe.
 * Dedupe über UNIQUE(source_kind, source_id, title).
 */
export function createTasksFromTriage(
  db: Database.Database,
  params: {
    sourceKind: 'mail'
    sourceId: number
    accountId: number | null
    category: string
    needsReply: boolean
    subject: string | null
    actionItems: ExtractedActionItem[]
    accountEmail?: string | null
    ownerDisplayName?: string | null
    ownerAccountName?: string | null
    toJson?: string | null
    ccJson?: string | null
    /** Eigener Mailtext (ohne weitergeleiteten Block) für die Anrede-Analyse. */
    bodyText?: string | null
    /** addressed_to_me aus der Triage; fehlend = true (Alt-Annotationen). */
    addressedToMe?: boolean | null
    fromAddr?: string | null
    folderSpecialUse?: string | null
    forwardWithoutRequest?: boolean
  }
): number {
  if (!autoCreateEnabled()) return 0
  if (!taskCategories().has(params.category)) return 0
  if (isSecurityNotification(params.subject)) return 0
  // Adressat-Gate: nur 'create' darf automatisch anlegen; 'suggest' bleibt
  // dem Vorschlags-Streifen überlassen, 'none' unterdrückt beides.
  const verdict = taskAddresseeVerdict({
    accountEmail: params.accountEmail,
    displayName: params.ownerDisplayName,
    accountName: params.ownerAccountName,
    toJson: params.toJson,
    ccJson: params.ccJson,
    bodyText: params.bodyText,
    addressedToMe: params.addressedToMe
  })
  if (verdict !== 'create') return 0
  if (isUserAuthoredMail(db, params.fromAddr, params.folderSpecialUse)) return 0
  if (params.forwardWithoutRequest) return 0

  const insert = db.prepare(
    `INSERT OR IGNORE INTO tasks
       (source_kind, source_id, account_id, title, notes, due_date, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
  )
  let created = 0
  const now = Date.now()

  for (const item of params.actionItems.slice(0, 5)) {
    const title = item.title.trim().slice(0, 200)
    if (!title) continue
    const result = insert.run(
      params.sourceKind,
      params.sourceId,
      params.accountId,
      title,
      params.subject ? `Aus: ${params.subject}` : null,
      item.due,
      now
    )
    created += result.changes
  }

  if (params.needsReply && (getSetting('tasks.replyTasks') ?? '1') === '1') {
    const result = insert.run(
      params.sourceKind,
      params.sourceId,
      params.accountId,
      `Antworten: ${(params.subject ?? '(ohne Betreff)').slice(0, 160)}`,
      null,
      null,
      now
    )
    created += result.changes
  }
  return created
}

export function listTasks(db: Database.Database, status: 'open' | 'done'): TaskItem[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.source_kind, t.source_id, t.account_id, t.title, t.notes,
              t.due_date, t.status, t.created_at, t.source_id,
              m.thread_key, m.subject, a.color, b.text_plain, b.html_raw
       FROM tasks t
       LEFT JOIN messages m ON t.source_kind = 'mail' AND m.id = t.source_id
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN folders f ON f.id = m.folder_id
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE t.status ${status === 'open' ? "= 'open'" : "IN ('done','dismissed')"}
         AND NOT (
           t.source_kind = 'mail' AND (
             coalesce(f.special_use, '') = '\\Sent'
             OR EXISTS (SELECT 1 FROM accounts own WHERE lower(own.email) = lower(m.from_addr))
           )
         )
       ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.created_at DESC
       LIMIT 300`
    )
    .all() as Array<Record<string, unknown>>
  return rows
    .filter(
      (r) =>
        r.source_kind !== 'mail' ||
        !isForwardWithoutRequest(
          r.subject as string | null,
          (r.text_plain as string | null)?.trim() || htmlToText((r.html_raw as string | null) ?? '')
        )
    )
    .map((r) => ({
      id: r.id as number,
      sourceKind: r.source_kind as 'mail' | 'signal' | 'manual',
      threadKey: (r.thread_key as string) ?? null,
      accountColor: (r.color as string) ?? null,
      title: r.title as string,
      notes: (r.notes as string) ?? null,
      dueDate: (r.due_date as string) ?? null,
      status: r.status as 'open' | 'done' | 'dismissed',
      createdAt: r.created_at as number,
      sourceSubject: (r.subject as string) ?? null,
      sourceMessageId: r.source_kind === 'mail' ? ((r.source_id as number) ?? null) : null
    }))
}

export function updateTaskStatus(
  db: Database.Database,
  id: number,
  status: 'open' | 'done' | 'dismissed'
): void {
  db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(
    status,
    status === 'open' ? null : Date.now(),
    id
  )
}

export function countOpenTasks(db: Database.Database): number {
  const rows = db
    .prepare(
      `SELECT t.source_kind, m.subject, b.text_plain, b.html_raw FROM tasks t
         LEFT JOIN messages m ON t.source_kind = 'mail' AND m.id = t.source_id
         LEFT JOIN folders f ON f.id = m.folder_id
         LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE t.status = 'open'
           AND NOT (
             t.source_kind = 'mail' AND (
               coalesce(f.special_use, '') = '\\Sent'
               OR EXISTS (SELECT 1 FROM accounts own WHERE lower(own.email) = lower(m.from_addr))
             )
           )`
    )
    .all() as Array<{
    source_kind: string
    subject: string | null
    text_plain: string | null
    html_raw: string | null
  }>
  return rows.filter(
    (row) =>
      row.source_kind !== 'mail' ||
      !isForwardWithoutRequest(
        row.subject,
        row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
      )
  ).length
}

/** Entfernt alte automatische Aufgaben, die nur aus FYI-Weiterleitungen stammen. */
export function cleanupForwardTasksWithoutRequest(db: Database.Database): number {
  const rows = db
    .prepare(
      `SELECT DISTINCT m.id, m.subject, m.body_state, b.text_plain, b.html_raw
       FROM tasks t JOIN messages m ON t.source_kind = 'mail' AND m.id = t.source_id
       LEFT JOIN message_bodies b ON b.message_id = m.id`
    )
    .all() as Array<{
    id: number
    subject: string | null
    body_state: string
    text_plain: string | null
    html_raw: string | null
  }>
  const messageIds = rows
    .filter((row) => {
      const text = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
      if (!text && row.body_state === 'none') return false
      return isForwardWithoutRequest(row.subject, text)
    })
    .map((row) => row.id)
  if (messageIds.length === 0) return 0

  return db.transaction(() => {
    const remove = db.prepare(`DELETE FROM tasks WHERE source_kind = 'mail' AND source_id = ?`)
    const clearAnnotation = db.prepare(
      `UPDATE ai_annotations SET action_items_json = '[]', needs_reply = 0 WHERE message_id = ?`
    )
    let removed = 0
    for (const messageId of messageIds) {
      removed += remove.run(messageId).changes
      clearAnnotation.run(messageId)
    }
    return removed
  })()
}

/**
 * Entscheidet den Aufgaben-Vorschlag eines Threads (Letterpress t/x):
 * accept legt den Task an, dismiss einen 'dismissed'-Merker, damit der
 * Vorschlag nicht wieder auftaucht.
 */
export function decideSuggestion(db: Database.Database, threadKey: string, accept: boolean): void {
  const row = db
    .prepare(
      `SELECT m.id mid, m.account_id, m.subject,
              m.from_addr, f.special_use, b.text_plain, b.html_raw,
              json_extract(a.action_items_json, '$[0].title') label,
              json_extract(a.action_items_json, '$[0].due') due
       FROM ai_annotations a JOIN messages m ON m.id = a.message_id
       JOIN folders f ON f.id = m.folder_id
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.thread_key = ? AND json_array_length(coalesce(a.action_items_json, '[]')) > 0
       ORDER BY m.date DESC LIMIT 1`
    )
    .get(threadKey) as
    | {
        mid: number
        account_id: number
        subject: string | null
        from_addr: string | null
        special_use: string | null
        label: string | null
        due: string | null
        text_plain: string | null
        html_raw: string | null
      }
    | undefined
  if (!row?.label) return
  if (isUserAuthoredMail(db, row.from_addr, row.special_use)) return
  if (
    isForwardWithoutRequest(row.subject, row.text_plain?.trim() || htmlToText(row.html_raw ?? ''))
  )
    return
  db.prepare(
    `INSERT OR IGNORE INTO tasks (source_kind, source_id, account_id, title, notes, due_date, status, created_at)
     VALUES ('mail', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.mid,
    row.account_id,
    row.label.slice(0, 200),
    row.subject ? `Aus: ${row.subject}` : null,
    row.due,
    accept ? 'open' : 'dismissed',
    Date.now()
  )
}
