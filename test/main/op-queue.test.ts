import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb, closeTestDb, seedAccount, seedFolder } from '../helpers/db'
import {
  enqueueOp,
  processOpQueue,
  OpDeadError,
  MAX_OP_ATTEMPTS,
  type OpExecutor
} from '@main/sync/op-queue'
import { AccountSyncer, isAuthFailure } from '@main/sync/account-syncer'
import type { AccountRow } from '@main/auth/providers'
import type { QueuedOp } from '@main/sync/account-syncer'

interface OpRow {
  id: number
  status: string
  attempts: number
  last_error: string | null
}

describe('Op-Queue (REL-5)', () => {
  let db: Database.Database
  let accountId: number
  let folderId: number
  const push = vi.fn()

  const ops = (): OpRow[] =>
    db.prepare('SELECT id, status, attempts, last_error FROM op_queue ORDER BY id').all() as OpRow[]

  function executor(
    run: (op: QueuedOp) => Promise<void>,
    connected = true
  ): OpExecutor & {
    executeOp: ReturnType<typeof vi.fn>
    invalidateFolder: ReturnType<typeof vi.fn>
  } {
    return {
      executeOp: vi.fn(run),
      isConnected: () => connected,
      invalidateFolder: vi.fn()
    }
  }

  beforeEach(() => {
    db = createTestDb()
    push.mockReset()
    accountId = seedAccount(db)
    folderId = seedFolder(db, accountId, '\\Inbox', 'INBOX')
    db.prepare('UPDATE folders SET uidvalidity = 111 WHERE id = ?').run(folderId)
  })
  afterEach(() => closeTestDb(db))

  it('stempelt die UIDVALIDITY des Ordners beim Einreihen in den Payload', () => {
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [1], add: ['\\Seen'] })
    const row = db.prepare('SELECT payload_json FROM op_queue').get() as { payload_json: string }
    expect(JSON.parse(row.payload_json).uidValidity).toBe(111)
  })

  it('erfolgreiche Op wird gelöscht', async () => {
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [1], add: ['\\Seen'] })
    const syncer = executor(async () => {})
    await processOpQueue(db, accountId, syncer, push)
    expect(ops()).toEqual([])
  })

  it('eine fehlschlagende Op blockiert die folgenden nicht (andere Nachricht)', async () => {
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [1], add: ['\\Seen'] })
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [2], add: ['\\Seen'] })
    const syncer = executor(async (op) => {
      if (op.payload.uids![0] === 1) throw new Error('NO [CANNOT] boom')
    })
    await processOpQueue(db, accountId, syncer, push)
    const rows = ops()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1 })
    expect(rows[0].last_error).toContain('boom')
    expect(syncer.executeOp).toHaveBeenCalledTimes(2)
  })

  it('bewahrt die Reihenfolge je Nachricht: Folge-Op auf dieselbe UID wird übersprungen', async () => {
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [1], add: ['\\Seen'] })
    enqueueOp(db, accountId, 'move', { folderId, uids: [1], targetSpecialUse: '\\Archive' })
    const syncer = executor(async () => {
      throw new Error('NO')
    })
    await processOpQueue(db, accountId, syncer, push)
    expect(syncer.executeOp).toHaveBeenCalledTimes(1)
    expect(ops().map((o) => o.attempts)).toEqual([1, 0])
  })

  it('Verbindungsverlust bricht ab, ohne Versuche zu verbrennen', async () => {
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [1], add: ['\\Seen'] })
    enqueueOp(db, accountId, 'setFlags', { folderId, uids: [2], add: ['\\Seen'] })
    const syncer = executor(async () => {
      throw new Error('Connection not available')
    }, false)
    await processOpQueue(db, accountId, syncer, push)
    expect(syncer.executeOp).toHaveBeenCalledTimes(1)
    expect(ops().map((o) => [o.status, o.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0]
    ])
  })

  it('nach MAX_OP_ATTEMPTS wird die Op dead (nicht gelöscht) und gemeldet', async () => {
    enqueueOp(db, accountId, 'delete', { folderId, uids: [5] })
    db.prepare('UPDATE op_queue SET attempts = ?').run(MAX_OP_ATTEMPTS - 1)
    const syncer = executor(async () => {
      throw new Error('server says no')
    })
    await processOpQueue(db, accountId, syncer, push)
    const [row] = ops()
    expect(row.status).toBe('dead')
    expect(row.last_error).toContain('server says no')
    expect(push).toHaveBeenCalledWith('sync:opsDead', { accountId, count: 1, reason: 'attempts' })
    expect(syncer.invalidateFolder).toHaveBeenCalledWith(folderId)

    // tote Ops werden nicht erneut ausgeführt
    syncer.executeOp.mockClear()
    await processOpQueue(db, accountId, syncer, push)
    expect(syncer.executeOp).not.toHaveBeenCalled()
  })

  it('OpDeadError (z. B. Archiv-/Papierkorb-Ordner fehlt) legt sofort dead ab', async () => {
    enqueueOp(db, accountId, 'move', { folderId, uids: [1], targetSpecialUse: '\\Archive' })
    const syncer = executor(async () => {
      throw new OpDeadError('no-target-folder', 'Zielordner \\Archive nicht gefunden')
    })
    await processOpQueue(db, accountId, syncer, push)
    expect(ops()[0]).toMatchObject({ status: 'dead', attempts: 0 })
    expect(ops()[0].last_error).toContain('no-target-folder')
    expect(push).toHaveBeenCalledWith('sync:opsDead', {
      accountId,
      count: 1,
      reason: 'no-target-folder'
    })
  })

  it('UIDVALIDITY-Mismatch: Op wird nicht ausgeführt, sondern dead', async () => {
    enqueueOp(db, accountId, 'delete', { folderId, uids: [9] })
    // Ordner wurde seit dem Einreihen zurückgesetzt
    db.prepare('UPDATE folders SET uidvalidity = 222 WHERE id = ?').run(folderId)
    const syncer = executor(async () => {})
    await processOpQueue(db, accountId, syncer, push)
    expect(syncer.executeOp).not.toHaveBeenCalled()
    expect(ops()[0].status).toBe('dead')
    expect(push).toHaveBeenCalledWith('sync:opsDead', {
      accountId,
      count: 1,
      reason: 'uidvalidity'
    })
    // Server-Resync wäre sinnlos: der Reset hat den Ordner ohnehin neu aufgebaut
    expect(syncer.invalidateFolder).not.toHaveBeenCalled()
  })

  it('Op ohne UIDVALIDITY-Stempel (Altbestand) läuft unverändert', async () => {
    db.prepare(
      `INSERT INTO op_queue (account_id, kind, payload_json, created_at) VALUES (?, 'setFlags', ?, 1)`
    ).run(accountId, JSON.stringify({ folderId, uids: [1], add: ['\\Seen'] }))
    const syncer = executor(async () => {})
    await processOpQueue(db, accountId, syncer, push)
    expect(syncer.executeOp).toHaveBeenCalledTimes(1)
    expect(ops()).toEqual([])
  })
})

