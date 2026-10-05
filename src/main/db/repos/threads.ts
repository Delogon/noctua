import type Database from 'better-sqlite3-multiple-ciphers'
import { isSecurityNotification, isUserAuthoredMail } from './tasks'
import { taskAddresseeVerdict } from '../../ai/addressee'
import type { AiCategory, MessageDetail, Recipient, ThreadListItem } from '@shared/types'
import { htmlToText } from '../../mail/parser'
import { isForwardWithoutRequest, textBeforeForwardedMessage } from '../../mail/forwarded'
import { isVisibleMailAttachment } from '../../mail/attachment-visibility'

interface ThreadAggRow {
  thread_key: string
  account_id: number
  max_date: number
  cnt: number
  unread_cnt: number
  flagged: number
  has_att: number
}

function parseRecipients(json: string | null): Recipient[] {
  if (!json) return []
  try {
    return (JSON.parse(json) as Array<{ name?: string | null; address?: string }>)
      .filter((r) => r.address)
      .map((r) => ({ name: r.name ?? null, address: r.address! }))
  } catch {
    return []
  }
}

function buildThreadItem(db: Database.Database, agg: ThreadAggRow): ThreadListItem {
  const latest = db
    .prepare(
      'SELECT subject, snippet FROM messages WHERE thread_key = ? ORDER BY date DESC LIMIT 1'
    )
    .get(agg.thread_key) as { subject: string | null; snippet: string | null }
  const toNames = (
    db
      .prepare(
        `SELECT to_json FROM messages WHERE thread_key = ? AND to_json IS NOT NULL ORDER BY date DESC LIMIT 1`
      )
      .all(agg.thread_key) as Array<{ to_json: string }>
  ).flatMap((r) => {
    try {
      return (JSON.parse(r.to_json) as Array<{ name?: string; address?: string }>)
        .map((x) => x.name || x.address || '')
        .filter(Boolean)
        .slice(0, 3)
    } catch {
      return []
    }
  })
  const fromNames = (
    db
      .prepare(
        `SELECT DISTINCT from_name FROM messages
         WHERE thread_key = ? AND from_name IS NOT NULL ORDER BY date DESC LIMIT 3`
      )
      .all(agg.thread_key) as Array<{ from_name: string }>
  ).map((r) => r.from_name)
  const color = (
    db.prepare('SELECT color FROM accounts WHERE id = ?').get(agg.account_id) as
      { color: string | null } | undefined
  )?.color

  // AI-Sicht des Threads: Kategorie/Summary der neuesten annotierten Nachricht,
  // Priorität als Maximum über den Thread; Nutzer-Override schlägt das Modell.
  const ai = db
    .prepare(
      `SELECT coalesce(a.user_override_category, a.category) cat, a.summary, a.needs_reply
       FROM ai_annotations a JOIN messages m ON m.id = a.message_id
       WHERE m.thread_key = ? ORDER BY m.date DESC LIMIT 1`
    )
    .get(agg.thread_key) as { cat: string; summary: string | null; needs_reply: number } | undefined

  // Letterpress: Aufgaben-Vorschlag der Eule + Entscheidungszustand.
  // accepted/dismissed = es existiert ein Task mit Quelle in diesem Thread;
  // suggested = Annotation hat action_items, aber noch kein Task.
  const taskRow = db
    .prepare(
      `SELECT t.status, t.title, t.due_date, m.subject, b.text_plain, b.html_raw FROM tasks t
       JOIN messages m ON t.source_kind = 'mail' AND m.id = t.source_id
       JOIN folders f ON f.id = m.folder_id
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.thread_key = ?
         AND coalesce(f.special_use, '') <> '\\Sent'
         AND NOT EXISTS (SELECT 1 FROM accounts own WHERE lower(own.email) = lower(m.from_addr))
       ORDER BY t.created_at DESC LIMIT 1`
    )
    .get(agg.thread_key) as
    | {
        status: string
        title: string
        due_date: string | null
        subject: string | null
        text_plain: string | null
        html_raw: string | null
      }
    | undefined
  const actionItem = db
    .prepare(
      `SELECT json_extract(a.action_items_json, '$[0].title') label,
              json_extract(a.action_items_json, '$[0].due') due,
              a.addressed_to_me,
              m.to_json, m.cc_json, m.from_addr, m.subject, f.special_use,
              acc.email account_email, acc.display_name account_display_name,
              acc.account_name, b.text_plain, b.html_raw
       FROM ai_annotations a JOIN messages m ON m.id = a.message_id
       JOIN folders f ON f.id = m.folder_id
       LEFT JOIN accounts acc ON acc.id = m.account_id
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.thread_key = ? AND json_array_length(coalesce(a.action_items_json, '[]')) > 0
       ORDER BY m.date DESC LIMIT 1`
    )
    .get(agg.thread_key) as
    | {
        label: string | null
        due: string | null
        addressed_to_me: number
        to_json: string | null
        cc_json: string | null
        from_addr: string | null
        special_use: string | null
        account_email: string | null
        account_display_name: string | null
        account_name: string | null
        subject: string | null
        text_plain: string | null
        html_raw: string | null
      }
    | undefined
  let taskState: 'suggested' | 'accepted' | 'dismissed' | 'none' = 'none'
  let suggestedTask: { label: string; due: string | null } | null = null
  const visibleTask =
    taskRow &&
    !isForwardWithoutRequest(
      taskRow.subject,
      taskRow.text_plain?.trim() || htmlToText(taskRow.html_raw ?? '')
    )
      ? taskRow
      : undefined
  if (visibleTask) {
    taskState = visibleTask.status === 'dismissed' ? 'dismissed' : 'accepted'
    suggestedTask = { label: visibleTask.title, due: visibleTask.due_date }
  } else if (
    actionItem?.label &&
    !isSecurityNotification(latest.subject) &&
    // Adressat-Gate: 'none' (Verteiler/Bcc, nur CC, fremde Anrede) zeigt auch
    // keinen Vorschlag; 'suggest' und 'create' lassen den Streifen zu.
    taskAddresseeVerdict({
      accountEmail: actionItem.account_email,
      displayName: actionItem.account_display_name,
      accountName: actionItem.account_name,
      toJson: actionItem.to_json,
      ccJson: actionItem.cc_json,
      bodyText: textBeforeForwardedMessage(
        actionItem.subject,
        actionItem.text_plain?.trim() || htmlToText(actionItem.html_raw ?? '')
      ),
      addressedToMe: actionItem.addressed_to_me !== 0
    }) !== 'none' &&
    !isUserAuthoredMail(db, actionItem.from_addr, actionItem.special_use) &&
    !isForwardWithoutRequest(
      actionItem.subject,
      actionItem.text_plain?.trim() || htmlToText(actionItem.html_raw ?? '')
    )
  ) {
    taskState = 'suggested'
    suggestedTask = { label: actionItem.label, due: actionItem.due }
  }
  const maxPriority = ai
    ? (
        db
          .prepare(
            `SELECT max(a.priority) p FROM ai_annotations a
             JOIN messages m ON m.id = a.message_id WHERE m.thread_key = ?`
          )
          .get(agg.thread_key) as { p: number | null }
      ).p
    : null

  return {
    threadKey: agg.thread_key,
    accountId: agg.account_id,
    accountColor: color ?? '#7c7ff2',
    subject: latest?.subject ?? null,
    snippet: latest?.snippet ?? null,
    fromNames,
    toNames,
    date: agg.max_date,
    messageCount: agg.cnt,
    unread: agg.unread_cnt > 0,
    flagged: agg.flagged === 1,
    hasAttachments: agg.has_att === 1,
    aiCategory: (ai?.cat as AiCategory) ?? null,
    aiPriority: maxPriority,
    aiSummary: ai?.summary ?? null,
    needsReply: ai?.needs_reply === 1,
    suggestedTask,
    taskState
  }
}

