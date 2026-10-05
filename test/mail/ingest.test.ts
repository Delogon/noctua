import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  upsertEnvelope,
  storeBody,
  applyFlagUpdate,
  cleanupSearchOrphans,
  deleteByUids,
  reindexHtmlOnlyMessages
} from '@main/mail/ingest'
import { EMBEDDING_MODEL } from '@main/ai/embeddings'
import { createTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'

describe('upsertEnvelope', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('legt eine neue Nachricht an und vergibt einen thread_key', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 10, subject: 'Hallo' }))
    expect(res?.isNew).toBe(true)
    expect(res?.threadKey).toBeTruthy()
    const count = db.prepare('SELECT count(*) c FROM messages').get() as { c: number }
    expect(count.c).toBe(1)
    const ftsHit = db
      .prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'hallo'`)
      .get() as { rowid: number } | undefined
    expect(ftsHit?.rowid).toBe(res?.messageId)
  })

  it('macht Absender und Empfaenger bereits ohne Body durchsuchbar', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({
        uid: 11,
        subject: 'Plakatiererlaubnis',
        fromName: 'Stadt Oldenburg',
        fromAddr: 'sondernutzung@stadt-oldenburg.de',
        to: [{ name: 'Lena Hartmann', address: 'tim@example.org' }]
      })
    )!

    for (const term of ['oldenburg', 'sondernutzung', 'tim']) {
      const hit = db
        .prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?`)
        .get(term) as { rowid: number } | undefined
      expect(hit?.rowid).toBe(res.messageId)
    }
  })

  it('aktualisiert bei bekannter UID nur die Flags, legt nicht doppelt an', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 10, flags: new Set() }))
    const res = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 10, flags: new Set(['\\Seen']) })
    )
    expect(res?.isNew).toBe(false)
    const row = db
      .prepare('SELECT seen FROM messages WHERE folder_id = ? AND uid = 10')
      .get(folder) as {
      seen: number
    }
    expect(row.seen).toBe(1)
    expect((db.prepare('SELECT count(*) c FROM messages').get() as { c: number }).c).toBe(1)
  })

  it('dedupliziert Gmail-Mails über gm_msgid in einem anderen Ordner', () => {
    db = createTestDb()
    const acc = seedAccount(db, { provider: 'gmail' })
    const inbox = seedFolder(db, acc, '\\Inbox')
    const archive = seedFolder(db, acc, '\\Archive')
    upsertEnvelope(db, acc, inbox, makeEnvelope({ uid: 1, gmMsgid: 'GM1' }))
    const dupe = upsertEnvelope(db, acc, archive, makeEnvelope({ uid: 99, gmMsgid: 'GM1' }))
    expect(dupe).toBeNull() // als Duplikat verworfen
    expect((db.prepare('SELECT count(*) c FROM messages').get() as { c: number }).c).toBe(1)
  })

  it('gruppiert References in denselben thread_key', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const first = upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 1, messageId: '<a@t>' }))
    const reply = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 2, messageId: '<b@t>', inReplyTo: '<a@t>', references: ['<a@t>'] })
    )
    expect(reply?.threadKey).toBe(first?.threadKey)
  })
})

describe('storeBody', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('speichert Text/HTML, füllt den FTS-Index und aktualisiert den Snippet', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 1, subject: 'Rechnung Hetzner' })
    )!

    storeBody(db, res.messageId, {
      messageId: '<m@test>',
      inReplyTo: null,
      references: [],
      subject: 'Rechnung Hetzner',
      from: { name: 'Hetzner', address: 'billing@hetzner.de' },
      to: [],
      cc: [],
      replyTo: [],
      date: 1_700_000_000_000,
      text: 'Ihre monatliche Rechnung über 12,34 Euro.',
      html: null,
      snippet: 'Ihre monatliche Rechnung',
      attachments: []
    })

    const body = db
      .prepare('SELECT text_plain FROM message_bodies WHERE message_id = ?')
      .get(res.messageId) as {
      text_plain: string
    }
    expect(body.text_plain).toContain('12,34')

    const msg = db
      .prepare('SELECT body_state, snippet FROM messages WHERE id = ?')
      .get(res.messageId) as {
      body_state: string
      snippet: string
    }
    expect(msg.body_state).toBe('full')

    const hit = db
      .prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'hetzner'`)
      .get() as { rowid: number } | undefined
    expect(hit?.rowid).toBe(res.messageId)
  })

  it('ersetzt FTS-Inhalt und invalidiert den Vektor bei Body- oder Anhang-Aenderung', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 2, subject: 'Tickets' }))!
    const parsed = {
      messageId: '<tickets@test>',
      inReplyTo: null,
      references: [],
      subject: 'Tickets',
      from: { name: 'Festival', address: 'tickets@example.org' },
      to: [],
      cc: [],
      replyTo: [],
      date: 1_700_000_000_000,
      text: 'Der alte Buchungscode lautet ALTCODE.',
      html: null,
      snippet: 'Der alte Buchungscode',
      attachments: []
    }
    storeBody(db, res.messageId, parsed)
    const state = db
      .prepare('SELECT content_hash FROM message_embedding_state WHERE message_id = ?')
      .get(res.messageId) as { content_hash: string }
    db.prepare('INSERT INTO message_vecs (rowid, embedding) VALUES (?, ?)').run(
      BigInt(res.messageId),
      Buffer.from(new Float32Array(768).buffer)
    )
    db.prepare(
      `UPDATE message_embedding_state
       SET embedded_hash = content_hash, embedding_model = ?, indexed_at = 1
       WHERE message_id = ?`
    ).run(EMBEDDING_MODEL, res.messageId)

    storeBody(db, res.messageId, {
      ...parsed,
      text: 'Der neue Buchungscode lautet NEUCODE.',
      snippet: 'Der neue Buchungscode',
      attachments: [
        {
          filename: 'Airbeat-One-Festivalticket.pdf',
          mimeType: 'application/pdf',
          contentId: null,
          size: 42
        }
      ]
    })

    expect(
      db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'altcode'`).get()
    ).toBeUndefined()
    expect(
      db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'neucode'`).get()
    ).toEqual({ rowid: res.messageId })
    expect(
      db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'airbeat'`).get()
    ).toEqual({ rowid: res.messageId })
    expect(db.prepare('SELECT count(*) count FROM message_vecs').get()).toEqual({ count: 0 })
    expect(
      db
        .prepare(
          `SELECT content_hash, embedded_hash, embedding_model
           FROM message_embedding_state WHERE message_id = ?`
        )
        .get(res.messageId)
    ).toEqual({
      content_hash: expect.not.stringMatching(state.content_hash),
      embedded_hash: null,
      embedding_model: null
    })
  })
})

