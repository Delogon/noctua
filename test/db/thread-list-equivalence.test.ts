import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { AiCategory, ThreadListItem } from '@shared/types'
import { listThreads } from '@main/db/repos/threads'
import { isSecurityNotification, isUserAuthoredMail } from '@main/db/repos/tasks'
import { taskAddresseeVerdict } from '@main/ai/addressee'
import { htmlToText } from '@main/mail/parser'
import { isForwardWithoutRequest, textBeforeForwardedMessage } from '@main/mail/forwarded'
import { closeTestDb, createTestDb } from '../helpers/db'

// The thread list used to run ~8 queries per thread. It now builds a page with
// a few set-based queries. This test keeps the old per-thread implementation
// verbatim as the reference and checks both produce identical rows.

interface ThreadAggRow {
  thread_key: string
  account_id: number
  max_date: number
  cnt: number
  unread_cnt: number
  flagged: number
  has_att: number
}

function legacyBuildThreadItem(db: Database.Database, agg: ThreadAggRow): ThreadListItem {
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

  // AI view of the thread: category/summary of the newest annotated message,
  // priority as the maximum across the thread; user override beats the model.
  const ai = db
    .prepare(
      `SELECT coalesce(a.user_override_category, a.category) cat, a.summary, a.needs_reply
       FROM ai_annotations a JOIN messages m ON m.id = a.message_id
       WHERE m.thread_key = ? ORDER BY m.date DESC LIMIT 1`
    )
    .get(agg.thread_key) as { cat: string; summary: string | null; needs_reply: number } | undefined

  // Letterpress: the owl's task suggestion + decision state.
  // accepted/dismissed = a task exists with its source in this thread;
  // suggested = annotation has action_items, but no task yet.
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
    // Addressee gate: 'none' (distribution list/Bcc, CC only, other salutation)
    // shows no suggestion either; 'suggest' and 'create' allow the strip.
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

const MBOX: Record<'inbox' | 'sent' | 'spam', string> = {
  inbox: '\\Inbox',
  sent: '\\Sent',
  spam: '\\Junk'
}

function legacyListThreads(
  db: Database.Database,
  limit: number,
  accountId?: number,
  mbox: 'inbox' | 'sent' | 'spam' = 'inbox',
  folderId?: number
): ThreadListItem[] {
  const where =
    folderId != null
      ? `JOIN folders f ON m.folder_id = f.id WHERE f.id = ?`
      : `JOIN folders f ON m.folder_id = f.id WHERE f.special_use = ?`
  const accountFilter = accountId != null ? ' AND m.account_id = ?' : ''
  const params: unknown[] = [folderId != null ? folderId : MBOX[mbox]]
  if (accountId != null) params.push(accountId)
  params.push(limit)
  const rows = db
    .prepare(
      `SELECT m.thread_key, m.account_id,
              max(coalesce(m.date, m.internal_date, 0)) AS max_date,
              count(*) AS cnt,
              sum(CASE WHEN m.seen = 0 THEN 1 ELSE 0 END) AS unread_cnt,
              max(m.flagged) AS flagged,
              max(m.has_attachments) AS has_att
       FROM messages m ${where}${accountFilter}
       GROUP BY m.thread_key ORDER BY max_date DESC LIMIT ?`
    )
    .all(...params) as ThreadAggRow[]
  return rows.map((agg) => legacyBuildThreadItem(db, agg))
}

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const CATEGORIES = [
  'personal',
  'work',
  'newsletter',
  'promotions',
  'notifications',
  'transactional',
  'other'
]

/** Varied mailbox: ties, null dates, overrides, tasks, action items, forwards, own mail. */
function seedVaried(
  db: Database.Database,
  seed: number
): { accounts: number[]; folders: number[] } {
  const r = rng(seed)
  const pick = <T>(list: T[]): T => list[Math.floor(r() * list.length)]
  const accounts: number[] = []
  const folders: number[] = []
  const folderRoles: Array<[number, string | null]> = []
  for (const [i, email] of ['owner@example.org', 'second@example.org'].entries()) {
    const id = Number(
      db
        .prepare(
          `INSERT INTO accounts (email, display_name, account_name, provider, credential_type,
             imap_host, imap_port, smtp_host, smtp_port, color, created_at)
           VALUES (?, ?, ?, 'imap', 'password', 'h', 1, 'h', 1, ?, 0)`
        )
        .run(email, i === 0 ? 'Owner Person' : null, `Acc ${i}`, i === 0 ? '#112233' : null)
        .lastInsertRowid
    )
    accounts.push(id)
    for (const [path, role] of [
      ['INBOX', '\\Inbox'],
      ['Sent', '\\Sent'],
      ['Archive', '\\Archive'],
      ['Junk', '\\Junk'],
      ['Projects', null]
    ] as Array<[string, string | null]>) {
      const fid = Number(
        db
          .prepare('INSERT INTO folders (account_id, path, special_use) VALUES (?, ?, ?)')
          .run(id, path, role).lastInsertRowid
      )
      folders.push(fid)
      folderRoles.push([fid, role])
    }
  }
  const insertMsg = db.prepare(
    `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, subject, from_addr,
       from_name, to_json, cc_json, date, internal_date, seen, flagged, has_attachments, snippet, body_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'full')`
  )
  const insertBody = db.prepare(
    'INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, ?, ?)'
  )
  const insertAnn = db.prepare(
    `INSERT INTO ai_annotations (message_id, category, priority, summary, action_items_json,
       needs_reply, addressed_to_me, confidence, user_override_category, prompt_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0.8, ?, 6, 0)`
  )
  const insertTask = db.prepare(
    `INSERT INTO tasks (source_kind, source_id, account_id, title, status, due_date, created_at)
     VALUES ('mail', ?, ?, ?, ?, ?, ?)`
  )
  let uid = 1
  for (let t = 0; t < 70; t++) {
    const account = pick(accounts)
    const own = account === accounts[0] ? 'owner@example.org' : 'second@example.org'
    const key = `thread-${t}`
    const n = 1 + Math.floor(r() * 4)
    const baseDate = 1_700_000_000_000 + Math.floor(r() * 50) * 60_000
    for (let i = 0; i < n; i++) {
      const [folderId] = pick(
        folderRoles.filter(([fid]) => folders.indexOf(fid) < 5 === (account === accounts[0]))
      )
      const fromOwn = r() < 0.2
      const subject = pick([
        `Projekt ${t}`,
        `Re: Projekt ${t}`,
        `Fwd: Rechnung ${t}`,
        'Neue Anmeldung bei Ihrem Konto',
        null
      ])
      // Ties (same minute) and missing dates on purpose
      const date = r() < 0.1 ? null : baseDate + Math.floor(r() * 3) * 60_000
      const toJson = pick([
        JSON.stringify([{ name: 'Owner Person', address: own }]),
        JSON.stringify([{ name: null, address: 'list@example.org' }, { name: 'Only Name' }]),
        JSON.stringify([
          { address: own },
          { address: 'b@example.org' },
          { address: 'c@example.org' },
          { address: 'd@example.org' }
        ]),
        'not json',
        null
      ])
      const id = Number(
        insertMsg.run(
          account,
          folderId,
          uid++,
          `<m${uid}@x>`,
          key,
          subject,
          fromOwn ? own : pick(['anna@firma.de', 'bob@shop.example', 'Carla@Firma.de']),
          pick(['Anna', 'Bob', 'Carla', null, 'Anna']),
          toJson,
          r() < 0.3 ? JSON.stringify([{ address: own }]) : null,
          date,
          date ?? 1_600_000_000_000,
          r() < 0.5 ? 1 : 0,
          r() < 0.2 ? 1 : 0,
          r() < 0.2 ? 1 : 0,
          `snippet ${t}.${i}`
        ).lastInsertRowid
      )
      const forwarded = subject?.startsWith('Fwd:')
      insertBody.run(
        id,
        r() < 0.5
          ? forwarded
            ? '---------- Forwarded message ---------\nVon: x@y\nBitte zahlen.'
            : 'Hallo Owner, kannst du bitte bis Freitag antworten?'
          : null,
        '<p>Hallo zusammen, bitte das Formular abgeben.</p>'
      )
      if (r() < 0.65) {
        const items = pick([
          '[]',
          JSON.stringify([{ title: `Aufgabe ${t}`, due: '2026-11-01' }]),
          JSON.stringify([{ title: `Antworten ${t}`, due: null }]),
          null
        ])
        insertAnn.run(
          id,
          pick(CATEGORIES),
          1 + Math.floor(r() * 5),
          r() < 0.8 ? `Summary ${t}.${i}` : null,
          items,
          r() < 0.4 ? 1 : 0,
          r() < 0.7 ? 1 : 0,
          r() < 0.15 ? pick(CATEGORIES) : null
        )
      }
      if (r() < 0.2) {
        insertTask.run(
          id,
          account,
          `Task ${t}.${i}`,
          pick(['open', 'done', 'dismissed']),
          pick([null, '2026-12-01']),
          // unique creation times: ties had no defined order before (see below)
          1_700_000_000_000 + uid
        )
      }
    }
  }
  return { accounts, folders }
}

/** Ties on the newest date have no defined order (old and new alike): compare by key. */
const byKey = (rows: ThreadListItem[]): ThreadListItem[] =>
  [...rows].sort((a, b) => a.threadKey.localeCompare(b.threadKey))

describe('thread list: set-based rows equal the per-thread implementation', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => closeTestDb(db))

  for (const seed of [1, 7, 42]) {
    it(`matches for every mailbox, account filter and folder (seed ${seed})`, () => {
      const { accounts, folders } = seedVaried(db, seed)
      for (const mbox of ['inbox', 'sent', 'spam'] as const) {
        expect(byKey(listThreads(db, 300, undefined, mbox))).toEqual(
          byKey(legacyListThreads(db, 300, undefined, mbox))
        )
        for (const account of accounts) {
          expect(byKey(listThreads(db, 300, account, mbox))).toEqual(
            byKey(legacyListThreads(db, 300, account, mbox))
          )
        }
      }
      for (const folder of folders) {
        expect(byKey(listThreads(db, 300, undefined, 'inbox', folder))).toEqual(
          byKey(legacyListThreads(db, 300, undefined, 'inbox', folder))
        )
      }
      // Newest first; equal dates have no defined order (neither before nor now)
      const dates = listThreads(db, 300).map((row) => row.date)
      expect(dates).toEqual([...dates].sort((x, y) => y - x))
      // Limit smaller than the number of threads
      const reference = new Map(legacyListThreads(db, 300).map((row) => [row.threadKey, row]))
      const limited = listThreads(db, 5)
      expect(limited.map((row) => row.date)).toEqual(
        legacyListThreads(db, 5).map((row) => row.date)
      )
      for (const row of limited) expect(row).toEqual(reference.get(row.threadKey))
    })
  }

  it('picks the newest task when two tasks of a thread share a creation time', () => {
    const acc = Number(
      db
        .prepare(
          `INSERT INTO accounts (email, provider, credential_type, imap_host, imap_port, smtp_host,
             smtp_port, created_at, account_name) VALUES ('o@x', 'imap', 'password', 'h', 1, 'h', 1, 0, 'a')`
        )
        .run().lastInsertRowid
    )
    const inbox = Number(
      db
        .prepare(
          `INSERT INTO folders (account_id, path, special_use) VALUES (?, 'INBOX', '\\Inbox')`
        )
        .run(acc).lastInsertRowid
    )
    const msg = Number(
      db
        .prepare(
          `INSERT INTO messages (account_id, folder_id, uid, thread_key, subject, from_addr, date)
           VALUES (?, ?, 1, 't', 'Hallo', 'a@b.example', 1)`
        )
        .run(acc, inbox).lastInsertRowid
    )
    const task = db.prepare(
      `INSERT INTO tasks (source_kind, source_id, account_id, title, status, created_at)
       VALUES ('mail', ?, ?, ?, 'open', 5)`
    )
    task.run(msg, acc, 'first')
    task.run(msg, acc, 'second')
    expect(listThreads(db, 10)[0].suggestedTask?.label).toBe('second')
  })
})
