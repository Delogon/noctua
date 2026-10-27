import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import { AccountSyncer } from '@main/sync/account-syncer'
import type { AccountRow } from '@main/auth/providers'

// UIDs are only meaningful under the UIDVALIDITY they were synced with: a UID
// fetch after a server-side reset returns a different message.
describe('UIDVALIDITY races on UID fetches', () => {
  let db: Database.Database
  let accountId: number
  let inbox: number

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db, { email: 'tim@test.de' })
    inbox = seedFolder(db, accountId, '\\Inbox', 'INBOX')
  })
  afterEach(() => closeTestDb(db))

  function makeSyncer(cmd: Record<string, unknown>): AccountSyncer {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    const syncer = new AccountSyncer(db, account, async () => ({ user: 'u', pass: 'p' }), {
      onState: () => {},
      onMessagesChanged: () => {}
    })
    ;(syncer as unknown as { cmd: unknown }).cmd = {
      usable: true,
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      ...cmd
    }
    return syncer
  }

  it('does not fetch bodies by UID when the mailbox reports a new UIDVALIDITY', async () => {
    db.prepare('UPDATE folders SET uidvalidity = 100 WHERE id = ?').run(inbox)
    upsertEnvelope(db, accountId, inbox, makeEnvelope({ uid: 1, date: Date.now() }))
    const fetch = vi.fn(async function* () {
      yield* []
    })
    const fetchOne = vi.fn()
    const syncer = makeSyncer({ mailbox: { uidValidity: 200n }, fetch, fetchOne })
    const internals = syncer as unknown as {
      backfillBodies: (folder: unknown) => Promise<void>
    }
    await internals.backfillBodies(db.prepare('SELECT * FROM folders WHERE id = ?').get(inbox))
    const id = db.prepare('SELECT id FROM messages').pluck().get() as number
    expect(await syncer.fetchBody(id)).toBeNull()
    expect(await syncer.fetchRawSource(id)).toBeNull()
    expect(await syncer.fetchMessageHeaders(id)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(fetchOne).not.toHaveBeenCalled()
  })

  it('stamps the folder UIDVALIDITY before the first backfill ingests messages', async () => {
    let stampDuringBackfill: unknown = 'unset'
    const syncer = makeSyncer({
      mailbox: { uidValidity: 7n, uidNext: 1 },
      search: vi.fn(async () => {
        stampDuringBackfill = db
          .prepare('SELECT uidvalidity FROM folders WHERE id = ?')
          .pluck()
          .get(inbox)
        return []
      })
    })
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(inbox)
    await (syncer as unknown as { syncFolder: (f: unknown) => Promise<void> }).syncFolder(folder)
    expect(stampDuringBackfill).toBe(7)
  })
})
