import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import { threadKeyLookupSql } from '@main/mail/threading'
import { CONTACT_DISPLAY_NAME_SQL, rebuildContactStats } from '@main/db/repos/contacts'
import { listThreads, mboxCounts } from '@main/db/repos/threads'
import { searchRowsSql } from '@main/search/semantic'
import { TRIAGE_DISCOVERY_SQL } from '@main/ai/queue'
import {
  CACHE_SIZE_KIB,
  STARTUP_OPTIMIZE_DELAY_MS,
  configureCache,
  optimizeDb,
  startDbMaintenance,
  stopDbMaintenance
} from '@main/db/optimize'

const plan = (db: Database.Database, sql: string, ...params: unknown[]): string =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
    .map((row) => row.detail)
    .join('\n')

const statRows = (db: Database.Database): number =>
  db.prepare(`SELECT count(*) n FROM sqlite_master WHERE name = 'sqlite_stat1'`).pluck().get() === 1
    ? (db.prepare(`SELECT count(*) FROM sqlite_stat1`).pluck().get() as number)
    : 0

describe('planner statistics and cache', () => {
  let db: Database.Database
  let accountId: number

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db, { email: 'tim@test.de' })
    const inbox = seedFolder(db, accountId, '\\Inbox', 'INBOX')
    const sent = seedFolder(db, accountId, '\\Sent', 'Sent')
    const junk = seedFolder(db, accountId, '\\Junk', 'Junk')
    const base = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 400; i++) {
      const folder = i % 10 === 0 ? sent : i % 37 === 0 ? junk : inbox
      const thread = Math.floor(i / 3)
      upsertEnvelope(
        db,
        accountId,
        folder,
        makeEnvelope({
          uid: i + 1,
          messageId: `<m${i}@test>`,
          inReplyTo: i % 3 === 0 ? null : `<m${thread * 3}@test>`,
          references: i % 3 === 0 ? [] : [`<m${thread * 3}@test>`],
          subject: `Thread ${thread}`,
          fromAddr: folder === sent ? 'tim@test.de' : `sender${i % 23}@test.de`,
          fromName: `Sender ${i % 23}`,
          to: [
            { name: 'Tim', address: folder === sent ? `sender${i % 23}@test.de` : 'tim@test.de' }
          ],
          date: base + i * 60_000,
          flags: new Set(i % 4 === 0 ? [] : ['\\Seen'])
        })
      )
    }
  })
  afterEach(() => {
    stopDbMaintenance()
    vi.useRealTimers()
    closeTestDb(db)
  })

  it('sets a 32 MB page cache', () => {
    configureCache(db)
    expect(db.pragma('cache_size', { simple: true })).toBe(-CACHE_SIZE_KIB)
  })

  it('creates sqlite_stat1 on the full optimize', () => {
    expect(statRows(db)).toBe(0)
    optimizeDb(db, true)
    expect(statRows(db)).toBeGreaterThan(0)
    const messages = db
      .prepare(`SELECT count(*) FROM sqlite_stat1 WHERE tbl = 'messages'`)
      .pluck()
      .get() as number
    expect(messages).toBeGreaterThan(0)
  })

  it('keeps the critical index seeks and results once statistics exist', () => {
    const listBefore = listThreads(db, 300, undefined, 'inbox')
    const countsBefore = mboxCounts(db)
    optimizeDb(db, true)

    expect(plan(db, threadKeyLookupSql(2), accountId, '<m0@test>', '<m3@test>')).toMatch(
      /SEARCH messages USING INDEX idx_msg_account_msgid \(account_id=\? AND message_id=\?\)/
    )
    rebuildContactStats(db, accountId)
    expect(plan(db, CONTACT_DISPLAY_NAME_SQL, accountId)).toMatch(
      /SEARCH m USING (?:COVERING )?INDEX idx_msg_from_addr_lower/
    )
    expect(plan(db, TRIAGE_DISCOVERY_SQL, 0, 1)).toMatch(/SEARCH m USING INDEX idx_msg_folder_date/)
    expect(listThreads(db, 300, undefined, 'inbox')).toEqual(listBefore)
    expect(mboxCounts(db)).toEqual(countsBefore)
  })

  it('keeps search result lookups on rowid seeks even with skewed statistics', () => {
    // Sampled statistics once claimed ~400 messages per account in a
    // single-account mailbox; the id-list lookup then walked whole accounts.
    optimizeDb(db, true)
    db.exec(`DELETE FROM sqlite_stat1 WHERE tbl = 'messages'`)
    const insert = db.prepare(`INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES ('messages', ?, ?)`)
    insert.run('idx_msg_account_msgid', '20000 401 1')
    insert.run('idx_msg_inbox', '20000 401 401 1')
    insert.run('sqlite_autoindex_messages_1', '20000 401 1')
    insert.run('idx_msg_thread', '20000 3 1')
    db.exec('ANALYZE sqlite_schema')
    const ids = Array.from({ length: 200 }, (_, i) => i + 1)
    const detail = plan(db, searchRowsSql(ids.length), ...ids)
    expect(detail).toMatch(/SEARCH m USING INTEGER PRIMARY KEY \(rowid=\?\)/)
    expect(detail).not.toMatch(/SEARCH m USING INDEX/)
  })

  it('skips the FTS and vector shadow tables', () => {
    expect(optimizeDb(db, true)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(messages_fts|message_vecs)_/)])
    )
    expect(
      db
        .prepare(
          `SELECT count(*) FROM sqlite_stat1 WHERE tbl LIKE 'messages_fts%' OR tbl LIKE 'message_vecs%'`
        )
        .pluck()
        .get()
    ).toBe(0)
  })

  it('runs the first optimize after the startup delay, not right away', () => {
    vi.useFakeTimers()
    startDbMaintenance(db)
    expect(statRows(db)).toBe(0)
    vi.advanceTimersByTime(STARTUP_OPTIMIZE_DELAY_MS)
    expect(statRows(db)).toBeGreaterThan(0)
  })
})
