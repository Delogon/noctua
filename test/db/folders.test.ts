import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import { listFolders, listThreads } from '@main/db/repos/threads'

describe('Ordneransicht', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => closeTestDb(db))

  function userFolder(accountId: number, path: string, syncMode = 'full'): number {
    return Number(
      db
        .prepare(
          `INSERT INTO folders (account_id, path, special_use, sync_mode, delimiter)
           VALUES (?, ?, NULL, ?, '/')`
        )
        .run(accountId, path, syncMode).lastInsertRowid
    )
  }

  it('Spam bleibt aus dem gemeinsamen Posteingang, ist gezielt aber erreichbar', () => {
    const acc = seedAccount(db)
    const inbox = seedFolder(db, acc, '\\Inbox', 'INBOX')
    const junk = seedFolder(db, acc, '\\Junk', 'Junk')
    upsertEnvelope(db, acc, inbox, makeEnvelope({ uid: 1, messageId: '<a@t>', subject: 'Echt' }))
    upsertEnvelope(db, acc, junk, makeEnvelope({ uid: 1, messageId: '<b@t>', subject: 'Gewinn!' }))

    expect(listThreads(db, 50).map((t) => t.subject)).toEqual(['Echt'])
    expect(listThreads(db, 50, undefined, 'spam').map((t) => t.subject)).toEqual(['Gewinn!'])
    expect(listThreads(db, 50, undefined, 'inbox', junk).map((t) => t.subject)).toEqual(['Gewinn!'])
  })

  it('listThreads mit folderId zeigt genau diesen Ordner', () => {
    const acc = seedAccount(db)
    const inbox = seedFolder(db, acc, '\\Inbox', 'INBOX')
    const projects = userFolder(acc, 'Projekte')
    upsertEnvelope(db, acc, inbox, makeEnvelope({ uid: 1, messageId: '<a@t>', subject: 'Post' }))
    upsertEnvelope(
      db,
      acc,
      projects,
      makeEnvelope({ uid: 1, messageId: '<p@t>', subject: 'Roadmap' })
    )

    expect(listThreads(db, 50).map((t) => t.subject)).toEqual(['Post'])
    expect(listThreads(db, 50, acc, 'inbox', projects).map((t) => t.subject)).toEqual(['Roadmap'])
  })

  it('listFolders liefert voll synchronisierte Ordner mit Rolle, Name und Zählern', () => {
    const acc = seedAccount(db)
    const inbox = seedFolder(db, acc, '\\Inbox', 'INBOX')
    seedFolder(db, acc, '\\Junk', 'Junk')
    userFolder(acc, 'Projekte/Q4')
    userFolder(acc, 'Alt', 'off')
    upsertEnvelope(
      db,
      acc,
      inbox,
      makeEnvelope({ uid: 1, messageId: '<a@t>', flags: new Set<string>() })
    )

    const folders = listFolders(db)
    expect(folders.map((f) => [f.path, f.role, f.name])).toEqual([
      ['INBOX', 'inbox', 'INBOX'],
      ['Junk', 'junk', 'Junk'],
      ['Projekte/Q4', 'other', 'Q4']
    ])
    expect(folders[0]).toMatchObject({ threadCount: 1, unreadCount: 1 })
  })
})
