import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  answerGist,
  deleteOwlConversation,
  getOwlConversation,
  listOwlConversations,
  saveOwlConversation
} from '@main/db/repos/owl'
import { createTestDb, closeTestDb } from '../helpers/db'

// Persistenz der Eulen-Gespräche: Roundtrip über die In-Memory-DB
// (Muster wie repos.test.ts) — Speichern, Listen mit Gist, Laden, Löschen.

describe('owl-conversations-repo', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('Roundtrip: save (insert) → list mit Gist → get → save (update) → delete', () => {
    db = createTestDb()
    const messages = [
      { role: 'user' as const, content: 'Welche Rechnungen kamen diesen Monat?', at: 1 },
      {
        role: 'assistant' as const,
        content: 'Drei — Hetzner, Adobe und ein DB-Ticket. Adobe ist die einzige Abo-Buchung.',
        at: 2,
        sources: [{ index: 1, threadKey: 'k1', subject: 'Hetzner invoice' }]
      }
    ]

    const id = saveOwlConversation(db, { title: 'Welche Rechnungen kamen diesen Monat?', messages })
    expect(id).toBeGreaterThan(0)

    const listed = listOwlConversations(db)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id,
      title: 'Welche Rechnungen kamen diesen Monat?',
      // Gist = erster Satz der ersten Eulen-Antwort
      answerGist: 'Drei — Hetzner, Adobe und ein DB-Ticket.'
    })

    const loaded = getOwlConversation(db, id)
    expect(loaded?.messages).toEqual(messages)

    // Follow-up: Upsert mit id erweitert den Verlauf statt zu duplizieren
    const followUp = [
      ...messages,
      { role: 'user' as const, content: 'Welche davon kann ich absetzen?', at: 3 },
      { role: 'assistant' as const, content: 'Hetzner und das DB-Ticket.', at: 4 }
    ]
    expect(saveOwlConversation(db, { id, title: listed[0].title, messages: followUp })).toBe(id)
    expect(listOwlConversations(db)).toHaveLength(1)
    expect(getOwlConversation(db, id)?.messages).toHaveLength(4)

    expect(deleteOwlConversation(db, id)).toBe(true)
    expect(deleteOwlConversation(db, id)).toBe(false)
    expect(getOwlConversation(db, id)).toBeNull()
    expect(listOwlConversations(db)).toEqual([])
  })

  it('sortiert die Liste nach updated_at absteigend', () => {
    db = createTestDb()
    const older = saveOwlConversation(db, {
      title: 'Alt',
      messages: [{ role: 'user', content: 'Alt?' }]
    })
    const now = Date.now()
    db.prepare('UPDATE owl_conversations SET updated_at = ? WHERE id = ?').run(now - 60_000, older)
    const newer = saveOwlConversation(db, {
      title: 'Neu',
      messages: [{ role: 'user', content: 'Neu?' }]
    })
    expect(listOwlConversations(db).map((c) => c.id)).toEqual([newer, older])
  })

  it('legt bei verwaister id neu an statt still zu verlieren', () => {
    db = createTestDb()
    const id = saveOwlConversation(db, {
      id: 999,
      title: 'Verwaist',
      messages: [{ role: 'user', content: 'Frage' }]
    })
    expect(id).not.toBe(999)
    expect(getOwlConversation(db, id)?.title).toBe('Verwaist')
  })

  it('answerGist nimmt den ersten Satz und kappt Überlänge', () => {
    expect(answerGist('Erster Satz. Zweiter Satz.')).toBe('Erster Satz.')
    expect(answerGist('Ohne Satzzeichen einfach alles')).toBe('Ohne Satzzeichen einfach alles')
    expect(answerGist('  \n ')).toBeNull()
    expect(answerGist(`${'x'.repeat(200)}. Rest`)).toHaveLength(160)
  })

  it('answerGist entfernt Markdown-Marker aus der Anzeige', () => {
    expect(answerGist('**Bestellungen:** hier die `Liste`.')).toBe('Bestellungen: hier die Liste.')
    expect(answerGist('- Erster *wichtiger* Punkt. Mehr.')).toBe('Erster wichtiger Punkt.')
    expect(answerGist('## Überschrift dann Text.')).toBe('Überschrift dann Text.')
  })

  it('liefert null-Gist für Gespräche ohne Antwort und übersteht kaputtes JSON', () => {
    db = createTestDb()
    const id = saveOwlConversation(db, {
      title: 'Nur Frage',
      messages: [{ role: 'user', content: 'Unbeantwortet?' }]
    })
    expect(listOwlConversations(db)[0].answerGist).toBeNull()

    db.prepare('UPDATE owl_conversations SET messages_json = ? WHERE id = ?').run('KAPUTT{', id)
    expect(listOwlConversations(db)[0].answerGist).toBeNull()
    expect(getOwlConversation(db, id)?.messages).toEqual([])
  })
})
