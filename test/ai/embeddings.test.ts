import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  EMBEDDING_MODEL,
  EmbeddingIndexer,
  PENDING_ROWS_SQL,
  setEmbedBackend,
  type EmbeddingIndexStatus
} from '@main/ai/embeddings'
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

describe('EmbeddingIndexer drain', () => {
  let db: Database.Database
  afterEach(() => {
    setEmbedBackend(null)
    closeTestDb(db)
  })

  function seed(count: number): number[] {
    db = createTestDb()
    const accountId = seedAccount(db)
    const inbox = seedFolder(db, accountId, '\\Inbox')
    const junk = seedFolder(db, accountId, '\\Junk')
    const ids: number[] = []
    for (let i = 0; i < count; i++) {
      const message = upsertEnvelope(
        db,
        accountId,
        i === 0 ? junk : inbox,
        makeEnvelope({ uid: i + 1, messageId: `<drain-${i}@test>`, date: 1_700_000_000_000 + i })
      )!
      storeTestBody(db, message.messageId, `Inhalt ${i}`)
      ids.push(message.messageId)
    }
    return ids
  }

  async function drain(indexer: EmbeddingIndexer): Promise<void> {
    indexer.kick()
    await vi.waitFor(() => expect(indexer.getStatus().running).toBe(false))
  }

  it('embeds pending messages through the backend and marks them indexed', async () => {
    const ids = seed(20)
    const calls: number[] = []
    setEmbedBackend({
      embed: async (texts) => {
        calls.push(texts.length)
        return texts.map(() => new Float32Array(768).fill(0.5))
      }
    })
    const indexer = new EmbeddingIndexer()
    indexer.init(db)
    await drain(indexer)

    // 19 searchable messages (the Junk one is skipped) in batches of 8
    expect(calls).toEqual([8, 8, 3])
    expect(indexer.getStatus()).toMatchObject({ eligible: 19, indexed: 19, pending: 0 })
    expect(db.prepare('SELECT count(*) FROM message_vecs').pluck().get()).toBe(19)
    expect(
      db.prepare('SELECT count(*) FROM message_vecs WHERE rowid = ?').pluck().get(BigInt(ids[0]))
    ).toBe(0)

    // Nothing pending: the next kick does not call the backend
    await drain(indexer)
    expect(calls).toEqual([8, 8, 3])
  })

  it('selects pending states from the partial index', () => {
    seed(3)
    const plan = (
      db.prepare(`EXPLAIN QUERY PLAN ${PENDING_ROWS_SQL}`).all(48) as Array<{ detail: string }>
    )
      .map((row) => row.detail)
      .join('\n')
    expect(plan).toMatch(/SCAN s USING (?:COVERING )?INDEX idx_embed_pending/)
    expect(plan).not.toMatch(/SCAN m\b/)
  })
})

describe('EmbeddingIndexer startup maintenance', () => {
  let db: Database.Database
  afterEach(() => {
    vi.useRealTimers()
    closeTestDb(db)
  })

  it('cleans orphans after startup, not in init', () => {
    db = createTestDb()
    // Orphan: FTS row without a message
    db.prepare(
      `INSERT INTO messages_fts (rowid, subject, sender, recipients, body) VALUES (999, 'x', '', '', '')`
    ).run()
    const ftsRows = (): number =>
      db.prepare('SELECT count(*) FROM messages_fts_docsize WHERE id = 999').pluck().get() as number

    vi.useFakeTimers()
    const indexer = new EmbeddingIndexer()
    indexer.init(db)
    expect(ftsRows()).toBe(1)
    indexer.start()
    vi.advanceTimersByTime(5_000)
    expect(ftsRows()).toBe(0)
    indexer.stop()
  })
})
