import type Database from 'better-sqlite3-multiple-ciphers'
import { davNamesForEmails, searchDavContacts } from '../../contacts/repo'

/**
 * Rebuilds contact_stats for an account: sent_count from the recipients of the
 * Sent folder (priority boost "has Tim ever written to them?" + style examples),
 * received_count from the senders in the INBOX.
 */
export function rebuildContactStats(db: Database.Database, accountId: number): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM contact_stats WHERE account_id = ?').run(accountId)
    db.prepare(
      `INSERT INTO contact_stats (account_id, addr, sent_count, received_count, last_interaction)
       SELECT m.account_id, lower(json_extract(je.value, '$.address')), count(*), 0, max(coalesce(m.date, 0))
       FROM messages m
       JOIN folders f ON f.id = m.folder_id, json_each(m.to_json) AS je
       WHERE m.account_id = ? AND f.special_use = '\\Sent'
         AND json_extract(je.value, '$.address') IS NOT NULL
       GROUP BY lower(json_extract(je.value, '$.address'))`
    ).run(accountId)
    db.prepare(
      `INSERT INTO contact_stats (account_id, addr, sent_count, received_count, last_interaction)
       SELECT m.account_id, lower(m.from_addr), 0, count(*), max(coalesce(m.date, 0))
       FROM messages m
       JOIN folders f ON f.id = m.folder_id
       WHERE m.account_id = ? AND f.special_use = '\\Inbox' AND m.from_addr IS NOT NULL
       GROUP BY lower(m.from_addr)
       ON CONFLICT(account_id, addr) DO UPDATE SET
         received_count = excluded.received_count,
         last_interaction = max(contact_stats.last_interaction, excluded.last_interaction)`
    ).run(accountId)
    // Most frequent display name per address, so the recipient suggestions
    // don't have to look it up from messages on every keystroke. Runs as an
    // indexed lookup per contact via idx_msg_from_addr_lower.
    db.prepare(
      `UPDATE contact_stats SET display_name = (
         SELECT m.from_name FROM messages m
         WHERE lower(m.from_addr) = contact_stats.addr AND m.from_name IS NOT NULL
         GROUP BY m.from_name ORDER BY count(*) DESC LIMIT 1
       )
       WHERE account_id = ?`
    ).run(accountId)
  })
  tx()
}

export interface ContactSuggestion {
  addr: string
  name: string | null
}

function normalizeAddress(raw: string): string | null {
  const angleAddress = raw.match(/<([^<>]+)>/)?.[1]
  const address = (angleAddress ?? raw).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null
}

/** Writes successful SMTP recipients to the local history right away. */
export function recordSentContacts(
  db: Database.Database,
  accountId: number,
  recipients: string[],
  sentAt = Date.now()
): void {
  const addresses = [
    ...new Set(recipients.map(normalizeAddress).filter((addr): addr is string => !!addr))
  ]
  if (addresses.length === 0) return
  const upsert = db.prepare(
    `INSERT INTO contact_stats (account_id, addr, sent_count, received_count, last_interaction)
     VALUES (?, ?, 1, 0, ?)
     ON CONFLICT(account_id, addr) DO UPDATE SET
       sent_count = contact_stats.sent_count + 1,
       last_interaction = max(coalesce(contact_stats.last_interaction, 0), excluded.last_interaction)`
  )
  db.transaction(() => {
    for (const address of addresses) upsert.run(accountId, address, sentAt)
  })()
}

/** Most recently used sender account for a contact already written to. */
export function preferredAccountForContact(db: Database.Database, address: string): number | null {
  const normalized = normalizeAddress(address)
  if (!normalized) return null
  const row = db
    .prepare(
      `SELECT cs.account_id AS accountId
       FROM contact_stats cs
       JOIN accounts a ON a.id = cs.account_id
       WHERE cs.addr = ? AND cs.sent_count > 0
       ORDER BY coalesce(cs.last_interaction, 0) DESC, cs.sent_count DESC, cs.account_id ASC
       LIMIT 1`
    )
    .get(normalized) as { accountId: number } | undefined
  return row?.accountId ?? null
}

/**
 * Recipient suggestions: first the local contact history (existing
 * ranking), then CardDAV contacts. Dedupe by address; if a history hit
 * lacks a name, it comes from the address book. Own
 * account addresses never appear.
 */
export function suggestContacts(
  db: Database.Database,
  query: string,
  limit: number
): ContactSuggestion[] {
  const local = suggestFromHistory(db, query, limit)
  let davRows: ReturnType<typeof searchDavContacts> = []
  try {
    davRows = searchDavContacts(db, query, limit * 2 + local.length)
  } catch {
    // Contact tables missing/locked: suggestions stay usable without the address book
  }
  if (davRows.length === 0) return local

  const davNames = new Map(davRows.map((r) => [r.addr, r.name]))
  const missing = local.filter((c) => !c.name).map((c) => c.addr)
  const looked = missing.length > 0 ? davNamesForEmails(db, missing) : new Map<string, string>()
  const out: ContactSuggestion[] = local.map((c) => ({
    addr: c.addr,
    name: c.name ?? davNames.get(c.addr) ?? looked.get(c.addr) ?? null
  }))
  if (out.length >= limit) return out
  const seen = new Set(out.map((c) => c.addr.toLowerCase()))
  const own = new Set(
    (
      db.prepare('SELECT lower(email) AS email FROM accounts').all() as Array<{ email: string }>
    ).map((r) => r.email)
  )
  for (const row of davRows) {
    if (out.length >= limit) break
    const key = row.addr.toLowerCase()
    if (seen.has(key) || own.has(key)) continue
    seen.add(key)
    out.push({ addr: row.addr, name: row.name })
  }
  return out
}

function suggestFromHistory(
  db: Database.Database,
  query: string,
  limit: number
): ContactSuggestion[] {
  const like = `%${query.toLowerCase().replace(/[%_]/g, '')}%`
  // Name and address both live in contact_stats (migration 023), so the search
  // stays on a 3k-row table. Previously every keystroke cost a
  // correlated search over all messages — seconds to minutes during
  // which the main process no longer answered any IPC.
  return db
    .prepare(
      `SELECT cs.addr AS addr,
              max(cs.display_name) AS name,
              sum(cs.sent_count * 3 + cs.received_count) AS weight,
              max(coalesce(cs.last_interaction, 0)) AS latest
       FROM contact_stats cs
       JOIN accounts own_account ON own_account.id = cs.account_id
       WHERE cs.addr <> lower(own_account.email)
         AND (cs.addr LIKE ? OR lower(coalesce(cs.display_name, '')) LIKE ?)
       GROUP BY cs.addr
       ORDER BY (sum(cs.sent_count) > 0) DESC, weight DESC, latest DESC
       LIMIT ?`
    )
    .all(like, like, limit) as ContactSuggestion[]
}
