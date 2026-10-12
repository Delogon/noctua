import type Database from 'better-sqlite3-multiple-ciphers'
import {
  DavAuthError,
  DavClient,
  DavHttpError,
  listAddressBooks,
  multigetCards,
  queryCardEtags,
  syncCollection,
  SyncTokenInvalidError,
  type DavAddressBookInfo
} from '../dav'
import type { CalAccountRow } from '../calendar/repo'
import {
  deleteContactByHref,
  getContactsAccount,
  upsertContact,
  type AddressBookRow,
  type ContactsAccountRow
} from './repo'

/**
 * Sync der CardDAV-Adressbücher (nur lesend), eingehängt in die Konto-Schleife
 * des Kalenders: gleiche Zugangsdaten, gleicher Backoff, needs-reauth wird über
 * DavAuthError geteilt. Pro Adressbuch: ctag prüfen, dann sync-collection
 * (RFC 6578) oder — ohne Unterstützung/bei ungültigem Token — ETag-Vergleich
 * mit addressbook-multiget.
 */

export interface ContactsSyncContext {
  db: Database.Database
  client: DavClient
  onChanged: (accountId: number) => void
}

const MAX_SYNC_PAGES = 50
/** Obergrenze je Adressbuch; darüber wird abgeschnitten, damit die DB nicht explodiert */
export const MAX_CONTACTS_PER_BOOK = 50_000

interface Collected {
  mode: 'full' | 'delta'
  entries: Map<string, string | null>
  removed: Set<string>
  syncToken: string | null
}

function lastSegment(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? 'Kontakte')
}

/** Adressbuchliste des Servers abgleichen (neue → aktiviert, verschwundene → entfernt). */
export async function refreshAddressBooks(
  ctx: ContactsSyncContext,
  account: CalAccountRow,
  homeUrl: string
): Promise<Array<{ row: AddressBookRow; info: DavAddressBookInfo }>> {
  const { db } = ctx
  const infos = await listAddressBooks(ctx.client, homeUrl)
  const existing = db
    .prepare('SELECT * FROM addressbooks WHERE account_id = ?')
    .all(account.id) as AddressBookRow[]
  const byUrl = new Map(existing.map((b) => [b.url, b]))
  db.transaction(() => {
    for (const info of infos) {
      const name = info.displayName ?? lastSegment(info.url)
      const current = byUrl.get(info.url)
      if (!current) {
        db.prepare(
          `INSERT INTO addressbooks (account_id, url, display_name, supports_sync, enabled)
           VALUES (?, ?, ?, ?, 1)`
        ).run(account.id, info.url, name, info.supportsSyncCollection ? 1 : 0)
      } else {
        db.prepare('UPDATE addressbooks SET display_name = ?, supports_sync = ? WHERE id = ?').run(
          name,
          info.supportsSyncCollection ? 1 : 0,
          current.id
        )
      }
    }
    // Leere Antwort = Server-Aussetzer: nichts löschen
    if (infos.length > 0) {
      const present = new Set(infos.map((i) => i.url))
      for (const b of existing) {
        if (!present.has(b.url)) db.prepare('DELETE FROM addressbooks WHERE id = ?').run(b.id)
      }
    }
  })()
  return infos.map((info) => ({
    info,
    row: db
      .prepare('SELECT * FROM addressbooks WHERE account_id = ? AND url = ?')
      .get(account.id, info.url) as AddressBookRow
  }))
}

async function collectChanges(
  ctx: ContactsSyncContext,
  book: AddressBookRow,
  info: DavAddressBookInfo
): Promise<Collected> {
  if (info.supportsSyncCollection || book.supports_sync === 1) {
    let token = book.sync_token
    for (let attempt = 0; attempt < 2; attempt++) {
      const entries = new Map<string, string | null>()
      const removed = new Set<string>()
      const mode: 'full' | 'delta' = token ? 'delta' : 'full'
      try {
        for (let page = 0; page < MAX_SYNC_PAGES; page++) {
          const res = await syncCollection(ctx.client, book.url, token)
          for (const e of res.changed) {
            entries.set(e.href, e.etag)
            removed.delete(e.href)
          }
          for (const href of res.removed) {
            removed.add(href)
            entries.delete(href)
          }
          if (res.syncToken) token = res.syncToken
          if (!res.truncated) return { mode, entries, removed, syncToken: token }
        }
        break
      } catch (error) {
        if (error instanceof SyncTokenInvalidError && book.sync_token && attempt === 0) {
          token = null
          continue
        }
        if (
          error instanceof DavHttpError &&
          [400, 403, 404, 405, 415, 501].includes(error.status)
        ) {
          ctx.db.prepare('UPDATE addressbooks SET supports_sync = 0 WHERE id = ?').run(book.id)
          break
        }
        throw error
      }
    }
  }
  const list = await queryCardEtags(ctx.client, book.url)
  return {
    mode: 'full',
    entries: new Map(list.map((e) => [e.href, e.etag])),
    removed: new Set(),
    syncToken: null
  }
}

