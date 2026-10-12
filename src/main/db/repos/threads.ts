import type Database from 'better-sqlite3-multiple-ciphers'
import { isSecurityNotification, isUserAuthoredMail } from './tasks'
import { taskAddresseeVerdict } from '../../ai/addressee'
import type {
  AiCategory,
  FolderListItem,
  MessageDetail,
  Recipient,
  ThreadListItem
} from '@shared/types'
import { folderLeaf, folderRole } from '@shared/folder-roles'
import { htmlToText } from '../../mail/parser'
import { isForwardWithoutRequest, textBeforeForwardedMessage } from '../../mail/forwarded'
import { isVisibleMailAttachment } from '../../mail/attachment-visibility'
import { metrics } from '../../diagnostics/metrics'

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

/** Up to three recipient labels (name, else address) from a to_json value. */
function recipientLabels(json: string | null): string[] {
  if (!json) return []
  try {
    return (JSON.parse(json) as Array<{ name?: string; address?: string }>)
      .map((x) => x.name || x.address || '')
      .filter(Boolean)
      .slice(0, 3)
  } catch {
    return []
  }
}

/** Thread keys of the current page as a JSON array parameter for `json_each`. */
const PAGE_KEYS = 'SELECT value FROM json_each(?)'

interface TaskCandidate {
  thread_key: string
  message_id: number
  status: string
  title: string
  due_date: string | null
  subject: string | null
}

interface ActionCandidate {
  thread_key: string
  message_id: number
  label: string | null
  due: string | null
  addressed_to_me: number
  to_json: string | null
  cc_json: string | null
  from_addr: string | null
  subject: string | null
  special_use: string | null
  account_email: string | null
  account_display_name: string | null
  account_name: string | null
}

/**
 * Builds the list rows for one page with a fixed number of set-based queries
 * (was ~8 queries per thread, ~2,400 statements for 300 rows). Every query
 * looks at all messages of the thread, independent of the listed folder, and
 * orders ties like the old per-thread queries did: newest date, then newest id.
 */
