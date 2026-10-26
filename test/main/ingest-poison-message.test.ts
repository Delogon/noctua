import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, seedAccount, seedFolder } from '../helpers/db'
import { AccountSyncer } from '@main/sync/account-syncer'
import type { AccountRow } from '@main/auth/providers'

const envelope = (uid: number): Record<string, unknown> => ({
  uid,
  flags: new Set<string>(),
  internalDate: new Date(),
  envelope: {
    messageId: `<p${uid}@test>`,
    subject: `Mail ${uid}`,
    from: [{ address: 'a@test.de' }]
  }
})

describe('ingestBatch poison message', () => {
  let db: Database.Database
  let accountId: number
  let inbox: number

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db, { email: 'tim@test.de' })
    inbox = seedFolder(db, accountId, '\\Inbox', 'INBOX')
  })
  afterEach(() => closeTestDb(db))

  it('skips the failing message and keeps the rest of the batch', () => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    const syncer = new AccountSyncer(db, account, async () => ({ user: 'u', pass: 'p' }), {
      onState: () => {},
      onMessagesChanged: () => {}
    })
    const poison = {
      uid: 2,
      get envelope(): never {
        throw new Error('hostile envelope')
      }
    }
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(inbox)
    const keys = (
      syncer as unknown as { ingestBatch: (f: unknown, m: unknown[]) => string[] }
    ).ingestBatch(folder, [envelope(1), poison, envelope(3)])

    expect(keys).toHaveLength(2)
    const uids = db
      .prepare('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid')
      .all(inbox)
      .map((r) => (r as { uid: number }).uid)
    expect(uids).toEqual([1, 3])
  })
})
