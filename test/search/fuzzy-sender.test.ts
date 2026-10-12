import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  GENERIC_TOKENS,
  allowedDistance,
  boundedLevenshtein,
  fuzzySenderMatches,
  normalizeToken,
  senderTokens,
  type FuzzySenderMatch,
  type SenderRow,
  fuzzySenderMessageIds,
  fuzzySenderThreadKeys
} from '@main/search/fuzzy-sender'
import { queryTerms } from '@main/search/semantic'
import { buildRetrievalText, senderInventory } from '@main/ai/chat'
import { closeTestDb, createTestDb, seedAccount, seedFolder } from '../helpers/db'

// Typo-tolerant sender lookup (M92) — regression built from Tim's real case:
// "was ist die letzte mail von jens buetfisch" (missing "e") must still find
// "Bütefisch, Jens <jens.buetefisch@stadt.example>".

function seedSenderMail(
  db: Database.Database,
  opts: {
    accountId: number
    folderId: number
    uid: number
    threadKey: string
    fromName: string
    fromAddr: string
    date?: number
  }
): void {
  db.prepare(
    `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, subject,
       from_addr, from_name, date, body_state)
     VALUES (?, ?, ?, ?, ?, 'Betreff', ?, ?, ?, 'full')`
  ).run(
    opts.accountId,
    opts.folderId,
    opts.uid,
    `<f${opts.uid}@t>`,
    opts.threadKey,
    opts.fromAddr,
    opts.fromName,
    opts.date ?? 1_700_000_000_000 + opts.uid
  )
}

describe('boundedLevenshtein', () => {
  it('measures edits and honors the bound', () => {
    expect(boundedLevenshtein('buetfisch', 'buetefisch', 2)).toBe(1)
    expect(boundedLevenshtein('jens', 'jens', 0)).toBe(0)
    expect(boundedLevenshtein('marie', 'maria', 1)).toBe(1)
    expect(boundedLevenshtein('kurz', 'komplettanders', 2)).toBe(3)
  })
})

describe('fuzzySenderMatches', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  function seed(): { accountId: number; inbox: number } {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'tim@example.org' })
    const inbox = seedFolder(db, accountId, '\\Inbox')
    seedSenderMail(db, {
      accountId,
      folderId: inbox,
      uid: 1,
      threadKey: 'stadt',
      fromName: 'Bütefisch, Jens',
      fromAddr: 'Jens.Buetefisch@stadt.example',
      date: 1_784_000_000_000
    })
    seedSenderMail(db, {
      accountId,
      folderId: inbox,
      uid: 2,
      threadKey: 'stadt-alt',
      fromName: 'Bütefisch, Jens',
      fromAddr: 'Jens.Buetefisch@stadt.example',
      date: 1_700_000_000_000
    })
    seedSenderMail(db, {
      accountId,
      folderId: inbox,
      uid: 3,
      threadKey: 'noise',
      fromName: 'Newsletter',
      fromAddr: 'info@newsletter.example'
    })
    return { accountId, inbox }
  }

  it('findet den Absender trotz Tippfehler und Umlaut-Faltung', () => {
    seed()
    const terms = queryTerms('was ist die letzte mail von jens buetfisch')
    const matches = fuzzySenderMatches(db, terms)
    expect(matches.map((m) => m.addr)).toEqual(['jens.buetefisch@stadt.example'])
  })

  it('liefert die Threads des Absenders neueste zuerst', () => {
    seed()
    const terms = queryTerms('letzte mail von buetfisch')
    expect(fuzzySenderThreadKeys(db, terms, 5)).toEqual(['stadt', 'stadt-alt'])
    expect(fuzzySenderMessageIds(db, terms, 5)).toEqual([1, 2])
  })

  it('ignoriert generische Postfach-Wörter und Kurz-Terme', () => {
    seed()
    expect(fuzzySenderMatches(db, ['info'])).toEqual([])
    expect(fuzzySenderMatches(db, ['von'])).toEqual([])
  })
})

describe('buildRetrievalText (M93 — Folgefragen)', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('löst Pronomen über den Gesprächsverlauf auf', () => {
    db = createTestDbForRetrieval()
    const history = [
      { role: 'user' as const, content: 'Was waren die letzten mail von jens buetefisch' },
      { role: 'assistant' as const, content: 'Die letzten beiden Mails von Jens Bütefisch waren …' }
    ]
    const text = buildRetrievalText('Kannst du mir alle mails von ihm geben?', history)
    const matches = fuzzySenderMatches(db, queryTerms(text))
    expect(matches.map((m) => m.addr)).toEqual(['jens.buetefisch@stadt.example'])
  })

  it('lässt Erstfragen unverändert', () => {
    expect(buildRetrievalText('Was kam heute an?', [])).toBe('Was kam heute an?')
  })
})

