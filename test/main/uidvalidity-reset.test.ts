import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import { resetFolderForUidValidity } from '@main/sync/uidvalidity'

describe('UIDVALIDITY-Reset (REL-3)', () => {
  let db: Database.Database
  let accountId: number
  let folderId: number
  let otherFolderId: number

  const count = (folder: number): number =>
    (
      db.prepare('SELECT count(*) c FROM messages WHERE folder_id = ?').get(folder) as {
        c: number
      }
    ).c
  const folder = (): Record<string, unknown> =>
    db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId) as Record<string, unknown>

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db)
    folderId = seedFolder(db, accountId, '\\Inbox', 'INBOX')
    otherFolderId = seedFolder(db, accountId, '\\Sent', 'Sent')
    db.prepare(
      `UPDATE folders SET uidvalidity = 1, uidnext = 50, envelope_backfill_since = 5,
       body_backfill_since = 6 WHERE id = ?`
    ).run(folderId)
    for (const uid of [1, 2, 3]) {
      upsertEnvelope(db, accountId, folderId, makeEnvelope({ uid, messageId: `<a${uid}@t>` }))
    }
    upsertEnvelope(db, accountId, otherFolderId, makeEnvelope({ uid: 1, messageId: '<s@t>' }))
  })
  afterEach(() => closeTestDb(db))

  it('löscht Nachrichten, speichert neue UIDVALIDITY und setzt Cursor zurück — in einem Schritt', () => {
    resetFolderForUidValidity(db, folderId, 2)
    expect(count(folderId)).toBe(0)
    expect(count(otherFolderId)).toBe(1)
    expect(folder()).toMatchObject({
      uidvalidity: 2,
      uidnext: null,
      envelope_backfill_since: null,
      body_backfill_since: null
    })
  })

  it('ist atomar: scheitert ein Schritt, bleibt alles unverändert', () => {
    // Fehler beim letzten Schritt (UPDATE folders) erzwingen
    db.exec(`
      CREATE TEMP TRIGGER fail_folder_update BEFORE UPDATE ON folders
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `)
    expect(() => resetFolderForUidValidity(db, folderId, 2)).toThrow('boom')
    db.exec('DROP TRIGGER fail_folder_update')

    expect(count(folderId)).toBe(3)
    expect(folder()).toMatchObject({ uidvalidity: 1, uidnext: 50 })
  })

  it('verwirft Alt-Ops ohne UIDVALIDITY-Stempel, gestempelte bleiben der Op-Queue überlassen', () => {
    const insert = db.prepare(
      `INSERT INTO op_queue (account_id, kind, payload_json, created_at) VALUES (?, 'delete', ?, 1)`
    )
    insert.run(accountId, JSON.stringify({ folderId, uids: [1] }))
    insert.run(accountId, JSON.stringify({ folderId, uids: [2], uidValidity: 1 }))
    insert.run(accountId, JSON.stringify({ folderId: otherFolderId, uids: [1] }))
    resetFolderForUidValidity(db, folderId, 2)
    const statuses = db.prepare('SELECT status FROM op_queue ORDER BY id').all()
    expect(statuses).toEqual([{ status: 'dead' }, { status: 'pending' }, { status: 'pending' }])
  })
})
