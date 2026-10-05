import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { EMBEDDING_MODEL, EmbeddingIndexer, type EmbeddingIndexStatus } from '@main/ai/embeddings'
import { storeBody, upsertEnvelope } from '@main/mail/ingest'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

function storeTestBody(db: Database.Database, messageId: number, text: string): void {
  storeBody(db, messageId, {
    messageId: `<${messageId}@test>`,
    inReplyTo: null,
    references: [],
    subject: 'Suchtest',
    from: { name: 'Test', address: 'test@example.org' },
    to: [],
    cc: [],
    replyTo: [],
    date: Date.now(),
    text,
    html: null,
    snippet: text,
    attachments: []
  })
}

describe('EmbeddingIndexer status', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('zaehlt eligible, indexed und pending nur fuer Eingang, Gesendet und Archiv', () => {
    db = createTestDb()
    const accountId = seedAccount(db)
    const folders = [
      seedFolder(db, accountId, '\\Inbox'),
      seedFolder(db, accountId, '\\Sent'),
      seedFolder(db, accountId, '\\Archive'),
      seedFolder(db, accountId, '\\Junk')
    ]
    const messageIds = folders.map((folderId, index) => {
      const message = upsertEnvelope(
        db,
        accountId,
        folderId,
        makeEnvelope({ uid: index + 1, messageId: `<status-${index}@test>` })
      )!
      storeTestBody(db, message.messageId, `Inhalt ${index}`)
      return message.messageId
    })
    const indexer = new EmbeddingIndexer()
    indexer.init(db)

    expect(indexer.getStatus()).toEqual<EmbeddingIndexStatus>({
      eligible: 3,
      indexed: 0,
      pending: 3,
      running: false,
      model: { id: EMBEDDING_MODEL, state: 'not_loaded', cached: expect.any(Boolean), error: null }
    })

    const current = db
      .prepare('SELECT content_hash FROM message_embedding_state WHERE message_id = ?')
      .get(messageIds[0]) as { content_hash: string }
    db.prepare('INSERT INTO message_vecs (rowid, embedding) VALUES (?, ?)').run(
      BigInt(messageIds[0]),
      Buffer.from(new Float32Array(768).buffer)
    )
    db.prepare(
      `UPDATE message_embedding_state
       SET embedded_hash = ?, embedding_model = ?, indexed_at = ?
       WHERE message_id = ?`
    ).run(current.content_hash, EMBEDDING_MODEL, Date.now(), messageIds[0])

    expect(indexer.getStatus()).toMatchObject({ eligible: 3, indexed: 1, pending: 2 })
  })

  it('wertet einen Vektor mit falschem Modell oder altem Hash nicht als indexiert', () => {
    db = createTestDb()
    const accountId = seedAccount(db)
    const inbox = seedFolder(db, accountId, '\\Inbox')
    const message = upsertEnvelope(db, accountId, inbox, makeEnvelope({ uid: 1 }))!
    storeTestBody(db, message.messageId, 'Eine Plakatiererlaubnis der Stadt')
    db.prepare('INSERT INTO message_vecs (rowid, embedding) VALUES (?, ?)').run(
      BigInt(message.messageId),
      Buffer.from(new Float32Array(768).buffer)
    )
    db.prepare(
      `UPDATE message_embedding_state
       SET embedded_hash = content_hash, embedding_model = 'altes-modell', indexed_at = 1
       WHERE message_id = ?`
    ).run(message.messageId)

    const indexer = new EmbeddingIndexer()
    indexer.init(db)
    expect(indexer.getStatus()).toMatchObject({ eligible: 1, indexed: 0, pending: 1 })
  })
})
