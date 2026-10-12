import type Database from 'better-sqlite3-multiple-ciphers'
import type { CalAccountRow } from './repo'

/**
 * „Ich" im Sinne von Einladungen: alle Adressen der Mail-Konten sowie
 * Benutzername und Kalenderadressen (calendar-user-address-set) der
 * Kalender-Konten. Alles kleingeschrieben.
 */

function norm(value: string): string | null {
  const v = value
    .trim()
    .replace(/^mailto:/i, '')
    .toLowerCase()
  return v.includes('@') ? v : null
}

export function calendarAccountAddresses(row: CalAccountRow): string[] {
  const out: string[] = []
  const u = norm(row.username)
  if (u) out.push(u)
  try {
    const list = JSON.parse(row.user_addresses) as unknown
    if (Array.isArray(list)) {
      for (const v of list) {
        if (typeof v !== 'string') continue
        const a = norm(v)
        if (a) out.push(a)
      }
    }
  } catch {
    // defektes JSON ignorieren
  }
  return out
}

export function myAddresses(db: Database.Database): Set<string> {
  const out = new Set<string>()
  for (const row of db.prepare('SELECT email FROM accounts').all() as Array<{ email: string }>) {
    const a = norm(row.email)
    if (a) out.add(a)
  }
  for (const row of db.prepare('SELECT * FROM cal_accounts').all() as CalAccountRow[]) {
    for (const a of calendarAccountAddresses(row)) out.add(a)
  }
  return out
}

/** Eigene Hauptadresse eines Kalender-Kontos (Organisator neuer Termine). */
export function ownAddressOf(db: Database.Database, row: CalAccountRow): string | null {
  if (row.mail_account_id !== null) {
    const m = db.prepare('SELECT email FROM accounts WHERE id = ?').get(row.mail_account_id) as
      { email: string } | undefined
    const a = m ? norm(m.email) : null
    if (a) return a
  }
  return calendarAccountAddresses(row)[0] ?? null
}

/** Mail-Konto, das die Adresse besitzt (für Versand als Organisator/Teilnehmer). */
export function mailAccountForAddress(
  db: Database.Database,
  address: string,
  fallbackCalAccount?: CalAccountRow
): { id: number; email: string; displayName: string | null } | null {
  const row = db
    .prepare('SELECT id, email, display_name FROM accounts WHERE lower(email) = ?')
    .get(address.toLowerCase()) as
    { id: number; email: string; display_name: string | null } | undefined
  if (row) return { id: row.id, email: row.email, displayName: row.display_name }
  if (fallbackCalAccount?.mail_account_id != null) {
    const m = db
      .prepare('SELECT id, email, display_name FROM accounts WHERE id = ?')
      .get(fallbackCalAccount.mail_account_id) as
      { id: number; email: string; display_name: string | null } | undefined
    if (m) return { id: m.id, email: m.email, displayName: m.display_name }
  }
  return null
}
