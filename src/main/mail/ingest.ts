import { foldSharpS } from '../search/fold'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { htmlToText, type ParsedMail } from './parser'
import { computeThreadKey } from './threading'
import { isVisibleMailAttachment } from './attachment-visibility'

export interface EnvelopeData {
  uid: number
  gmMsgid: string | null
  gmThrid: string | null
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string | null
  fromAddr: string | null
  fromName: string | null
  to: Array<{ name: string | null; address: string }>
  cc: Array<{ name: string | null; address: string }>
  replyTo: Array<{ name: string | null; address: string }>
  date: number | null
  internalDate: number | null
  size: number | null
  flags: Set<string>
  hasAttachments: boolean
  listUnsubscribe: boolean
  listUnsubscribeUrl: string | null
  listUnsubscribePost: boolean
}

function flagInt(flags: Set<string>, flag: string): number {
  return flags.has(flag) ? 1 : 0
}

interface SearchContentRow {
  subject: string | null
  from_addr: string | null
  from_name: string | null
  to_json: string | null
  cc_json: string | null
  snippet: string | null
  body_state: string
  text_plain: string | null
  html_raw: string | null
}

function recipientsForSearch(...values: Array<string | null>): string {
  return values
    .flatMap((json) => {
      try {
        return (JSON.parse(json ?? '[]') as Array<{ name?: string; address?: string }>).map(
          (recipient) => `${recipient.name ?? ''} ${recipient.address ?? ''}`.trim()
        )
      } catch {
        return []
      }
    })
    .filter(Boolean)
    .join(' ')
}

/**
 * Baut FTS und den Content-Hash aus derselben lokalen Momentaufnahme neu auf.
 * Der Hash invalidiert einen Vektor nur, wenn sich semantisch relevanter Inhalt
 * (inklusive Envelope-Metadaten oder Anhangnamen) wirklich geaendert hat.
 */
