import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  buildFtsMatch,
  queryTerms,
  semanticSearch,
  type SemanticSearchDependencies
} from '@main/search/semantic'
import { dedupeByThread, reciprocalRankFusion } from '@main/search/ranking'
import { closeTestDb, createTestDb, seedAccount, seedFolder } from '../helpers/db'
import { foldSharpS } from '@main/search/fold'

interface SeedMail {
  accountId: number
  folderId: number
  uid: number
  threadKey: string
  subject: string
  body: string
  fromName?: string
  fromAddr?: string
  draft?: boolean
  date?: number
}

function seedMail(db: Database.Database, mail: SeedMail): number {
  const result = db
    .prepare(
      `INSERT INTO messages (
         account_id, folder_id, uid, message_id, thread_key, subject,
         from_addr, from_name, to_json, cc_json, date, internal_date,
         draft, snippet, body_state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, 'full')`
    )
    .run(
      mail.accountId,
      mail.folderId,
      mail.uid,
      `<${mail.uid}-${mail.threadKey}@test>`,
      mail.threadKey,
      mail.subject,
      mail.fromAddr ?? 'sender@example.org',
      mail.fromName ?? 'Absender',
      mail.date ?? 1_720_000_000_000 + mail.uid,
      mail.date ?? 1_720_000_000_000 + mail.uid,
      mail.draft ? 1 : 0,
      mail.body.slice(0, 200)
    )
  const messageId = Number(result.lastInsertRowid)
  db.prepare('INSERT INTO message_bodies (message_id, text_plain) VALUES (?, ?)').run(
    messageId,
    mail.body
  )
  db.prepare(
    `INSERT INTO messages_fts (rowid, subject, sender, recipients, body)
     VALUES (?, ?, ?, '', ?)`
  ).run(
    messageId,
    foldSharpS(mail.subject),
    foldSharpS(`${mail.fromName ?? 'Absender'} ${mail.fromAddr ?? 'sender@example.org'}`),
    foldSharpS(mail.body)
  )
  return messageId
}

function vector(fill: number): Float32Array {
  return new Float32Array(768).fill(fill)
}

function indexVector(db: Database.Database, messageId: number, embedding: Float32Array): void {
  db.prepare('INSERT INTO message_vecs (rowid, embedding) VALUES (?, ?)').run(
    BigInt(messageId),
    Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)
  )
}

describe('semantic search ranking', () => {
  it('verbindet unabhängige Ränge per RRF statt Rohscores zu vermischen', () => {
    const ranked = reciprocalRankFusion([
      { signal: 'fulltext', messageIds: [1, 2, 4] },
      { signal: 'semantic', messageIds: [2, 3, 4] }
    ])

    expect(ranked[0]).toMatchObject({ messageId: 2, signals: ['fulltext', 'semantic'] })
    expect(ranked.find((row) => row.messageId === 1)?.signals).toEqual(['fulltext'])
  })

  it('collapses ranked messages per thread, keeping rank order', () => {
    expect(
      dedupeByThread(
        [
          { id: 11, threadKey: 'a', date: 3 },
          { id: 12, threadKey: 'a', date: 1 },
          { id: 21, threadKey: 'b', date: 2 }
        ],
        10
      )
    ).toEqual([
      { id: 11, threadKey: 'a', date: 3 },
      { id: 21, threadKey: 'b', date: 2 }
    ])
  })

  it('shows the newest matching message of a thread, not the bm25 winner', () => {
    // Regression (Tim, 2026-07-20): a long March forward outranked the fresh
    // Friday mail and masked it in the results.
    expect(
      dedupeByThread(
        [
          { id: 460, threadKey: 'gm:186', date: 1741181331000 },
          { id: 2686, threadKey: 'gm:186', date: 1784303254000 },
          { id: 21, threadKey: 'b', date: 5 }
        ],
        10
      )
    ).toEqual([
      { id: 2686, threadKey: 'gm:186', date: 1784303254000 },
      { id: 21, threadKey: 'b', date: 5 }
    ])
  })

  it('respects the limit by thread position, not by representative choice', () => {
    expect(
      dedupeByThread(
        [
          { id: 1, threadKey: 'a', date: 1 },
          { id: 2, threadKey: 'b', date: 9 },
          { id: 3, threadKey: 'a', date: 7 }
        ],
        1
      )
    ).toEqual([{ id: 3, threadKey: 'a', date: 7 }])
  })

  it('entfernt Frage-Füllwörter und baut eine fehlertolerante OR-Prefix-Suche', () => {
    expect(
      queryTerms('In welcher E-Mail habe ich meine Tickets für das Airbeat Festival bekommen?')
    ).toEqual(['tickets', 'airbeat', 'festival', 'bekommen'])
    expect(buildFtsMatch('Airbeat Festival')).toBe('"airbeat" OR "festival"')
    // trigram era: ß→ss fold, terms shorter than three characters are dropped
    expect(buildFtsMatch('Straße')).toBe('"strasse"')
    expect(buildFtsMatch('VW')).toBe('')
  })
})