describe('Auth-Fehler-Klassifikation (REL-6)', () => {
  it('erkennt imapflows authenticationFailed', () => {
    expect(
      isAuthFailure(Object.assign(new Error('Invalid credentials'), { authenticationFailed: true }))
    ).toBe(true)
    expect(
      isAuthFailure(Object.assign(new Error('x'), { serverResponseCode: 'AUTHENTICATIONFAILED' }))
    ).toBe(true)
    expect(isAuthFailure(new Error('ECONNRESET'))).toBe(false)
    expect(isAuthFailure(null)).toBe(false)
  })
})

describe('AccountSyncer.executeOp (REL-5d)', () => {
  let db: Database.Database
  let accountId: number
  let folderId: number

  function makeSyncer(provider: string): {
    syncer: AccountSyncer
    cmd: { messageMove: ReturnType<typeof vi.fn>; messageDelete: ReturnType<typeof vi.fn> }
  } {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    const syncer = new AccountSyncer(
      db,
      { ...account, provider },
      async () => ({ user: 'u', pass: 'p' }),
      { onState: () => {}, onMessagesChanged: () => {} }
    )
    const cmd = {
      usable: true,
      mailbox: { uidValidity: 111n },
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      messageMove: vi.fn(async () => true),
      messageDelete: vi.fn(async () => true)
    }
    ;(syncer as unknown as { cmd: unknown }).cmd = cmd
    return { syncer, cmd }
  }

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db)
    folderId = seedFolder(db, accountId, '\\Inbox', 'INBOX')
  })
  afterEach(() => closeTestDb(db))

  it('Archivieren ohne Archiv-Ordner: dead-letter statt stillem Erfolg', async () => {
    const { syncer, cmd } = makeSyncer('imap')
    await expect(
      syncer.executeOp({
        id: 1,
        kind: 'move',
        payload: { folderId, uids: [1], targetSpecialUse: '\\Archive' }
      })
    ).rejects.toMatchObject({ reason: 'no-target-folder' })
    expect(cmd.messageMove).not.toHaveBeenCalled()
  })

  it('Löschen ohne Papierkorb (nicht Gmail) löscht nie hart', async () => {
    const { syncer, cmd } = makeSyncer('imap')
    await expect(
      syncer.executeOp({ id: 1, kind: 'delete', payload: { folderId, uids: [1] } })
    ).rejects.toMatchObject({ reason: 'no-trash' })
    expect(cmd.messageDelete).not.toHaveBeenCalled()
  })

  it('Gmail-Archivieren (delete) bleibt erlaubt', async () => {
    const { syncer, cmd } = makeSyncer('gmail')
    await syncer.executeOp({ id: 1, kind: 'delete', payload: { folderId, uids: [1] } })
    expect(cmd.messageDelete).toHaveBeenCalled()
  })

  it('live abweichende UIDVALIDITY: dead-letter, keine Aktion', async () => {
    seedFolder(db, accountId, '\\Trash', 'Trash')
    const { syncer, cmd } = makeSyncer('imap')
    await expect(
      syncer.executeOp({
        id: 1,
        kind: 'move',
        payload: { folderId, uids: [1], targetSpecialUse: '\\Trash', uidValidity: 999 }
      })
    ).rejects.toMatchObject({ reason: 'uidvalidity' })
    expect(cmd.messageMove).not.toHaveBeenCalled()
  })
})
