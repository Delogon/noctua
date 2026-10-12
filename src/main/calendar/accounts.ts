import type Database from 'better-sqlite3-multiple-ciphers'
import { DavClient, discoverCalDav, listCalendars, type DiscoveryResult } from '../dav'
import type { DnsResolver, FetchLike } from '../dav'
import { accountSecretKey, type AccountRow } from '../auth/providers'
import { deleteSecret, getSecret, setSecret } from '../auth/secrets'
import { getCalAccount, calSecretKey } from './repo'
import { calendarSync } from './sync'

/**
 * Calendar accounts: set up (discovery), replace password, test, remove.
 * Credentials live in the vault under `cal:<id>:password`; a mail account only
 * serves as a template (address/host/password), the calendar account stays independent.
 */

export interface AccountDeps {
  fetch?: FetchLike
  dns?: DnsResolver
}

export interface DiscoverRequest {
  serverInput: string
  username: string
  /** May be empty if `mailAccountId` + `reuseMailPassword` are set */
  password?: string
  mailAccountId?: number
  reuseMailPassword?: boolean
}

/** App passwords often come formatted with spaces (as with the mail accounts). */
function cleanPassword(raw: string): string {
  return raw.replace(/\s+/g, '')
}

function resolvePassword(db: Database.Database, req: DiscoverRequest): string {
  if (req.reuseMailPassword && req.mailAccountId !== undefined) {
    const mail = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.mailAccountId) as
      AccountRow | undefined
    if (!mail) throw new Error('Konto nicht gefunden')
    if (mail.credential_type !== 'password' && mail.credential_type !== 'bridge') {
      throw new Error(
        'Dieses Konto meldet sich über den Browser an – bitte gib für den Kalender ein App-Passwort ein'
      )
    }
    const secret = getSecret(accountSecretKey(mail.id))
    if (!secret) throw new Error('Kein Passwort im Tresor für dieses Konto')
    return secret
  }
  const pw = cleanPassword(req.password ?? '')
  if (!pw) throw new Error('Passwort fehlt')
  return pw
}

/** Setup suggestion from a mail account: username = address, server from the domain. */
export function suggestFromMailAccount(
  db: Database.Database,
  mailAccountId: number
): { username: string; serverInput: string; canReusePassword: boolean } {
  const mail = db.prepare('SELECT * FROM accounts WHERE id = ?').get(mailAccountId) as
    AccountRow | undefined
  if (!mail) throw new Error('Konto nicht gefunden')
  return {
    username: mail.email,
    // Discovery resolves address → server (provider table, well-known, SRV)
    serverInput: mail.email,
    canReusePassword: mail.credential_type === 'password' || mail.credential_type === 'bridge'
  }
}

export async function discover(
  db: Database.Database,
  req: DiscoverRequest,
  deps: AccountDeps = {}
): Promise<DiscoveryResult> {
  const password = resolvePassword(db, req)
  return discoverCalDav(req.serverInput, req.username, password, deps)
}

export interface AddAccountRequest extends DiscoverRequest {
  name: string
}

export async function addAccount(
  db: Database.Database,
  req: AddAccountRequest,
  deps: AccountDeps = {}
): Promise<{ accountId: number; calendarCount: number; autoSchedule: boolean }> {
  const password = resolvePassword(db, req)
  const found = await discoverCalDav(req.serverInput, req.username, password, deps)
  const name = req.name.trim() || new URL(found.serverUrl).host

  let accountId = 0
  db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO cal_accounts (name, server_url, principal_url, home_url, username, mail_account_id,
           schedule_inbox_url, schedule_outbox_url, user_addresses, auto_schedule, dav_capabilities,
           state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'off', ?)`
      )
      .run(
        name,
        found.serverUrl,
        found.principalUrl,
        found.homeUrl,
        req.username,
        req.mailAccountId ?? null,
        found.scheduleInboxUrl,
        found.scheduleOutboxUrl,
        JSON.stringify(found.userAddresses),
        found.autoSchedule ? 1 : 0,
        JSON.stringify(found.davCapabilities),
        Date.now()
      )
    accountId = Number(result.lastInsertRowid)
    const insert = db.prepare(
      `INSERT INTO calendars (account_id, url, display_name, color, components, read_only, supports_sync, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    found.calendars.forEach((c, i) =>
      insert.run(
        accountId,
        c.url,
        c.displayName ?? 'Kalender',
        c.color,
        c.components.join(','),
        c.readOnly ? 1 : 0,
        c.supportsSyncCollection ? 1 : 0,
        c.order ?? i
      )
    )
    setSecret(calSecretKey(accountId), password)
  })()
  calendarSync.startAccount(accountId)
  return { accountId, calendarCount: found.calendars.length, autoSchedule: found.autoSchedule }
}

export function updateAccountName(db: Database.Database, accountId: number, name: string): void {
  if (!getCalAccount(db, accountId)) throw new Error('Kalender-Konto nicht gefunden')
  db.prepare('UPDATE cal_accounts SET name = ? WHERE id = ?').run(name.trim(), accountId)
}

/** Check the connection: fetch the calendar list with the stored credentials. */
export async function testAccount(
  db: Database.Database,
  accountId: number,
  deps: AccountDeps = {}
): Promise<{ calendarCount: number; autoSchedule: boolean }> {
  const account = getCalAccount(db, accountId)
  if (!account) throw new Error('Kalender-Konto nicht gefunden')
  const password = getSecret(calSecretKey(accountId))
  if (!password) throw new Error('Kein Passwort im Tresor')
  const client = new DavClient({ username: account.username, password, fetch: deps.fetch })
  const calendars = await listCalendars(client, account.home_url)
  return { calendarCount: calendars.length, autoSchedule: account.auto_schedule === 1 }
}

/** New password: verify first, then save; the sync loop restarts (leaves needs-reauth). */
export async function updateAccountPassword(
  db: Database.Database,
  accountId: number,
  rawPassword: string,
  deps: AccountDeps = {}
): Promise<void> {
  const account = getCalAccount(db, accountId)
  if (!account) throw new Error('Kalender-Konto nicht gefunden')
  const password = cleanPassword(rawPassword)
  if (!password) throw new Error('Passwort fehlt')
  const client = new DavClient({ username: account.username, password, fetch: deps.fetch })
  await listCalendars(client, account.home_url)
  setSecret(calSecretKey(accountId), password)
  calendarSync.restartAccount(accountId)
}

export function removeAccount(db: Database.Database, accountId: number): void {
  calendarSync.stopAccount(accountId)
  db.prepare('DELETE FROM cal_accounts WHERE id = ?').run(accountId)
  deleteSecret(calSecretKey(accountId))
}