describe('semanticSearch', () => {
  let db: Database.Database
  afterEach(() => {
    vi.restoreAllMocks()
    if (db) closeTestDb(db)
  })

  it('findet Absender trotz Tippfehler über den Sender-Kanal (M92)', async () => {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'tim@example.org' })
    const inbox = seedFolder(db, accountId, '\\Inbox')
    seedMail(db, {
      accountId,
      folderId: inbox,
      uid: 51,
      threadKey: 'stadt',
      subject: 'AW: Aufstellung von Großflächentafeln',
      body: 'Standortliste im Anhang.',
      fromName: 'Bütefisch, Jens',
      fromAddr: 'Jens.Buetefisch@stadt.example'
    })

    const result = await semanticSearch(
      db,
      { q: 'was ist die letzte mail von jens buetfisch', limit: 5 },
      { embedQuery: async () => [] }
    )
    const hit = result.hits.find((h) => h.threadKey === 'stadt')
    expect(hit).toBeTruthy()
    expect(hit!.signals).toContain('sender')
  })

  it('findet Substrings in Komposita und faltet ß/ss (M91)', async () => {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'tim@example.org' })
    const inbox = seedFolder(db, accountId, '\\Inbox')
    seedMail(db, {
      accountId,
      folderId: inbox,
      uid: 41,
      threadKey: 'tafeln',
      subject: 'AW: Aufstellung von Großflächentafeln',
      body: 'Hier können Sie die Standortliste noch einmal herunterladen.',
      fromName: 'Jens B.',
      fromAddr: 'verwaltung@stadt.example'
    })

    // compound substring: "Tafeln" is not a token prefix of the subject word
    const compound = await semanticSearch(
      db,
      { q: 'Tafeln', limit: 5 },
      { embedQuery: async () => [] }
    )
    expect(compound.hits.map((h) => h.threadKey)).toContain('tafeln')

    // ss query finds ß text (both sides are folded identically)
    const folded = await semanticSearch(
      db,
      { q: 'grossflächentafeln', limit: 5 },
      { embedQuery: async () => [] }
    )
    expect(folded.hits.map((h) => h.threadKey)).toContain('tafeln')
  })

  it('kombiniert BM25 und sqlite-vec lokal, liefert Belegnachrichten und filtert private Ordner', async () => {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'tim@example.org' })
    const inbox = seedFolder(db, accountId, '\\Inbox')
    const junk = seedFolder(db, accountId, '\\Junk')
    const drafts = seedFolder(db, accountId, '\\Drafts')

    const ticket = seedMail(db, {
      accountId,
      folderId: inbox,
      uid: 1,
      threadKey: 'tickets',
      subject: 'Deine Airbeat One Unterlagen',
      body: 'Im Anhang findest du deine beiden Festival-Tickets und Informationen zum Einlass.',
      fromName: 'Airbeat One',
      fromAddr: 'tickets@airbeat-one.de'
    })
    const unrelated = seedMail(db, {
      accountId,
      folderId: inbox,
      uid: 2,
      threadKey: 'other',
      subject: 'Sommerfest im Büro',
      body: 'Wir treffen uns am Freitag im Innenhof.'
    })
    const junkHit = seedMail(db, {
      accountId,
      folderId: junk,
      uid: 3,
      threadKey: 'junk',
      subject: 'Airbeat Festival Tickets',
      body: 'Airbeat Festival Tickets gratis gewinnen.'
    })
    const draftHit = seedMail(db, {
      accountId,
      folderId: drafts,
      uid: 4,
      threadKey: 'draft',
      subject: 'Airbeat Tickets',
      body: 'Mein Entwurf zu den Tickets.',
      draft: true
    })

    indexVector(db, ticket, vector(0))
    indexVector(db, unrelated, vector(1))
    indexVector(db, junkHit, vector(0))
    indexVector(db, draftHit, vector(0))

    const result = await semanticSearch(
      db,
      {
        q: 'In welcher E-Mail habe ich meine Tickets für das Airbeat Festival bekommen?',
        limit: 10,
        accountId
      },
      { embedQuery: async () => [vector(0)] }
    )

    expect(result.mode).toBe('hybrid')
    expect(result.hits[0]).toMatchObject({
      messageId: ticket,
      threadKey: 'tickets',
      accountId,
      accountName: expect.any(String),
      mailbox: 'inbox',
      confidence: 'clear'
    })
    expect(result.hits[0].signals).toEqual(
      expect.arrayContaining(['fulltext', 'semantic', 'subject', 'sender'])
    )
    expect(result.hits[0].excerpt).toContain('Festival-Tickets')
    expect(result.hits.map((hit) => hit.messageId)).not.toContain(junkHit)
    expect(result.hits.map((hit) => hit.messageId)).not.toContain(draftHit)
    expect(result.index).toMatchObject({
      totalMessages: 2,
      searchableMessages: 2,
      embeddedMessages: 2,
      ready: true
    })
    expect(result.index.coverage).toBe(1)
  })

  it('fällt bei einem Embedding-Fehler transparent auf FTS zurück', async () => {
    db = createTestDb()
    const accountId = seedAccount(db)
    const inbox = seedFolder(db, accountId, '\\Inbox')
    const permit = seedMail(db, {
      accountId,
      folderId: inbox,
      uid: 10,
      threadKey: 'permit',
      subject: 'Sondernutzungserlaubnis Plakatierung',
      body: 'Die Stadt Oldenburg erteilt die beantragte Plakatiererlaubnis.',
      fromName: 'Stadt Oldenburg'
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const dependencies: SemanticSearchDependencies = {
      embedQuery: async () => {
        throw new Error('Modell offline')
      },
      vectorCandidates: () => {
        throw new Error('darf ohne Embedding nicht laufen')
      }
    }
    const result = await semanticSearch(
      db,
      { q: 'Wann schrieb die Stadt Oldenburg wegen der Plakatiererlaubnis?', limit: 5 },
      dependencies
    )

    expect(result.mode).toBe('fulltext')
    expect(result.hits[0]).toMatchObject({ messageId: permit, threadKey: 'permit' })
    expect(result.hits[0].signals).toContain('fulltext')
  })

  it('beschränkt Treffer und Indexstatus auf das gewählte Konto', async () => {
    db = createTestDb()
    const firstAccount = seedAccount(db)
    const secondAccount = seedAccount(db)
    const firstInbox = seedFolder(db, firstAccount, '\\Inbox')
    const secondInbox = seedFolder(db, secondAccount, '\\Inbox')
    const firstMail = seedMail(db, {
      accountId: firstAccount,
      folderId: firstInbox,
      uid: 20,
      threadKey: 'first',
      subject: 'Bahnticket Berlin',
      body: 'Deine Fahrkarte nach Berlin.'
    })
    seedMail(db, {
      accountId: secondAccount,
      folderId: secondInbox,
      uid: 21,
      threadKey: 'second',
      subject: 'Bahnticket Hamburg',
      body: 'Deine Fahrkarte nach Hamburg.'
    })

    const result = await semanticSearch(
      db,
      { q: 'Wo ist mein Bahnticket?', limit: 5, accountId: firstAccount },
      {
        embedQuery: async () => {
          throw new Error('FTS-only test')
        }
      }
    )

    expect(result.hits.map((hit) => hit.messageId)).toEqual([firstMail])
    expect(result.index.totalMessages).toBe(1)
    expect(result.index.searchableMessages).toBe(1)
  })
})
