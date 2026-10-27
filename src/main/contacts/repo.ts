import type Database from 'better-sqlite3-multiple-ciphers'
import { normalizeEmail, parseVCard, stripBinaryProperties } from './vcard'

/**
 * DB access for CardDAV contacts (read-only mirror): address books,
 * cards, normalized email index and the search for recipient suggestions.
 */

export interface ContactsAccountRow {
  account_id: number
  enabled: number
  home_url: string | null
  error: string | null
  last_sync: number | null
}

export function getContactsAccount(
  db: Database.Database,
  accountId: number
): ContactsAccountRow | undefined {
  return db.prepare('SELECT * FROM contacts_accounts WHERE account_id = ?').get(accountId) as
    ContactsAccountRow | undefined
}

export interface AddressBookRow {
  id: number
  account_id: number
  url: string
  display_name: string
  ctag: string | null
  sync_token: string | null
  supports_sync: number
  enabled: number
  last_sync: number | null
}

/** A card's raw text is only kept up to this size (after removing photos). */
export const MAX_RAW_VCARD_CHARS = 64 * 1024

/**
 * Parse and store a card. Unparseable cards (or ones without name/number/
 * address) are skipped and an older version is removed.
 * Returns: true if a row was written.
 */
export function upsertContact(
  db: Database.Database,
  input: { addressBookId: number; href: string; etag: string | null; vcard: string },
  now = Date.now()
): boolean {
  const card = parseVCard(input.vcard)
  if (!card) {
    deleteContactByHref(db, input.addressBookId, input.href)
    return false
  }
  const raw = stripBinaryProperties(input.vcard)
  const searchText = [card.fullName, card.givenName, card.familyName, card.org]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const existing = db
    .prepare('SELECT id FROM dav_contacts WHERE addressbook_id = ? AND href = ?')
    .get(input.addressBookId, input.href) as { id: number } | undefined
  const values = [
    input.etag,
    card.uid ?? input.href,
    card.fullName,
    card.givenName,
    card.familyName,
    card.org,
    JSON.stringify(card.emails),
    JSON.stringify(card.phones),
    searchText,
    raw.length <= MAX_RAW_VCARD_CHARS ? raw : null,
    now
  ]
  let id: number
  if (existing) {
    id = existing.id
    db.prepare(
      `UPDATE dav_contacts SET etag = ?, uid = ?, full_name = ?, given_name = ?, family_name = ?,
         org = ?, emails = ?, phones = ?, search_text = ?, raw_vcard = ?, updated_at = ? WHERE id = ?`
    ).run(...values, id)
    db.prepare('DELETE FROM dav_contact_emails WHERE contact_id = ?').run(id)
  } else {
    const result = db
      .prepare(
        `INSERT INTO dav_contacts (etag, uid, full_name, given_name, family_name, org, emails,
           phones, search_text, raw_vcard, updated_at, addressbook_id, href)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...values, input.addressBookId, input.href)
    id = Number(result.lastInsertRowid)
  }
  const insertEmail = db.prepare(
    'INSERT OR IGNORE INTO dav_contact_emails (contact_id, email, pref) VALUES (?, ?, ?)'
  )
  for (const e of card.emails) insertEmail.run(id, e.value, e.pref ? 1 : 0)
  return true
}

export function deleteContactByHref(
  db: Database.Database,
  addressBookId: number,
  href: string
): boolean {
  return (
    db
      .prepare('DELETE FROM dav_contacts WHERE addressbook_id = ? AND href = ?')
      .run(addressBookId, href).changes > 0
  )
}

export interface DavContactMatch {
  addr: string
  name: string | null
}

/** LIKE pattern from user input: neutralize wildcards and escape characters. */
function likePattern(query: string, prefix: boolean): string {
  const escaped = query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)
  return prefix ? `${escaped}%` : `%${escaped}%`
}

/**
 * Matches in enabled address books for recipient suggestions: substring in
 * name/organization or email. Order: prefix matches (name, first/last
 * name, address start) before substring matches, then the preferred address,
 * then alphabetical. Multiple addresses of a contact appear individually.
 */
export function searchDavContacts(
  db: Database.Database,
  query: string,
  limit: number
): DavContactMatch[] {
  const q = query.trim()
  if (!q) return []
  const sub = likePattern(q, false)
  const pre = likePattern(q, true)
  const word = `% ${likePattern(q, true)}`
  const rows = db
    .prepare(
      `SELECT e.email AS addr, c.full_name AS name
       FROM dav_contact_emails e
       JOIN dav_contacts c ON c.id = e.contact_id
       JOIN addressbooks b ON b.id = c.addressbook_id
       WHERE b.enabled = 1
         AND (e.email LIKE @sub ESCAPE '\\' OR c.search_text LIKE @sub ESCAPE '\\')
       GROUP BY e.email
       ORDER BY
         (e.email LIKE @pre ESCAPE '\\' OR c.search_text LIKE @pre ESCAPE '\\'
           OR c.search_text LIKE @word ESCAPE '\\') DESC,
         max(e.pref) DESC,
         c.full_name COLLATE NOCASE ASC,
         e.email ASC
       LIMIT @limit`
    )
    .all({ sub, pre, word, limit }) as Array<{ addr: string; name: string }>
  // Name only if it is more than the address itself
  return rows.map((r) => ({ addr: r.addr, name: r.name && r.name !== r.addr ? r.name : null }))
}

/** Display names for addresses (lowercase) from enabled address books. */
export function davNamesForEmails(db: Database.Database, emails: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const wanted = [...new Set(emails.map(normalizeEmail).filter((e): e is string => !!e))]
  if (wanted.length === 0) return out
  const stmt = db.prepare(
    `SELECT c.full_name AS name
     FROM dav_contact_emails e
     JOIN dav_contacts c ON c.id = e.contact_id
     JOIN addressbooks b ON b.id = c.addressbook_id
     WHERE b.enabled = 1 AND e.email = ? AND c.full_name <> '' AND c.full_name <> e.email
     ORDER BY c.updated_at DESC LIMIT 1`
  )
  for (const email of wanted) {
    const row = stmt.get(email) as { name: string } | undefined
    if (row) out.set(email, row.name)
  }
  return out
}

export interface AddressBookSummary {
  id: number
  accountId: number
  displayName: string
  enabled: boolean
  contactCount: number
  lastSync: number | null
}

export function listAddressBookSummaries(
  db: Database.Database,
  accountId: number
): AddressBookSummary[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.account_id AS accountId, b.display_name AS displayName, b.enabled,
              b.last_sync AS lastSync,
              (SELECT count(*) FROM dav_contacts c WHERE c.addressbook_id = b.id) AS contactCount
       FROM addressbooks b WHERE b.account_id = ? ORDER BY b.display_name COLLATE NOCASE`
    )
    .all(accountId) as Array<Omit<AddressBookSummary, 'enabled'> & { enabled: number }>
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }))
}