/** Gleicht ein Adressbuch ab. Rückgabe: true, wenn sich lokale Daten geändert haben. */
export async function syncAddressBook(
  ctx: ContactsSyncContext,
  book: AddressBookRow,
  info: DavAddressBookInfo,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  const { db } = ctx
  const unchanged =
    (info.ctag !== null && info.ctag === book.ctag) ||
    (info.ctag === null && info.syncToken !== null && info.syncToken === book.sync_token)
  if (unchanged && !opts.force) return false

  const collected = await collectChanges(ctx, book, info)
  const local = new Map(
    (
      db
        .prepare('SELECT href, etag FROM dav_contacts WHERE addressbook_id = ?')
        .all(book.id) as Array<{ href: string; etag: string | null }>
    ).map((c) => [c.href, c.etag])
  )

  const toFetch: string[] = []
  for (const [href, etag] of collected.entries) {
    if (!local.has(href) || etag === null || local.get(href) !== etag) toFetch.push(href)
  }
  const budget = Math.max(0, MAX_CONTACTS_PER_BOOK - local.size)
  const fetched = toFetch.length > 0 ? await multigetCards(ctx.client, book.url, toFetch) : []

  let changed = false
  db.transaction(() => {
    let added = 0
    for (const card of fetched) {
      const isNew = !local.has(card.href)
      if (isNew && added >= budget) continue
      const listedEtag = collected.entries.get(card.href) ?? null
      if (
        upsertContact(db, {
          addressBookId: book.id,
          href: card.href,
          etag: card.etag ?? listedEtag,
          vcard: card.vcard
        })
      ) {
        if (isNew) added += 1
      }
      changed = true
    }
    const gone: string[] =
      collected.mode === 'full'
        ? [...local.keys()].filter((href) => !collected.entries.has(href))
        : [...collected.removed].filter((href) => local.has(href))
    for (const href of gone) {
      if (deleteContactByHref(db, book.id, href)) changed = true
    }
    db.prepare('UPDATE addressbooks SET ctag = ?, sync_token = ?, last_sync = ? WHERE id = ?').run(
      info.ctag,
      collected.syncToken,
      Date.now(),
      book.id
    )
  })()
  return changed
}

/** Kompletter Kontakt-Lauf eines Kontos. Auth-Fehler werden weitergereicht, alles andere nur vermerkt. */
export async function syncAccountContacts(
  ctx: ContactsSyncContext,
  account: CalAccountRow,
  opts: { force?: boolean } = {}
): Promise<void> {
  const state: ContactsAccountRow | undefined = getContactsAccount(ctx.db, account.id)
  if (!state || state.enabled !== 1 || !state.home_url) return
  const { db } = ctx
  let changed = false
  let firstError: Error | null = null
  try {
    const books = await refreshAddressBooks(ctx, account, state.home_url)
    for (const { row, info } of books) {
      if (row.enabled !== 1) continue
      try {
        if (await syncAddressBook(ctx, row, info, opts)) changed = true
      } catch (error) {
        if (error instanceof DavAuthError) throw error
        // Ein defektes Adressbuch hält die übrigen nicht auf
        firstError ??= new Error(
          `„${row.display_name}“: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    if (firstError) throw firstError
    db.prepare('UPDATE contacts_accounts SET error = NULL, last_sync = ? WHERE account_id = ?').run(
      Date.now(),
      account.id
    )
  } catch (error) {
    if (error instanceof DavAuthError) throw error
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[contacts:${account.name}] ${message}`)
    db.prepare('UPDATE contacts_accounts SET error = ? WHERE account_id = ?').run(
      message.slice(0, 500),
      account.id
    )
  }
  if (changed) ctx.onChanged(account.id)
}
