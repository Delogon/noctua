import type Database from 'better-sqlite3-multiple-ciphers'
import { discoverCardDav, type DnsResolver, type FetchLike } from '../dav'
import { getSecret } from '../auth/secrets'
import { calSecretKey, getCalAccount } from '../calendar/repo'
import { calendarSync } from '../calendar/sync'
import { getContactsAccount, listAddressBookSummaries, type AddressBookSummary } from './repo'

/**
 * Kontakte (CardDAV) als Option eines Kalender-Kontos: gleicher Server, gleiche
 * Zugangsdaten (Vault `cal:<id>:password`). Ein-/Ausschalten, Adressbuch-
 * Auswahl und Status für die Einstellungen.
 */

export interface ContactsDeps {
  fetch?: FetchLike
  dns?: DnsResolver
}

export interface ContactsStatus {
  enabled: boolean
  lastSync: number | null
  error: string | null
  addressBooks: AddressBookSummary[]
}

export function contactsStatus(db: Database.Database, accountId: number): ContactsStatus {
  if (!getCalAccount(db, accountId)) throw new Error('Kalender-Konto nicht gefunden')
  const state = getContactsAccount(db, accountId)
  return {
    enabled: state?.enabled === 1,
    lastSync: state?.last_sync ?? null,
    error: state?.error ?? null,
    addressBooks: listAddressBookSummaries(db, accountId)
  }
}

/**
 * Kontakt-Sync ein-/ausschalten. Einschalten sucht den CardDAV-Dienst (gleicher
 * Server, Principal des Kalender-Kontos als erster Kandidat) und legt die
 * Adressbücher an; Ausschalten entfernt Adressbücher und Karten lokal.
 */
export async function setContactsSync(
  db: Database.Database,
  accountId: number,
  enabled: boolean,
  deps: ContactsDeps = {}
): Promise<{ addressBookCount: number }> {
  const account = getCalAccount(db, accountId)
  if (!account) throw new Error('Kalender-Konto nicht gefunden')

  if (!enabled) {
    db.transaction(() => {
      db.prepare('DELETE FROM addressbooks WHERE account_id = ?').run(accountId)
      db.prepare('DELETE FROM contacts_accounts WHERE account_id = ?').run(accountId)
    })()
    return { addressBookCount: 0 }
  }

  const password = getSecret(calSecretKey(accountId))
  if (!password) throw new Error('Kein Passwort im Vault')
  const found = await discoverCardDav(account.server_url, account.username, password, {
    ...deps,
    hints: account.principal_url ? [account.principal_url] : []
  })
  db.prepare(
    `INSERT INTO contacts_accounts (account_id, enabled, home_url) VALUES (?, 1, ?)
     ON CONFLICT(account_id) DO UPDATE SET enabled = 1, home_url = excluded.home_url, error = NULL`
  ).run(accountId, found.homeUrl)
  // Adressbücher und Karten lädt der nächste Lauf der Konto-Schleife
  calendarSync.refresh(accountId, true)
  return { addressBookCount: found.addressBooks.length }
}

/** Einzelnes Adressbuch aktivieren/deaktivieren; Deaktivieren verwirft die lokalen Karten. */
export function setAddressBookEnabled(
  db: Database.Database,
  addressBookId: number,
  enabled: boolean
): void {
  const row = db
    .prepare('SELECT account_id AS accountId FROM addressbooks WHERE id = ?')
    .get(addressBookId) as { accountId: number } | undefined
  if (!row) throw new Error('Adressbuch nicht gefunden')
  db.transaction(() => {
    db.prepare('UPDATE addressbooks SET enabled = ? WHERE id = ?').run(
      enabled ? 1 : 0,
      addressBookId
    )
    if (!enabled) {
      db.prepare('DELETE FROM dav_contacts WHERE addressbook_id = ?').run(addressBookId)
      // Token/ctag zurücksetzen: Wiedereinschalten lädt vollständig neu
      db.prepare('UPDATE addressbooks SET ctag = NULL, sync_token = NULL WHERE id = ?').run(
        addressBookId
      )
    }
  })()
  if (enabled) calendarSync.refresh(row.accountId, true)
}