const THREAD_AGG_SELECT = `
  SELECT m.thread_key, m.account_id,
         max(coalesce(m.date, m.internal_date, 0)) AS max_date,
         count(*) AS cnt,
         sum(CASE WHEN m.seen = 0 THEN 1 ELSE 0 END) AS unread_cnt,
         max(m.flagged) AS flagged,
         max(m.has_attachments) AS has_att
  FROM messages m`

const MBOX_SPECIAL: Record<'inbox' | 'sent' | 'spam', string> = {
  inbox: '\\Inbox',
  sent: '\\Sent',
  spam: '\\Junk'
}

export function listThreads(
  db: Database.Database,
  limit: number,
  accountId?: number,
  mbox: 'inbox' | 'sent' | 'spam' = 'inbox'
): ThreadListItem[] {
  const where = `JOIN folders f ON m.folder_id = f.id WHERE f.special_use = ?`
  const accountFilter = accountId != null ? ' AND m.account_id = ?' : ''
  const params: unknown[] =
    accountId != null ? [MBOX_SPECIAL[mbox], accountId, limit] : [MBOX_SPECIAL[mbox], limit]
  const rows = db
    .prepare(
      `${THREAD_AGG_SELECT} ${where}${accountFilter} GROUP BY m.thread_key ORDER BY max_date DESC LIMIT ?`
    )
    .all(...params) as ThreadAggRow[]
  return rows.map((agg) => buildThreadItem(db, agg))
}

