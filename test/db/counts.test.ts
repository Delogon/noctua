import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { applyFlagUpdates, upsertEnvelope } from '@main/mail/ingest'
import { LIST_FOLDERS_SQL, MBOX_COUNT_SQL, listFolders, mboxCounts } from '@main/db/repos/threads'

// Reference: the previous queries, which joined from messages
const referenceCount = (db: Database.Database, special: string, accountId?: number): number =>
  db
    .prepare(
      `SELECT count(DISTINCT m.thread_key) FROM messages m
       JOIN folders f ON m.folder_id = f.id
       WHERE f.special_use = ? AND (? IS NULL OR m.account_id = ?)`
    )
    .pluck()
    .get(special, accountId ?? null, accountId ?? null) as number

const plan = (db: Database.Database, sql: string, ...params: unknown[]): string =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
    .map((row) => row.detail)
    .join('\n')

describe('thread and unread counts', () => {
  let db: Database.Database
  let accounts: number[]
  let inboxes: number[]

  beforeEach(() => {
    db = createTestDb()
    accounts = [seedAccount(db, { email: 'a@test.de' }), seedAccount(db, { email: 'b@test.de' })]
    inboxes = []
    let uid = 0
    for (const [n, account] of accounts.entries()) {
      const inbox = seedFolder(db, account, '\\Inbox', 'INBOX')
      const sent = seedFolder(db, account, '\\Sent', 'Sent')
      const junk = seedFolder(db, account, '\\Junk', 'Junk')
      inboxes.push(inbox)
      for (let i = 0; i < 30 + n * 7; i++) {
        uid += 1
        const folder = i % 5 === 0 ? sent : i % 11 === 0 ? junk : inbox
        // Replies share a thread, also across Inbox and Sent
        const root = `<r${n}-${Math.floor(i / 3)}@test>`
        upsertEnvelope(
          db,
          account,
          folder,
          makeEnvelope({
            uid,
            messageId: i % 3 === 0 ? root : `<m${uid}@test>`,
            inReplyTo: i % 3 === 0 ? null : root,
            references: i % 3 === 0 ? [] : [root],
            date: 1_700_000_000_000 + uid * 60_000,
            flags: new Set(i % 4 === 0 ? [] : ['\\Seen'])
          })
        )
      }
    }
  })
  afterEach(() => closeTestDb(db))

  it('match the previous queries for all mailboxes and account filters', () => {
    for (const accountId of [undefined, ...accounts]) {
      expect(mboxCounts(db, accountId)).toEqual({
        inbox: referenceCount(db, '\\Inbox', accountId),
        sent: referenceCount(db, '\\Sent', accountId),
        spam: referenceCount(db, '\\Junk', accountId)
      })
    }
    expect(mboxCounts(db).inbox).toBeGreaterThan(mboxCounts(db, accounts[0]).inbox)
  })

  it('follow seen/unseen changes in the folder list', () => {
    const inbox = (): { threadCount: number; unreadCount: number } =>
      listFolders(db).find((f) => f.id === inboxes[0])!
    const before = inbox()
    expect(before.unreadCount).toBeGreaterThan(0)

    const uids = db
      .prepare('SELECT uid FROM messages WHERE folder_id = ? AND seen = 0')
      .pluck()
      .all(inboxes[0]) as number[]
    applyFlagUpdates(
      db,
      inboxes[0],
      uids.map((uid) => ({ uid, flags: new Set(['\\Seen']) }))
    )
    expect(inbox()).toMatchObject({ threadCount: before.threadCount, unreadCount: 0 })

    applyFlagUpdates(db, inboxes[0], [{ uid: uids[0], flags: new Set<string>() }])
    expect(inbox().unreadCount).toBe(1)
  })

  it('read only the covering index, also without planner statistics', () => {
    expect(plan(db, MBOX_COUNT_SQL, '\\Inbox', null, null)).toMatch(
      /SEARCH m USING COVERING INDEX idx_msg_folder_thread \(folder_id=\?\)/
    )
    expect(plan(db, LIST_FOLDERS_SQL)).toMatch(
      /SEARCH m USING COVERING INDEX idx_msg_folder_thread \(folder_id=\?\)/
    )
  })
})
