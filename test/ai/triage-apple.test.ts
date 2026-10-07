import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { runTriage } from '@main/ai/triage'
import { upsertEnvelope, storeBody } from '@main/mail/ingest'
import { countOpenTasks } from '@main/db/repos/tasks'
import { createTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'

// Apple-Provider (M88): zweistufige Pipeline — die enge Gate-Frage entscheidet,
// ob action_items/needs_reply Aufgaben erzeugen dürfen. Eval-getrieben:
// Precision 64 % → 100 % bei Recall 90 % (scripts/apple-triage-eval).

const { fakeAppleTriage, fakeAppleGate, fakeAppleStatus } = vi.hoisted(() => ({
  fakeAppleTriage: vi.fn(),
  fakeAppleGate: vi.fn(async () => false),
  fakeAppleStatus: vi.fn(async () => ({ state: 'available' as const, detail: null }))
}))

vi.mock('@main/ai/openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/ai/openrouter')>()
  return {
    ...actual,
    getTriageProvider: () => 'apple' as const
  }
})

vi.mock('@main/ai/apple-fm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/ai/apple-fm')>()
  return {
    ...actual,
    appleFmStatus: fakeAppleStatus,
    appleGate: fakeAppleGate,
    appleTriage: fakeAppleTriage
  }
})

function seedMail(db: Database.Database, subject: string, body: string): number {
  const acc = seedAccount(db, { email: 'lena@test.de' })
  const folder = seedFolder(db, acc, '\\Inbox')
  const res = upsertEnvelope(
    db,
    acc,
    folder,
    makeEnvelope({
      uid: 991,
      messageId: `<apple-${subject.length}@t>`,
      subject,
      to: [{ name: null, address: 'lena@test.de' }],
      cc: []
    })
  )!
  storeBody(db, res.messageId, {
    messageId: `<apple-${subject.length}@t>`,
    inReplyTo: null,
    references: [],
    subject,
    from: { name: 'Marie', address: 'marie@verein.example' },
    to: [],
    cc: [],
    replyTo: [],
    date: Date.now(),
    text: body,
    html: null,
    snippet: body.slice(0, 60),
    attachments: []
  })
  return res.messageId
}

describe('runTriage mit Apple-Provider (zweistufig)', () => {
  let db: Database.Database

  afterEach(() => {
    closeTestDb(db)
    vi.clearAllMocks()
  })

  it('Gate zu: übereifriges Urteil erzeugt weder Aufgaben noch Antwort-Erwartung', async () => {
    db = createTestDb()
    const messageId = seedMail(
      db,
      'Newsletter Juli',
      'Hallo Lena, schau dir unsere Angebote an und melde dich bis Freitag!'
    )
    fakeAppleGate.mockResolvedValueOnce(false)
    fakeAppleTriage.mockResolvedValueOnce({
      category: 'work',
      priority: 3,
      summary: 'Verein bewirbt Angebote.',
      action_items: [{ title: 'Angebote anschauen', due: null }],
      needs_reply: true,
      addressed_to_me: true,
      confidence: 0.8
    })

    expect(await runTriage(db, messageId)).toBe('done')

    const annotation = db
      .prepare(
        'SELECT action_items_json, needs_reply, model, cost_usd FROM ai_annotations WHERE message_id = ?'
      )
      .get(messageId) as {
      action_items_json: string
      needs_reply: number
      model: string
      cost_usd: number
    }
    expect(annotation.model).toBe('apple/on-device')
    expect(annotation.cost_usd).toBe(0)
    expect(JSON.parse(annotation.action_items_json)).toEqual([])
    expect(annotation.needs_reply).toBe(0)
    expect(db.prepare('SELECT count(*) n FROM tasks').get()).toEqual({ n: 0 })
  })

  it('Gate offen: echte persönliche Bitte erzeugt die Aufgabe', async () => {
    db = createTestDb()
    const messageId = seedMail(
      db,
      'Einkauf fürs Sommerfest',
      'Hallo Lena, übernimmst du den Getränke-Einkauf fürs Sommerfest am 26.? Danke dir! Marie'
    )
    fakeAppleGate.mockResolvedValueOnce(true)
    fakeAppleTriage.mockResolvedValueOnce({
      category: 'personal',
      priority: 4,
      summary: 'Marie bittet Lena, den Getränke-Einkauf zu übernehmen.',
      action_items: [{ title: 'Getränke-Einkauf übernehmen', due: '2026-07-26' }],
      needs_reply: true,
      addressed_to_me: true,
      confidence: 0.9
    })

    expect(await runTriage(db, messageId)).toBe('done')

    const annotation = db
      .prepare('SELECT action_items_json, needs_reply FROM ai_annotations WHERE message_id = ?')
      .get(messageId) as { action_items_json: string; needs_reply: number }
    expect(JSON.parse(annotation.action_items_json)).toEqual([
      { title: 'Getränke-Einkauf übernehmen', due: '2026-07-26' }
    ])
    expect(annotation.needs_reply).toBe(1)
    expect(countOpenTasks(db)).toBeGreaterThan(0)
  })

  it('legt den Job ohne verbrannten Versuch zurück, wenn das Modell nicht bereit ist', async () => {
    db = createTestDb()
    const messageId = seedMail(db, 'Egal', 'Inhalt.')
    fakeAppleStatus.mockResolvedValueOnce({ state: 'model-not-ready' as const, detail: null })

    expect(await runTriage(db, messageId)).toBe('skipped-no-client')
    expect(fakeAppleGate).not.toHaveBeenCalled()
    expect(fakeAppleTriage).not.toHaveBeenCalled()
  })
})