export function imagesAllowKey(addr: string): string {
  return `images.allow.${addr.toLowerCase()}`
}

export function getThreadMessages(db: Database.Database, threadKey: string): MessageDetail[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.account_id, m.folder_id, m.subject, m.from_name, m.from_addr,
              m.to_json, m.cc_json, m.reply_to, m.date, m.seen, m.flagged, m.has_attachments,
              m.body_state, m.list_unsubscribe, b.text_plain, b.html_raw
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.thread_key = ?
       ORDER BY coalesce(m.date, m.internal_date, 0) ASC`
    )
    .all(threadKey) as Array<Record<string, unknown>>

  const attStmt = db.prepare(
    `SELECT id, filename, mime_type, size, content_id
     FROM attachments
     WHERE message_id = ?
     ORDER BY CAST(part_id AS INTEGER), id`
  )
  const allowStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  // Local only: keine automatischen Remote-Bilder — weder Absender-Freigabe noch
  // globaler Default greifen; „Bilder anzeigen" pro Nachricht bleibt möglich.
  const localOnly =
    (allowStmt.get('privacy.localOnly') as { value: string } | undefined)?.value === '1'
  return rows.map((r) => {
    const bodyState = (r.body_state as 'none' | 'full') ?? 'none'
    const html = (r.html_raw as string) ?? null
    const attachments = (attStmt.all(r.id) as Array<Record<string, unknown>>)
      .filter((attachment) =>
        isVisibleMailAttachment(
          {
            mimeType: (attachment.mime_type as string) ?? null,
            filename: (attachment.filename as string) ?? null,
            contentId: (attachment.content_id as string) ?? null
          },
          html
        )
      )
      .map((a) => ({
        id: a.id as number,
        filename: (a.filename as string) ?? null,
        mimeType: (a.mime_type as string) ?? null,
        size: (a.size as number) ?? null
      }))

    return {
      listUnsubscribe: r.list_unsubscribe === 1,
      remoteImagesAllowed:
        !localOnly &&
        // Default BLOCKIERT (Design 3b, Privacy-Versprechen): Remote-Bilder
        // laden nur, wenn der Nutzer es global erlaubt hat ('1') ODER der
        // Absender auf der Freigabeliste steht. Explizit gespeicherte Werte
        // ('1'/'0') behalten ihre Bedeutung — nur der ungesetzte Default dreht.
        ((allowStmt.get('mail.remoteImagesDefault') as { value: string } | undefined)?.value ===
          '1' ||
          (
            allowStmt.get(imagesAllowKey((r.from_addr as string) ?? '')) as
              { value: string } | undefined
          )?.value === '1'),
      id: r.id as number,
      accountId: r.account_id as number,
      folderId: r.folder_id as number,
      subject: (r.subject as string) ?? null,
      fromName: (r.from_name as string) ?? null,
      fromAddr: (r.from_addr as string) ?? null,
      to: parseRecipients(r.to_json as string | null),
      cc: parseRecipients(r.cc_json as string | null),
      replyTo: parseRecipients(r.reply_to as string | null),
      date: (r.date as number) ?? null,
      seen: r.seen === 1,
      flagged: r.flagged === 1,
      hasAttachments: bodyState === 'full' ? attachments.length > 0 : r.has_attachments === 1,
      bodyText: (r.text_plain as string) ?? null,
      bodyHtml: html,
      bodyState,
      attachments
    }
  })
}

/** Thread-Zähler je Ordner (für die Segmented-Control), optional je Konto. */
export function mboxCounts(
  db: Database.Database,
  accountId?: number
): { inbox: number; sent: number; spam: number } {
  const row = (special: string): number =>
    (
      db
        .prepare(
          `SELECT count(DISTINCT m.thread_key) n FROM messages m
           JOIN folders f ON m.folder_id = f.id
           WHERE f.special_use = ? AND (? IS NULL OR m.account_id = ?)`
        )
        .get(special, accountId ?? null, accountId ?? null) as { n: number }
    ).n
  return { inbox: row('\\Inbox'), sent: row('\\Sent'), spam: row('\\Junk') }
}
