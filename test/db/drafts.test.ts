import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { upsertEnvelope } from '@main/mail/ingest'
import { deleteDraft, listDrafts, saveDraft } from '@main/db/repos/drafts'
import { createTestDb, closeTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

function threadKeyOf(db: Database.Database, messageId: number): string {
  return (
    db.prepare('SELECT thread_key FROM messages WHERE id = ?').get(messageId) as {
      thread_key: string
    }
  ).thread_key
}

describe('drafts-repo', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('speichert je Thread einen Entwurf mit Anzeigedaten und überschreibt beim Upsert', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const a = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 1, messageId: '<a@t>', subject: 'Thema A', fromName: 'Alice' })
    )!
    const b = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 2, messageId: '<b@t>', subject: 'Thema B', fromName: 'Bruno' })
    )!
    const keyA = threadKeyOf(db, a.messageId)
    const keyB = threadKeyOf(db, b.messageId)

    saveDraft(db, keyA, 'Hallo Alice,\nkommt sofort.', '<p>x</p>')
    saveDraft(db, keyB, 'Hallo Bruno,\nmelde mich.', '')

    const drafts = listDrafts(db)
    expect(drafts).toHaveLength(2)
    const draftA = drafts.find((d) => d.threadKey === keyA)!
    expect(draftA.displayName).toBe('Alice')
    expect(draftA.subject).toBe('Thema A')
    expect(draftA.text).toContain('kommt sofort')
    expect(draftA.html).toBe('<p>x</p>')

    // Upsert: gleicher Thread überschreibt, statt einen zweiten Eintrag anzulegen
    saveDraft(db, keyA, 'Hallo Alice,\nneuer Stand.', '')
    const after = listDrafts(db)
    expect(after).toHaveLength(2)
    expect(after.find((d) => d.threadKey === keyA)!.text).toContain('neuer Stand')
  })

  it('listet jüngste Entwürfe zuerst', () => {
    db = createTestDb()
    saveDraft(db, 'thread-alt', 'Alter Text', '')
    saveDraft(db, 'thread-neu', 'Neuer Text', '')
    db.prepare('UPDATE drafts SET updated_at = 1000 WHERE thread_key = ?').run('thread-alt')
    db.prepare('UPDATE drafts SET updated_at = 2000 WHERE thread_key = ?').run('thread-neu')
    expect(listDrafts(db).map((d) => d.threadKey)).toEqual(['thread-neu', 'thread-alt'])
  })

  it('kommt ohne bekannte Nachricht aus (Anzeigedaten bleiben null)', () => {
    db = createTestDb()
    saveDraft(db, 'unbekannter-thread', 'Text', '')
    const [draft] = listDrafts(db)
    expect(draft.displayName).toBeNull()
    expect(draft.subject).toBeNull()
  })

  it('löscht Entwürfe und meldet, ob einer existierte', () => {
    db = createTestDb()
    saveDraft(db, 'thread-x', 'Text', '')
    expect(deleteDraft(db, 'thread-x')).toBe(true)
    expect(deleteDraft(db, 'thread-x')).toBe(false)
    expect(listDrafts(db)).toHaveLength(0)
  })
})