export function refreshMessageSearchIndex(db: Database.Database, messageId: number): void {
  const row = db
    .prepare(
      `SELECT m.subject, m.from_addr, m.from_name, m.to_json, m.cc_json,
              m.snippet, m.body_state, b.text_plain, b.html_raw
       FROM messages m
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.id = ?`
    )
    .get(messageId) as SearchContentRow | undefined
  if (!row) return

  const attachments = (
    db
      .prepare(
        `SELECT filename FROM attachments
         WHERE message_id = ? AND filename IS NOT NULL
         ORDER BY id`
      )
      .all(messageId) as Array<{ filename: string }>
  ).map((attachment) => attachment.filename)
  const recipients = recipientsForSearch(row.to_json, row.cc_json)
  const bodyText = row.text_plain?.trim() || htmlToText(row.html_raw ?? '') || row.snippet || ''
  const searchableBody = [bodyText, ...attachments].filter(Boolean).join('\n').slice(0, 100_000)
  const sender = `${row.from_name ?? ''} ${row.from_addr ?? ''}`.trim()
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify([row.subject ?? '', sender, recipients, row.body_state, bodyText, attachments])
    )
    .digest('hex')

  const previous = db
    .prepare('SELECT content_hash FROM message_embedding_state WHERE message_id = ?')
    .get(messageId) as { content_hash: string } | undefined

  db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(messageId)
  db.prepare(
    `INSERT INTO messages_fts (rowid, subject, sender, recipients, body)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    messageId,
    foldSharpS(row.subject ?? ''),
    foldSharpS(sender),
    foldSharpS(recipients),
    foldSharpS(searchableBody)
  )

  if (!previous || previous.content_hash !== contentHash) {
    // Ein alter Vektor darf waehrend des Rebuilds keine falschen Treffer liefern.
    db.prepare('DELETE FROM message_vecs WHERE rowid = ?').run(BigInt(messageId))
  }
  db.prepare(
    `INSERT INTO message_embedding_state
       (message_id, content_hash, embedded_hash, embedding_model, indexed_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       embedded_hash = CASE
         WHEN message_embedding_state.content_hash = excluded.content_hash
           THEN message_embedding_state.embedded_hash ELSE NULL END,
       embedding_model = CASE
         WHEN message_embedding_state.content_hash = excluded.content_hash
           THEN message_embedding_state.embedding_model ELSE NULL END,
       indexed_at = CASE
         WHEN message_embedding_state.content_hash = excluded.content_hash
           THEN message_embedding_state.indexed_at ELSE NULL END,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`
  ).run(messageId, contentHash, Date.now())
}

export interface SearchOrphanCleanup {
  fts: number
  vectors: number
  states: number
}

/** Entfernt Indexzeilen, die virtuelle Tabellen nicht per FK-Cascade verlieren. */
/**
 * One-time repair (M94): the trigram rebuild in migration 021 populated the
 * index from text_plain/snippet only — HTML-only mails lost their body text
 * in FTS. Re-run the regular index path for those messages once.
 */
export function reindexHtmlOnlyMessages(db: Database.Database): number {
  const FLAG = 'search.htmlReindex021Done'
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(FLAG) as
    { value: string } | undefined
  if (done?.value === '1') return 0

  const candidates = (
    db
      .prepare(
        `SELECT b.message_id AS id FROM message_bodies b
         WHERE (b.text_plain IS NULL OR trim(b.text_plain) = '')
           AND b.html_raw IS NOT NULL AND length(b.html_raw) > 50`
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id)
  for (const id of candidates) refreshMessageSearchIndex(db, id)

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FLAG, '1')
  if (candidates.length > 0) {
    console.log(`[search] FTS-Reindex für ${candidates.length} HTML-only-Mails abgeschlossen`)
  }
  return candidates.length
}

export function cleanupSearchOrphans(db: Database.Database): SearchOrphanCleanup {
  const ftsIds = (
    db
      .prepare(
        `SELECT ft.rowid AS id FROM messages_fts ft
         LEFT JOIN messages m ON m.id = ft.rowid WHERE m.id IS NULL`
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id)
  const vectorIds = (
    db
      .prepare(
        `SELECT v.rowid AS id FROM message_vecs v
         LEFT JOIN messages m ON m.id = v.rowid WHERE m.id IS NULL`
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id)
  const stateIds = (
    db
      .prepare(
        `SELECT s.message_id AS id FROM message_embedding_state s
         LEFT JOIN messages m ON m.id = s.message_id WHERE m.id IS NULL`
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id)

  const deleteFts = db.prepare('DELETE FROM messages_fts WHERE rowid = ?')
  const deleteVector = db.prepare('DELETE FROM message_vecs WHERE rowid = ?')
  const deleteState = db.prepare('DELETE FROM message_embedding_state WHERE message_id = ?')
  db.transaction(() => {
    ftsIds.forEach((id) => deleteFts.run(id))
    vectorIds.forEach((id) => deleteVector.run(BigInt(id)))
    stateIds.forEach((id) => deleteState.run(id))
  })()
  return { fts: ftsIds.length, vectors: vectorIds.length, states: stateIds.length }
}

/**
 * Envelope-Phase: legt die Nachricht an oder aktualisiert Flags, wenn sie
 * schon existiert. Gibt die messages.id zurück (oder null bei Gmail-Duplikat).
 */
export function upsertEnvelope(
  db: Database.Database,
  accountId: number,
  folderId: number,
  env: EnvelopeData
): { messageId: number; threadKey: string; isNew: boolean } | null {
  const existing = db
    .prepare('SELECT id, thread_key FROM messages WHERE folder_id = ? AND uid = ?')
    .get(folderId, env.uid) as { id: number; thread_key: string } | undefined

  if (existing) {
    db.prepare(
      `UPDATE messages SET
         gm_msgid = ?, gm_thrid = ?, message_id = ?, in_reply_to = ?, refs = ?,
         subject = ?, from_addr = ?, from_name = ?, to_json = ?, cc_json = ?, reply_to = ?,
         date = ?, internal_date = ?, size = ?, seen = ?, flagged = ?, answered = ?, draft = ?,
         has_attachments = ?, list_unsubscribe = ?, list_unsubscribe_url = ?,
         list_unsubscribe_post = ?
       WHERE id = ?`
    ).run(
      env.gmMsgid,
      env.gmThrid,
      env.messageId,
      env.inReplyTo,
      env.references.join(' ') || null,
      env.subject,
      env.fromAddr,
      env.fromName,
      JSON.stringify(env.to),
      JSON.stringify(env.cc),
      env.replyTo.length > 0 ? JSON.stringify(env.replyTo) : null,
      env.date,
      env.internalDate,
      env.size,
      flagInt(env.flags, '\\Seen'),
      flagInt(env.flags, '\\Flagged'),
      flagInt(env.flags, '\\Answered'),
      flagInt(env.flags, '\\Draft'),
      env.hasAttachments ? 1 : 0,
      env.listUnsubscribe ? 1 : 0,
      env.listUnsubscribeUrl ? env.listUnsubscribeUrl.slice(0, 2000) : null,
      env.listUnsubscribePost ? 1 : 0,
      existing.id
    )
    refreshMessageSearchIndex(db, existing.id)
    return { messageId: existing.id, threadKey: existing.thread_key, isNew: false }
  }

  // Gmail-Dedupe: dieselbe Mail kann über mehrere synchronisierte Ordner kommen.
  if (env.gmMsgid) {
    const dupe = db
      .prepare('SELECT id FROM messages WHERE account_id = ? AND gm_msgid = ? AND folder_id != ?')
      .get(accountId, env.gmMsgid, folderId) as { id: number } | undefined
    if (dupe) return null
  }

  const threadKey = computeThreadKey(db, accountId, {
    gmThrid: env.gmThrid,
    messageId: env.messageId,
    inReplyTo: env.inReplyTo,
    references: env.references,
    subject: env.subject
  })

  const result = db
    .prepare(
      `INSERT INTO messages (
        account_id, folder_id, uid, gm_msgid, gm_thrid, message_id, in_reply_to, refs,
        thread_key, subject, from_addr, from_name, to_json, cc_json, reply_to,
        date, internal_date, size, seen, flagged, answered, draft, has_attachments,
        list_unsubscribe, list_unsubscribe_url, list_unsubscribe_post
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      accountId,
      folderId,
      env.uid,
      env.gmMsgid,
      env.gmThrid,
      env.messageId,
      env.inReplyTo,
      env.references.join(' ') || null,
      threadKey,
      env.subject,
      env.fromAddr,
      env.fromName,
      JSON.stringify(env.to),
      JSON.stringify(env.cc),
      env.replyTo.length > 0 ? JSON.stringify(env.replyTo) : null,
      env.date,
      env.internalDate,
      env.size,
      flagInt(env.flags, '\\Seen'),
      flagInt(env.flags, '\\Flagged'),
      flagInt(env.flags, '\\Answered'),
      flagInt(env.flags, '\\Draft'),
      env.hasAttachments ? 1 : 0,
      env.listUnsubscribe ? 1 : 0,
      env.listUnsubscribeUrl ? env.listUnsubscribeUrl.slice(0, 2000) : null,
      env.listUnsubscribePost ? 1 : 0
    )

  const messageId = Number(result.lastInsertRowid)
  // Envelope-Metadaten sind sofort suchbar, auch waehrend Bodies nachladen.
  refreshMessageSearchIndex(db, messageId)
  return { messageId, threadKey, isNew: true }
}

/** Body-Phase: speichert Text/HTML, Attachment-Metadaten und den FTS-Eintrag. */
export function storeBody(db: Database.Database, messageId: number, parsed: ParsedMail): void {
  const row = db
    .prepare(
      'SELECT body_state, subject, from_addr, from_name, to_json, cc_json FROM messages WHERE id = ?'
    )
    .get(messageId) as
    | {
        body_state: string
        subject: string | null
        from_addr: string | null
        from_name: string | null
        to_json: string | null
        cc_json: string | null
      }
    | undefined
  if (!row) return
  db.prepare(
    `INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET text_plain = excluded.text_plain, html_raw = excluded.html_raw`
  ).run(messageId, parsed.text, parsed.html)

  db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId)
  const insertAtt = db.prepare(
    'INSERT INTO attachments (message_id, part_id, filename, mime_type, size, content_id) VALUES (?, ?, ?, ?, ?, ?)'
  )
  parsed.attachments.forEach((att, index) => {
    insertAtt.run(messageId, String(index), att.filename, att.mimeType, att.size, att.contentId)
  })

  const hasVisibleAttachments = parsed.attachments.some((attachment) =>
    isVisibleMailAttachment(attachment, parsed.html)
  )
  db.prepare(
    `UPDATE messages SET body_state = 'full', snippet = ?, has_attachments = ? WHERE id = ?`
  ).run(parsed.snippet, hasVisibleAttachments ? 1 : 0, messageId)

  // Immer ersetzen: wiederholte Fetches koennen korrigierte Bodies oder
  // Attachment-Metadaten enthalten und muessen dann FTS + Vektor invalidieren.
  refreshMessageSearchIndex(db, messageId)
}

