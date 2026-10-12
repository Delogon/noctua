import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import { createCompositionModeParser, createSubjectProtocolParser } from '@main/ai/drafts'
import { listThreads } from '@main/db/repos/threads'

describe('createSubjectProtocolParser', () => {
  it('extrahiert Betreff und Trennlinie aus zerhackten Chunks', () => {
    const p = createSubjectProtocolParser()
    const out: string[] = []
    let subject: string | null = null
    for (const delta of [
      'BET',
      'REFF: Kaffee nächste ',
      'Woche?\n--',
      '-\nHi Anna,\n',
      'passt Dienstag?'
    ]) {
      const r = p.feed(delta)
      if (r.subject) subject = r.subject
      if (r.text) out.push(r.text)
    }
    const f = p.flush()
    if (f.text) out.push(f.text)
    expect(subject).toBe('Kaffee nächste Woche?')
    expect(out.join('')).toBe('Hi Anna,\npasst Dienstag?')
  })

  it('reicht Streams ohne BETREFF-Zeile unverändert durch', () => {
    const p = createSubjectProtocolParser()
    const out: string[] = []
    for (const delta of ['Hallo ', 'Tim,\nhier der Text.']) {
      const r = p.feed(delta)
      expect(r.subject).toBeNull()
      if (r.text) out.push(r.text)
    }
    out.push(p.flush().text)
    expect(out.join('')).toBe('Hallo Tim,\nhier der Text.')
  })

  it('puffert ein einzelnes B, bis klar ist, dass es kein Protokoll ist', () => {
    const p = createSubjectProtocolParser()
    expect(p.feed('B').text).toBe('')
    expect(p.feed('itte melde dich.').text).toBe('Bitte melde dich.')
  })

  it('behält die zweite Zeile, wenn sie keine Trennlinie ist', () => {
    const p = createSubjectProtocolParser()
    const r1 = p.feed('BETREFF: Test\nHallo Anna,\nGruß')
    expect(r1.subject).toBe('Test')
    expect(r1.text + p.flush().text).toBe('Hallo Anna,\nGruß')
  })
})

describe('createCompositionModeParser', () => {
  it('erkennt ein zerhacktes Diktat-Protokoll und entfernt die Moduszeile', () => {
    const parser = createCompositionModeParser()
    const first = parser.feed('MOD')
    const second = parser.feed('US: DIK')
    const third = parser.feed('TAT\nBETREFF: Treffen\n---\nHallo Sabine,')
    expect(first).toEqual({ mode: null, text: '' })
    expect(second).toEqual({ mode: null, text: '' })
    expect(third).toEqual({
      mode: 'dictation',
      text: 'BETREFF: Treffen\n---\nHallo Sabine,'
    })
  })

  it('reicht Antworten ohne Moduszeile verlustfrei durch', () => {
    const parser = createCompositionModeParser()
    expect(parser.feed('Hallo Sabine,')).toEqual({ mode: null, text: 'Hallo Sabine,' })
    expect(parser.feed('\nwie geht es dir?').text).toBe('\nwie geht es dir?')
  })
})

describe('m15 db-features', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => closeTestDb(db))

  it('listThreads filtert auf ein Konto', () => {
    const acc1 = seedAccount(db, { email: 'eins@test.de' })
    const acc2 = seedAccount(db, { email: 'zwei@test.de' })
    const inbox1 = seedFolder(db, acc1, '\\Inbox', 'INBOX')
    const inbox2 = seedFolder(db, acc2, '\\Inbox', 'INBOX')
    upsertEnvelope(
      db,
      acc1,
      inbox1,
      makeEnvelope({ uid: 1, messageId: '<x1@t>', subject: 'Konto 1' })
    )
    upsertEnvelope(
      db,
      acc2,
      inbox2,
      makeEnvelope({ uid: 1, messageId: '<x2@t>', subject: 'Konto 2' })
    )

    expect(listThreads(db, 50)).toHaveLength(2)
    const only1 = listThreads(db, 50, acc1)
    expect(only1).toHaveLength(1)
    expect(only1[0].subject).toBe('Konto 1')
  })

  it('accounts.signature überlebt Migration und Update', () => {
    const acc = seedAccount(db, { email: 'sig@test.de' })
    db.prepare('UPDATE accounts SET signature = ? WHERE id = ?').run('Viele Grüße\nTim', acc)
    const row = db.prepare('SELECT signature FROM accounts WHERE id = ?').get(acc) as {
      signature: string | null
    }
    expect(row.signature).toBe('Viele Grüße\nTim')
  })
})
