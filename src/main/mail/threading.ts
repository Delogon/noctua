import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 20)
}

/** Strips Re:/Fwd:/AW:/WG:/SV: prefixes iteratively and normalizes. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim()
  const prefix = /^(re|fwd?|aw|wg|sv|antw)\s*(\[\d+\])?\s*:\s*/i
  while (prefix.test(s)) s = s.replace(prefix, '')
  return s.replace(/\s+/g, ' ').toLowerCase().trim()
}

export interface ThreadKeyInput {
  gmThrid: string | null
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string | null
}

const MAX_THREAD_REFS = 500

/**
 * Thread key per account: Gmail authoritatively via X-GM-THRID, otherwise
 * JWZ-light via References/In-Reply-To (first hit in the DB wins),
 * fallback normalized subject, last resort Message-ID (single thread).
 */
export function computeThreadKey(
  db: Database.Database,
  accountId: number,
  input: ThreadKeyInput
): string {
  if (input.gmThrid) return `${accountId}:gm:${input.gmThrid}`

  // Only the newest references (RFC 5322: oldest first, In-Reply-To last):
  // otherwise a References header with tens of thousands of IDs blows SQLite's
  // bind variable limit and blocks the sync permanently (SEC, vuln-0011).
  const refIds = [...input.references, ...(input.inReplyTo ? [input.inReplyTo] : [])]
    .filter(Boolean)
    .slice(-MAX_THREAD_REFS)
  if (refIds.length > 0) {
    const placeholders = refIds.map(() => '?').join(',')
    const row = db
      .prepare(
        `SELECT thread_key FROM messages
         WHERE account_id = ? AND message_id IN (${placeholders})
         ORDER BY date DESC LIMIT 1`
      )
      .get(accountId, ...refIds) as { thread_key: string } | undefined
    if (row) return row.thread_key
  }

  const normalized = input.subject ? normalizeSubject(input.subject) : ''
  if (normalized) return `${accountId}:sub:${sha1(normalized)}`
  if (input.messageId) return `${accountId}:msg:${sha1(input.messageId)}`
  return `${accountId}:rnd:${sha1(String(Math.random()))}`
}