describe('applyFlagUpdate & deleteByUids', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('applyFlagUpdate setzt seen/flagged anhand der Server-Flags', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 5 }))
    const id = applyFlagUpdate(db, folder, 5, new Set(['\\Seen', '\\Flagged']))
    expect(id).not.toBeNull()
    const row = db.prepare('SELECT seen, flagged FROM messages WHERE id = ?').get(id!) as {
      seen: number
      flagged: number
    }
    expect(row).toEqual({ seen: 1, flagged: 1 })
  })

  it('deleteByUids entfernt genau die genannten UIDs', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 1, messageId: '<1@t>' }))
    upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 2, messageId: '<2@t>' }))
    deleteByUids(db, folder, [1])
    const rows = db.prepare('SELECT uid FROM messages ORDER BY uid').all() as Array<{ uid: number }>
    expect(rows.map((r) => r.uid)).toEqual([2])
  })

  it('bereinigt explizit verwaiste FTS- und Vektorzeilen', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const message = upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 21 }))!
    db.prepare('INSERT INTO message_vecs (rowid, embedding) VALUES (?, ?)').run(
      BigInt(message.messageId),
      Buffer.from(new Float32Array(768).buffer)
    )

    // Virtuelle Tabellen besitzen keine FK-Cascade.
    db.prepare('DELETE FROM messages WHERE id = ?').run(message.messageId)
    expect(db.prepare('SELECT count(*) count FROM messages_fts').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT count(*) count FROM message_vecs').get()).toEqual({ count: 1 })

    expect(cleanupSearchOrphans(db)).toEqual({ fts: 1, vectors: 1, states: 0 })
    expect(db.prepare('SELECT count(*) count FROM messages_fts').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT count(*) count FROM message_vecs').get()).toEqual({ count: 0 })
  })
})

describe('reindexHtmlOnlyMessages (M94)', () => {
  it('re-indexes html-only bodies once and sets the settings flag', () => {
    const db = createTestDb()
    const acc = seedAccount(db, { email: 'lena@test.de' })
    const folder = seedFolder(db, acc, '\\Inbox')
    const res = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 77, messageId: '<html77@t>', subject: 'Nur HTML' })
    )!
    db.prepare('UPDATE messages SET body_state = ? WHERE id = ?').run('full', res.messageId)
    db.prepare(
      'INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, NULL, ?)'
    ).run(
      res.messageId,
      '<html><body><p>' + 'x'.repeat(60) + ' Wattenmeerwanderung im Herbst</p></body></html>'
    )
    // Simulate the migration-021 state: FTS row without the html body text
    db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(res.messageId)
    db.prepare(
      'INSERT INTO messages_fts (rowid, subject, sender, recipients, body) VALUES (?, ?, ?, ?, ?)'
    ).run(res.messageId, 'Nur HTML', '', '', '')

    expect(
      db
        .prepare(`SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH '"wattenmeer"'`)
        .get()
    ).toEqual({ n: 0 })

    expect(reindexHtmlOnlyMessages(db)).toBe(1)
    expect(
      db
        .prepare(`SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH '"wattenmeer"'`)
        .get()
    ).toEqual({ n: 1 })
    // Second run is a no-op thanks to the settings flag
    expect(reindexHtmlOnlyMessages(db)).toBe(0)
    closeTestDb(db)
  })
})
