import type Database from 'better-sqlite3-multiple-ciphers'
import { discoverCardDav, type DnsResolver, type FetchLike } from '../dav'
import { getSecret } from '../auth/secrets'
import { calSecretKey, getCalAccount } from '../calendar/repo'
import { calendarSync } from '../calendar/sync'
import { getContactsAccount, listAddressBookSummaries, type AddressBookSummary } from './repo'

/**
 * Contacts (CardDAV) as an option of a calendar account: same server, same
 * credentials (vault `cal:<id>:password`). Enable/disable, address book
 * selection and status for the settings.
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
 * Turn contact sync on/off. Turning it on looks for the CardDAV service (same
 * server, the calendar account's principal as first candidate) and creates the
 * address books; turning it off removes address books and cards locally.
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
  if (!password) throw new Error('Kein Passwort im Tresor')
  const found = await discoverCardDav(account.server_url, account.username, password, {
    ...deps,
    hints: account.principal_url ? [account.principal_url] : []
  })
  db.prepare(
    `INSERT INTO contacts_accounts (account_id, enabled, home_url) VALUES (?, 1, ?)
     ON CONFLICT(account_id) DO UPDATE SET enabled = 1, home_url = excluded.home_url, error = NULL`
  ).run(accountId, found.homeUrl)
  // Address books and cards are loaded by the next run of the account loop
  calendarSync.refresh(accountId, true)
  return { addressBookCount: found.addressBooks.length }
}

/** Enable/disable a single address book; disabling discards the local cards. */
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
      // Reset token/ctag: re-enabling reloads everything
      db.prepare('UPDATE addressbooks SET ctag = NULL, sync_token = NULL WHERE id = ?').run(
        addressBookId
      )
    }
  })()
  if (enabled) calendarSync.refresh(row.accountId, true)
}