function buildThreadItems(db: Database.Database, aggs: ThreadAggRow[]): ThreadListItem[] {
  if (aggs.length === 0) return []
  const keys = JSON.stringify(aggs.map((agg) => agg.thread_key))

  const latest = new Map(
    (
      db
        .prepare(
          `SELECT thread_key, subject, snippet FROM (
             SELECT m.thread_key, m.subject, m.snippet,
                    row_number() OVER (PARTITION BY m.thread_key ORDER BY m.date DESC, m.id DESC) rn
             FROM messages m WHERE m.thread_key IN (${PAGE_KEYS})
           ) WHERE rn = 1`
        )
        .all(keys) as Array<{ thread_key: string; subject: string | null; snippet: string | null }>
    ).map((row) => [row.thread_key, row])
  )

  const toJson = new Map(
    (
      db
        .prepare(
          `SELECT thread_key, to_json FROM (
             SELECT m.thread_key, m.to_json,
                    row_number() OVER (PARTITION BY m.thread_key ORDER BY m.date DESC, m.id DESC) rn
             FROM messages m WHERE m.thread_key IN (${PAGE_KEYS}) AND m.to_json IS NOT NULL
           ) WHERE rn = 1`
        )
        .all(keys) as Array<{ thread_key: string; to_json: string }>
    ).map((row) => [row.thread_key, row.to_json])
  )

  // Up to three distinct sender names, ordered by their most recent message
  const fromNames = new Map<string, string[]>()
  for (const row of db
    .prepare(
      `SELECT thread_key, from_name FROM (
         SELECT thread_key, from_name,
                row_number() OVER (PARTITION BY thread_key ORDER BY min(pos)) rk
         FROM (
           SELECT m.thread_key, m.from_name,
                  row_number() OVER (PARTITION BY m.thread_key ORDER BY m.date DESC, m.id DESC) pos
           FROM messages m WHERE m.thread_key IN (${PAGE_KEYS}) AND m.from_name IS NOT NULL
         )
         GROUP BY thread_key, from_name
       ) WHERE rk <= 3 ORDER BY thread_key, rk`
    )
    .all(keys) as Array<{ thread_key: string; from_name: string }>) {
    const list = fromNames.get(row.thread_key) ?? []
    list.push(row.from_name)
    fromNames.set(row.thread_key, list)
  }

  const colors = new Map(
    (
      db.prepare('SELECT id, color FROM accounts').all() as Array<{
        id: number
        color: string | null
      }>
    ).map((row) => [row.id, row.color])
  )

  // AI view of the thread: category/summary of the newest annotated message,
  // priority as the maximum across the thread; user override beats the model.
  const ai = new Map(
    (
      db
        .prepare(
          `SELECT thread_key, cat, summary, needs_reply, max_priority FROM (
             SELECT m.thread_key, coalesce(a.user_override_category, a.category) cat, a.summary,
                    a.needs_reply, max(a.priority) OVER (PARTITION BY m.thread_key) max_priority,
                    row_number() OVER (PARTITION BY m.thread_key ORDER BY m.date DESC, m.id DESC) rn
             FROM ai_annotations a JOIN messages m ON m.id = a.message_id
             WHERE m.thread_key IN (${PAGE_KEYS})
           ) WHERE rn = 1`
        )
        .all(keys) as Array<{
        thread_key: string
        cat: string
        summary: string | null
        needs_reply: number
        max_priority: number | null
      }>
    ).map((row) => [row.thread_key, row])
  )

  // Letterpress: the owl's task suggestion + decision state.
  // accepted/dismissed = a task exists with its source in this thread;
  // suggested = annotation has action_items, but no task yet.
  const tasks = new Map(
    (
      db
        .prepare(
          `SELECT thread_key, message_id, status, title, due_date, subject FROM (
             SELECT m.thread_key, m.id message_id, t.status, t.title, t.due_date, m.subject,
                    row_number() OVER (PARTITION BY m.thread_key ORDER BY t.created_at DESC, t.id DESC) rn
             FROM tasks t
             JOIN messages m ON t.source_kind = 'mail' AND m.id = t.source_id
             JOIN folders f ON f.id = m.folder_id
             WHERE m.thread_key IN (${PAGE_KEYS})
               AND coalesce(f.special_use, '') <> '\\Sent'
               AND NOT EXISTS (SELECT 1 FROM accounts own WHERE lower(own.email) = lower(m.from_addr))
           ) WHERE rn = 1`
        )
        .all(keys) as TaskCandidate[]
    ).map((row) => [row.thread_key, row])
  )
  const actions = new Map(
    (
      db
        .prepare(
          `SELECT * FROM (
             SELECT m.thread_key, m.id message_id,
                    json_extract(a.action_items_json, '$[0].title') label,
                    json_extract(a.action_items_json, '$[0].due') due,
                    a.addressed_to_me, m.to_json, m.cc_json, m.from_addr, m.subject, f.special_use,
                    acc.email account_email, acc.display_name account_display_name, acc.account_name,
                    row_number() OVER (PARTITION BY m.thread_key ORDER BY m.date DESC, m.id DESC) rn
             FROM ai_annotations a JOIN messages m ON m.id = a.message_id
             JOIN folders f ON f.id = m.folder_id
             LEFT JOIN accounts acc ON acc.id = m.account_id
             WHERE m.thread_key IN (${PAGE_KEYS})
               AND json_array_length(coalesce(a.action_items_json, '[]')) > 0
           ) WHERE rn = 1`
        )
        .all(keys) as ActionCandidate[]
    ).map((row) => [row.thread_key, row])
  )

  // Body text only for the few messages that carry a task or an action item
  const bodyIds = [...tasks.values(), ...actions.values()].map((row) => row.message_id)
  const bodies = new Map<number, string>()
  if (bodyIds.length > 0) {
    for (const row of db
      .prepare(
        `SELECT message_id, text_plain, html_raw FROM message_bodies
         WHERE message_id IN (${PAGE_KEYS})`
      )
      .all(JSON.stringify([...new Set(bodyIds)])) as Array<{
      message_id: number
      text_plain: string | null
      html_raw: string | null
    }>) {
      bodies.set(row.message_id, row.text_plain?.trim() || htmlToText(row.html_raw ?? ''))
    }
  }
  const bodyOf = (messageId: number): string => bodies.get(messageId) ?? ''

  return aggs.map((agg) => {
    const last = latest.get(agg.thread_key)
    const toNames = recipientLabels(toJson.get(agg.thread_key) ?? null)
    const annotation = ai.get(agg.thread_key)
    const taskRow = tasks.get(agg.thread_key)
    const actionItem = actions.get(agg.thread_key)

    let taskState: 'suggested' | 'accepted' | 'dismissed' | 'none' = 'none'
    let suggestedTask: { label: string; due: string | null } | null = null
    const visibleTask =
      taskRow && !isForwardWithoutRequest(taskRow.subject, bodyOf(taskRow.message_id))
        ? taskRow
        : undefined
    if (visibleTask) {
      taskState = visibleTask.status === 'dismissed' ? 'dismissed' : 'accepted'
      suggestedTask = { label: visibleTask.title, due: visibleTask.due_date }
    } else if (
      actionItem?.label &&
      !isSecurityNotification(last?.subject) &&
      // Addressee gate: 'none' (distribution list/Bcc, CC only, other salutation)
      // shows no suggestion either; 'suggest' and 'create' allow the strip.
      taskAddresseeVerdict({
        accountEmail: actionItem.account_email,
        displayName: actionItem.account_display_name,
        accountName: actionItem.account_name,
        toJson: actionItem.to_json,
        ccJson: actionItem.cc_json,
        bodyText: textBeforeForwardedMessage(actionItem.subject, bodyOf(actionItem.message_id)),
        addressedToMe: actionItem.addressed_to_me !== 0
      }) !== 'none' &&
      !isUserAuthoredMail(db, actionItem.from_addr, actionItem.special_use) &&
      !isForwardWithoutRequest(actionItem.subject, bodyOf(actionItem.message_id))
    ) {
      taskState = 'suggested'
      suggestedTask = { label: actionItem.label, due: actionItem.due }
    }

    return {
      threadKey: agg.thread_key,
      accountId: agg.account_id,
      accountColor: colors.get(agg.account_id) ?? '#7c7ff2',
      subject: last?.subject ?? null,
      snippet: last?.snippet ?? null,
      fromNames: fromNames.get(agg.thread_key) ?? [],
      toNames,
      date: agg.max_date,
      messageCount: agg.cnt,
      unread: agg.unread_cnt > 0,
      flagged: agg.flagged === 1,
      hasAttachments: agg.has_att === 1,
      aiCategory: (annotation?.cat as AiCategory) ?? null,
      aiPriority: annotation ? annotation.max_priority : null,
      aiSummary: annotation?.summary ?? null,
      needsReply: annotation?.needs_reply === 1,
      suggestedTask,
      taskState
    }
  })
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
  mbox: 'inbox' | 'sent' | 'spam' = 'inbox',
  folderId?: number
): ThreadListItem[] {
  // Folder view: exactly one folder. Otherwise the unified view across the
  // special-use folders — \Junk thus only shows up when SPAM is explicitly selected.
  const where =
    folderId != null
      ? `JOIN folders f ON m.folder_id = f.id WHERE f.id = ?`
      : `JOIN folders f ON m.folder_id = f.id WHERE f.special_use = ?`
  const accountFilter = accountId != null ? ' AND m.account_id = ?' : ''
  const params: unknown[] = [folderId != null ? folderId : MBOX_SPECIAL[mbox]]
  if (accountId != null) params.push(accountId)
  params.push(limit)
  // `+m.thread_key`: group via a temp B-tree instead of walking idx_msg_thread
  // over every message of every folder; the scan then starts from the folder.
  const rows = db
    .prepare(
      `${THREAD_AGG_SELECT} ${where}${accountFilter} GROUP BY +m.thread_key ORDER BY max_date DESC LIMIT ?`
    )
    .all(...params) as ThreadAggRow[]
  return metrics.time('db.threads.buildItems', () => buildThreadItems(db, rows), {
    rows: rows.length
  })
}

