import type Database from 'better-sqlite3-multiple-ciphers'

/**
 * Baut contact_stats für ein Konto neu auf: sent_count aus den Empfängern des
 * Sent-Ordners (Prioritäts-Boost „hat Tim dem je geschrieben?" + Stilbeispiele),
 * received_count aus den Absendern der INBOX.
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
    // Haeufigster Anzeigename je Adresse, damit die Empfaenger-Vorschlaege
    // ihn nicht pro Tastendruck aus messages nachschlagen muessen. Laeuft mit
    // idx_msg_from_addr_lower als indizierter Lookup je Kontakt.
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

/** Schreibt erfolgreiche SMTP-Empfaenger sofort in die lokale Historie. */
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

/** Zuletzt genutztes Absenderkonto fuer einen bereits angeschriebenen Kontakt. */
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
 * Empfänger-Vorschläge aus der Kontakt-Historie (angeschrieben zählt dreifach,
 * empfangen einfach). Namen kommen aus dem häufigsten from_name der Adresse;
 * eigene Konto-Adressen werden ausgefiltert.
 */
export function suggestContacts(
  db: Database.Database,
  query: string,
  limit: number
): ContactSuggestion[] {
  const like = `%${query.toLowerCase().replace(/[%_]/g, '')}%`
  // Name und Adresse stehen beide in contact_stats (Migration 023), die Suche
  // bleibt damit auf einer 3k-Zeilen-Tabelle. Vorher kostete jeder Tastendruck
  // eine korrelierte Suche über alle Nachrichten — Sekunden bis Minuten, in
  // denen der Main-Prozess keine IPC mehr beantwortet hat.
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