function createTestDbForRetrieval(): Database.Database {
  const fresh = createTestDb()
  const accountId = seedAccount(fresh, { email: 'tim@example.org' })
  const inbox = seedFolder(fresh, accountId, '\\Inbox')
  fresh
    .prepare(
      `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, subject,
         from_addr, from_name, date, body_state)
       VALUES (?, ?, 9, '<r9@t>', 'stadt', 'Betreff', 'Jens.Buetefisch@stadt.example', 'Bütefisch, Jens', 1784000000000, 'full')`
    )
    .run(accountId, inbox)
  return fresh
}

describe('senderInventory (M95)', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('listet Top-Absender dedupliziert, Anzeigename vor Adresse', () => {
    db = createTestDbForRetrieval()
    const inventory = senderInventory(db)
    expect(inventory).toContain('Bütefisch, Jens')
    expect(inventory).not.toContain('jens.buetefisch@stadt.example')
  })
})

// The previous implementation: every sender, every token, every term.
function referenceMatches(db: Database.Database, terms: string[]): FuzzySenderMatch[] {
  const candidates = terms
    .map(normalizeToken)
    .filter((term) => term.length >= 4 && !GENERIC_TOKENS.has(term))
  if (candidates.length === 0) return []
  const senders = db
    .prepare(
      `SELECT lower(from_addr) AS addr, max(from_name) AS name, count(*) AS weight
       FROM messages WHERE from_addr IS NOT NULL AND from_addr <> ''
       GROUP BY lower(from_addr)`
    )
    .all() as SenderRow[]
  const matches: FuzzySenderMatch[] = []
  for (const sender of senders) {
    let best = Number.POSITIVE_INFINITY
    for (const term of candidates) {
      const budget = allowedDistance(term.length)
      for (const token of senderTokens(sender)) {
        if (GENERIC_TOKENS.has(token)) continue
        const distance = boundedLevenshtein(term, token, budget)
        if (distance <= budget) best = Math.min(best, distance)
      }
    }
    if (best !== Number.POSITIVE_INFINITY) {
      matches.push({ addr: sender.addr, distance: best, weight: sender.weight })
    }
  }
  return matches.sort((a, b) => a.distance - b.distance || b.weight - a.weight).slice(0, 3)
}

describe('sender token index', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('matches the previous full scan on a randomized sender inventory', () => {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'tim@example.org' })
    const inbox = seedFolder(db, accountId, '\\Inbox')
    let seed = 7
    const random = (): number => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]
    const first = ['Jens', 'Anna', 'Jürgen', 'Maximilian', 'Sophie', 'Lukas', 'Bärbel', 'Thomas']
    const last = ['Bütefisch', 'Schneider', 'Müller', 'Weißmann', 'Hoffmann', 'Kowalski', 'Berger']
    const hosts = ['stadt.example', 'firma.de', 'gmail.com', 'verein.org']
    let uid = 0
    for (let i = 0; i < 300; i++) {
      const name = `${pick(last)}, ${pick(first)}`
      const addr = `${name.split(', ')[1].toLowerCase()}.${i}@${pick(hosts)}`
      for (let n = 0; n < 1 + Math.floor(random() * 3); n++) {
        uid += 1
        seedSenderMail(db, {
          accountId,
          folderId: inbox,
          uid,
          threadKey: `t${uid}`,
          fromName: name,
          fromAddr: addr
        })
      }
    }
    for (const query of [
      'mail von jens buetfisch',
      'juergen mueller rechnung',
      'schnieder',
      'weismann',
      'hofman sophie',
      'kowalsky',
      'info team',
      'bärbel'
    ]) {
      expect(fuzzySenderMatches(db, queryTerms(query)), query).toEqual(
        referenceMatches(db, queryTerms(query))
      )
    }
  })

  it('picks up senders of new messages right away', () => {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'tim@example.org' })
    const inbox = seedFolder(db, accountId, '\\Inbox')
    seedSenderMail(db, {
      accountId,
      folderId: inbox,
      uid: 1,
      threadKey: 'a',
      fromName: 'Anna Berger',
      fromAddr: 'anna@firma.de'
    })
    expect(fuzzySenderMatches(db, ['schneider'])).toEqual([])
    seedSenderMail(db, {
      accountId,
      folderId: inbox,
      uid: 2,
      threadKey: 'b',
      fromName: 'Paula Schneider',
      fromAddr: 'paula@firma.de'
    })
    expect(fuzzySenderMatches(db, ['schnieder']).map((m) => m.addr)).toEqual(['paula@firma.de'])
  })
})
