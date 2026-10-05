import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { normalizeSubject, computeThreadKey } from '@main/mail/threading'
import {
  isForwardWithoutRequest,
  isForwardedSubject,
  textBeforeForwardedMessage
} from '@main/mail/forwarded'
import { createTestDb, closeTestDb, seedAccount, seedFolder } from '../helpers/db'

describe('normalizeSubject', () => {
  it('entfernt gängige Antwort-/Weiterleitungs-Präfixe', () => {
    expect(normalizeSubject('Re: Hallo')).toBe('hallo')
    expect(normalizeSubject('AW: Hallo')).toBe('hallo')
    expect(normalizeSubject('Fwd: Hallo')).toBe('hallo')
    expect(normalizeSubject('WG: Hallo')).toBe('hallo')
  })

  it('entfernt verschachtelte Präfixe iterativ', () => {
    expect(normalizeSubject('Re: AW: Fwd: Meeting')).toBe('meeting')
    expect(normalizeSubject('Re: Re[2]: Thema')).toBe('thema')
  })

  it('normalisiert Whitespace und Groß-/Kleinschreibung', () => {
    expect(normalizeSubject('  Projekt   Update  ')).toBe('projekt update')
  })

  it('lässt Betreffs ohne Präfix unverändert (nur lowercase)', () => {
    expect(normalizeSubject('Rechnung 2026')).toBe('rechnung 2026')
  })
})

describe('Weiterleitungsinhalt', () => {
  it('erkennt die gaengigen Weiterleitungs-Betreffzeilen', () => {
    expect(isForwardedSubject('Fwd: Dokument')).toBe(true)
    expect(isForwardedSubject('FW: Dokument')).toBe(true)
    expect(isForwardedSubject('WG: Dokument')).toBe(true)
    expect(isForwardedSubject('Re: Dokument')).toBe(false)
  })

  it('erkennt eine nackte Apple-Mail-Weiterleitung ohne eigenen Auftrag', () => {
    const text = '> Anfang der weitergeleiteten Nachricht:\n> Von: Helpdesk\n> Bitte antworte uns.'
    expect(isForwardWithoutRequest('Fwd: Ticket', text)).toBe(true)
  })

  it('wertet nur den eigenen Text vor dem Weiterleitungsblock aus', () => {
    const text =
      'Kannst du das bitte bis morgen prüfen?\n\n---------- Forwarded message ---------\nFrom: Helpdesk\nBitte antworte uns.'
    expect(isForwardWithoutRequest('Fwd: Ticket', text)).toBe(false)
    expect(textBeforeForwardedMessage('Fwd: Ticket', text)).toBe(
      'Kannst du das bitte bis morgen prüfen?'
    )
  })

  it('behandelt FYI und reine Info-Hinweise ebenfalls nicht als Auftrag', () => {
    const marker = '\n\nAnfang der weitergeleiteten Nachricht:\nVon: Helpdesk'
    expect(isForwardWithoutRequest('Fwd: Ticket', `FYI${marker}`)).toBe(true)
    expect(isForwardWithoutRequest('WG: Ticket', `Nur zur Info.${marker}`)).toBe(true)
    expect(isForwardWithoutRequest('Fwd: Ticket', `Zur Kenntnis${marker}`)).toBe(true)
  })
})

describe('computeThreadKey', () => {
  let db: Database.Database
  let accountId: number

  afterEach(() => closeTestDb(db))

  function setup(): void {
    db = createTestDb()
    accountId = seedAccount(db)
    seedFolder(db, accountId, '\\Inbox')
  }

  it('nutzt bei Gmail die X-GM-THRID autoritativ', () => {
    setup()
    const key = computeThreadKey(db, accountId, {
      gmThrid: 'abc123',
      messageId: '<m1@x>',
      inReplyTo: null,
      references: [],
      subject: 'egal'
    })
    expect(key).toBe(`${accountId}:gm:abc123`)
  })

  it('übernimmt den thread_key eines referenzierten Nachricht (JWZ-light)', () => {
    setup()
    const folderId = seedFolder(db, accountId, '\\Sent')
    db.prepare(
      `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, date)
       VALUES (?, ?, 1, '<orig@x>', 'thread-parent', 1000)`
    ).run(accountId, folderId)

    const key = computeThreadKey(db, accountId, {
      gmThrid: null,
      messageId: '<reply@x>',
      inReplyTo: '<orig@x>',
      references: ['<orig@x>'],
      subject: 'Re: Thema'
    })
    expect(key).toBe('thread-parent')
  })

  it('fällt ohne Referenz auf den normalisierten Betreff zurück', () => {
    setup()
    const a = computeThreadKey(db, accountId, {
      gmThrid: null,
      messageId: '<a@x>',
      inReplyTo: null,
      references: [],
      subject: 'Angebot'
    })
    const b = computeThreadKey(db, accountId, {
      gmThrid: null,
      messageId: '<b@x>',
      inReplyTo: null,
      references: [],
      subject: 'Re: Angebot'
    })
    expect(a).toBe(b) // gleicher Betreff → gleicher Thread
    expect(a.startsWith(`${accountId}:sub:`)).toBe(true)
  })

  it('nutzt die Message-ID als letzten Ausweg ohne Betreff', () => {
    setup()
    const key = computeThreadKey(db, accountId, {
      gmThrid: null,
      messageId: '<lonely@x>',
      inReplyTo: null,
      references: [],
      subject: null
    })
    expect(key.startsWith(`${accountId}:msg:`)).toBe(true)
  })
})