/**
 * Folder tree per account for the folder view: only folders with envelopes
 * (full sync). Trash/Drafts/"All Mail" stay out.
 */
export function listFolders(db: Database.Database): FolderListItem[] {
  const rows = db
    .prepare(
      `SELECT f.id, f.account_id, f.path, f.delimiter, f.special_use,
              count(DISTINCT m.thread_key) AS threads,
              count(DISTINCT CASE WHEN m.seen = 0 THEN m.thread_key END) AS unread
       FROM folders f LEFT JOIN messages m ON m.folder_id = f.id
       WHERE f.sync_mode = 'full'
       GROUP BY f.id
       ORDER BY f.account_id, f.path COLLATE NOCASE`
    )
    .all() as Array<{
    id: number
    account_id: number
    path: string
    delimiter: string | null
    special_use: string | null
    threads: number
    unread: number
  }>
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    path: r.path,
    name: folderLeaf(r.path, r.delimiter),
    delimiter: r.delimiter,
    role: folderRole(r.special_use),
    threadCount: r.threads,
    unreadCount: r.unread
  }))
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
  // Local only: no automatic remote images — neither sender approval nor
  // the global default apply; "show images" per message stays possible.
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
        // Default BLOCKED (design 3b, privacy promise): remote images
        // load only if the user allowed it globally ('1') OR the
        // sender is on the allowlist. Explicitly stored values
        // ('1'/'0') keep their meaning — only the unset default flips.
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

/** Thread counts per folder (for the segmented control), optionally per account. */
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
