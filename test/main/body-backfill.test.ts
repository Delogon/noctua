import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import {
  AccountSyncer,
  MAX_BACKFILL_BODY_BYTES,
  MAX_BODY_ATTEMPTS,
  pendingBodiesSql
} from '@main/sync/account-syncer'
import type { AccountRow } from '@main/auth/providers'

const source = (uid: number): Buffer =>
  Buffer.from(
    [
      'From: Alice <alice@test.de>',
      'To: tim@test.de',
      `Subject: Mail ${uid}`,
      `Message-ID: <b${uid}@test>`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Body of mail ${uid}`
    ].join('\r\n')
  )

describe('body backfill', () => {
  let db: Database.Database
  let accountId: number
  let inbox: number
  const missing = new Set([7, 19])

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db, { email: 'tim@test.de' })
    inbox = seedFolder(db, accountId, '\\Inbox', 'INBOX')
    for (let uid = 1; uid <= 25; uid++) {
      upsertEnvelope(
        db,
        accountId,
        inbox,
        makeEnvelope({
          uid,
          messageId: `<b${uid}@test>`,
          subject: `Mail ${uid}`,
          date: Date.now() - uid * 60_000,
          internalDate: Date.now() - uid * 60_000
        })
      )
    }
  })
  afterEach(() => closeTestDb(db))

  function makeSyncer(): {
    run: () => Promise<void>
    fetch: ReturnType<typeof vi.fn>
    fetchOne: ReturnType<typeof vi.fn>
    changed: ReturnType<typeof vi.fn>
  } {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    const changed = vi.fn()
    const syncer = new AccountSyncer(db, account, async () => ({ user: 'u', pass: 'p' }), {
      onState: () => {},
      onMessagesChanged: changed
    })
    const fetch = vi.fn(async function* (range: string) {
      for (const uid of range.split(',').map(Number)) {
        if (!missing.has(uid)) yield { uid, source: source(uid) }
      }
    })
    const fetchOne = vi.fn()
    ;(syncer as unknown as { cmd: unknown }).cmd = {
      usable: true,
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      fetch,
      fetchOne
    }
    const internals = syncer as unknown as {
      backfillBodies: (folder: unknown) => Promise<void>
      chain: Promise<unknown>
    }
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(inbox)
    return {
      run: async () => {
        await internals.backfillBodies(folder)
        await internals.chain
      },
      fetch,
      fetchOne,
      changed
    }
  }

  const bodyStates = (): Record<string, number> =>
    Object.fromEntries(
      (
        db
          .prepare('SELECT body_state, count(*) n FROM messages GROUP BY body_state')
          .all() as Array<{ body_state: string; n: number }>
      ).map((r) => [r.body_state, r.n])
    )

  it('fetches one chunk per round trip and stores every body', async () => {
    const syncer = makeSyncer()
    await syncer.run()
    // 25 messages, chunks of 10: three FETCH commands, no per-message fetch
    expect(syncer.fetch).toHaveBeenCalledTimes(3)
    expect(syncer.fetchOne).not.toHaveBeenCalled()
    expect(bodyStates()).toEqual({ full: 23, none: 2 })
    expect(syncer.changed).toHaveBeenCalledTimes(3)
    const body = db
      .prepare(
        `SELECT b.text_plain FROM message_bodies b JOIN messages m ON m.id = b.message_id WHERE m.uid = 3`
      )
      .pluck()
      .get() as string
    expect(body).toContain('Body of mail 3')
    expect(
      db.prepare(`SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'mail'`).pluck().get()
    ).toBeGreaterThanOrEqual(23)
  })

  it('remembers failed fetches and gives up after the attempt limit', async () => {
    const attempts = (): number[] =>
      db
        .prepare('SELECT body_attempts FROM messages WHERE uid IN (7, 19) ORDER BY uid')
        .pluck()
        .all() as number[]
    for (let pass = 1; pass <= MAX_BODY_ATTEMPTS; pass++) {
      await makeSyncer().run()
      expect(attempts()).toEqual([pass, pass])
    }
    const last = makeSyncer()
    await last.run()
    expect(last.fetch).not.toHaveBeenCalled()
    expect(attempts()).toEqual([MAX_BODY_ATTEMPTS, MAX_BODY_ATTEMPTS])
    // Only given-up messages remain: the folder counts as backfilled
    expect(
      db.prepare('SELECT body_backfill_since FROM folders WHERE id = ?').pluck().get(inbox)
    ).not.toBeNull()
  })

  it('leaves oversized messages to on-demand fetch and still finishes the folder', async () => {
    db.prepare('UPDATE messages SET size = ? WHERE uid = 5').run(MAX_BACKFILL_BODY_BYTES + 1)
    const ranges: string[] = []
    // Enough passes for the two failing fetches (7, 19) to hit the attempt limit
    for (let pass = 0; pass < MAX_BODY_ATTEMPTS; pass++) {
      const syncer = makeSyncer()
      await syncer.run()
      ranges.push(...syncer.fetch.mock.calls.map((call) => String(call[0])))
    }
    expect(ranges.join(',').split(',')).not.toContain('5')
    expect(bodyStates()).toEqual({ full: 22, none: 3 })
    expect(
      db.prepare('SELECT body_backfill_since FROM folders WHERE id = ?').pluck().get(inbox)
    ).not.toBeNull()
  })

  it('selects pending messages from the partial index without sorting', () => {
    const plan = (
      db
        .prepare(`EXPLAIN QUERY PLAN ${pendingBodiesSql(2)}`)
        .all(inbox, MAX_BODY_ATTEMPTS, 0, 1, 2, 50) as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join('\n')
    expect(plan).toMatch(/USING INDEX idx_msg_body_pending/)
    expect(plan).not.toMatch(/TEMP B-TREE/)
  })
})