export function applyFlagUpdate(
  db: Database.Database,
  folderId: number,
  uid: number,
  flags: Set<string>
): number | null {
  const row = db
    .prepare('SELECT id FROM messages WHERE folder_id = ? AND uid = ?')
    .get(folderId, uid) as { id: number } | undefined
  if (!row) return null
  db.prepare('UPDATE messages SET seen = ?, flagged = ?, answered = ? WHERE id = ?').run(
    flagInt(flags, '\\Seen'),
    flagInt(flags, '\\Flagged'),
    flagInt(flags, '\\Answered'),
    row.id
  )
  return row.id
}

export function deleteByUids(db: Database.Database, folderId: number, uids: number[]): void {
  if (uids.length === 0) return
  const placeholders = uids.map(() => '?').join(',')
  const ids = (
    db
      .prepare(`SELECT id FROM messages WHERE folder_id = ? AND uid IN (${placeholders})`)
      .all(folderId, ...uids) as Array<{ id: number }>
  ).map((row) => row.id)
  const deleteFts = db.prepare('DELETE FROM messages_fts WHERE rowid = ?')
  const deleteVector = db.prepare('DELETE FROM message_vecs WHERE rowid = ?')
  db.transaction(() => {
    ids.forEach((id) => {
      deleteFts.run(id)
      deleteVector.run(BigInt(id))
    })
    db.prepare(`DELETE FROM messages WHERE folder_id = ? AND uid IN (${placeholders})`).run(
      folderId,
      ...uids
    )
  })()
}
