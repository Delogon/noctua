import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 20)
}

/** Entfernt Re:/Fwd:/AW:/WG:/SV:-Präfixe iterativ und normalisiert. */
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
 * Thread-Schlüssel pro Konto: Gmail autoritativ über X-GM-THRID, sonst
 * JWZ-light über References/In-Reply-To (erster Treffer in der DB gewinnt),
 * Fallback normalisiertes Subject, Notnagel Message-ID (Einzel-Thread).
 */
export function computeThreadKey(
  db: Database.Database,
  accountId: number,
  input: ThreadKeyInput
): string {
  if (input.gmThrid) return `${accountId}:gm:${input.gmThrid}`

  // Nur die jüngsten Referenzen (RFC 5322: älteste zuerst, In-Reply-To hinten):
  // ein References-Header mit Zehntausenden IDs sprengt sonst SQLites
  // Bind-Variablen-Limit und blockiert den Sync dauerhaft (SEC, vuln-0011).
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
