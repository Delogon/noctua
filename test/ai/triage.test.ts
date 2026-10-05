import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { runTriage } from '@main/ai/triage'
import { upsertEnvelope, storeBody } from '@main/mail/ingest'
import { countOpenTasks } from '@main/db/repos/tasks'
import { listThreads } from '@main/db/repos/threads'
import { createAiTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'

// OpenRouter wird gemockt — echte LLM-Antworten sind ohne API-Key nicht testbar.
const { fakeCreate } = vi.hoisted(() => ({ fakeCreate: vi.fn() }))

vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: fakeCreate } } })
}))

function modelReply(body: Record<string, unknown>): void {
  fakeCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 }
  })
}

const baseReply = {
  category: 'personal',
  priority: 3,
  summary: 'Marie bittet um Rückmeldung zu Plakaten.',
  action_items: [{ title: 'Antworten: Plakate und Sponsor Info', due: null }],
  needs_reply: true,
  confidence: 0.9
}

function seedMail(
  db: Database.Database,
  opts: {
    accountEmail: string
    to: string[]
    cc?: string[]
    body: string
    subject?: string
    accountCreatedAt?: number
  }
): number {
  const acc = seedAccount(db, { email: opts.accountEmail, createdAt: opts.accountCreatedAt })
  const folder = seedFolder(db, acc, '\\Inbox')
  const subject = opts.subject ?? 'Plakate und Sponsor Info'
  const res = upsertEnvelope(
    db,
    acc,
    folder,
    makeEnvelope({
      uid: 1,
      messageId: '<triage@t>',
      subject,
      fromAddr: 'marie@verein.de',
      fromName: 'Marie',
      to: opts.to.map((address) => ({ name: null, address })),
      cc: (opts.cc ?? []).map((address) => ({ name: null, address }))
    })
  )!
  storeBody(db, res.messageId, {
    messageId: '<triage@t>',
    inReplyTo: null,
    references: [],
    subject,
    from: { name: 'Marie', address: 'marie@verein.de' },
    to: [],
    cc: [],
    replyTo: [],
    date: 1_700_000_000_000,
    text: opts.body,
    html: null,
    snippet: opts.body.slice(0, 100),
    attachments: []
  })
  return res.messageId
}

function annotation(
  db: Database.Database,
  messageId: number
): { addressed_to_me: number; action_items_json: string; needs_reply: number } | undefined {
  return db
    .prepare(
      'SELECT addressed_to_me, action_items_json, needs_reply FROM ai_annotations WHERE message_id = ?'
    )
    .get(messageId) as
    { addressed_to_me: number; action_items_json: string; needs_reply: number } | undefined
}

describe('runTriage (Adressat-Erkennung, Modell gemockt)', () => {
  let db: Database.Database
  afterEach(() => {
    closeTestDb(db)
    fakeCreate.mockReset()
  })

  it('Akzeptanzfall (Screenshot): Verteiler + „Hallo Jannik" ⇒ keine Aufgabe', async () => {
    db = createAiTestDb()
    const msgId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['verteiler@verein.de'],
      body: 'Hallo Jannik,\n\nanbei die Infos zu Plakaten und Sponsoren.\nViele Grüße, Marie'
    })
    // Modell irrt und behauptet addressed_to_me=true — Stufe 1+2 blocken trotzdem.
    modelReply({ ...baseReply, addressed_to_me: true })

    expect(await runTriage(db, msgId)).toBe('done')
    expect(countOpenTasks(db)).toBe(0)
    // Auch der Vorschlags-Streifen bleibt aus.
    expect(listThreads(db, 200)[0]?.taskState).toBe('none')
  })

  it('direkt adressierte Mail erzeugt weiterhin Aufgaben; addressed_to_me wird persistiert', async () => {
    db = createAiTestDb()
    const msgId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['lena.hartmann@example.org'],
      body: 'kannst du mir bis Freitag antworten?'
    })
    modelReply({ ...baseReply, addressed_to_me: true })

    expect(await runTriage(db, msgId)).toBe('done')
    expect(countOpenTasks(db)).toBeGreaterThan(0)
    expect(annotation(db, msgId)?.addressed_to_me).toBe(1)
  })

  it('Alt-Antwort ohne addressed_to_me gilt als adressiert (Schema-Default)', async () => {
    db = createAiTestDb()
    const msgId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['lena.hartmann@example.org'],
      body: 'bitte kurz freigeben.'
    })
    modelReply(baseReply) // kein addressed_to_me-Feld (Prompt-v4-Antwort)

    expect(await runTriage(db, msgId)).toBe('done')
    expect(annotation(db, msgId)?.addressed_to_me).toBe(1)
    expect(countOpenTasks(db)).toBeGreaterThan(0)
  })

  it('addressed_to_me=false: kein Auto-Task, aber Vorschlag bei An-Platzierung', async () => {
    db = createAiTestDb()
    const msgId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['lena.hartmann@example.org'],
      body: 'Hallo zusammen,\n\nJannik übernimmt die Plakate.'
    })
    modelReply({ ...baseReply, addressed_to_me: false })

    expect(await runTriage(db, msgId)).toBe('done')
    expect(countOpenTasks(db)).toBe(0)
    expect(annotation(db, msgId)?.addressed_to_me).toBe(0)
    // Action-Items bleiben erhalten — der Streifen bietet den Task nur an.
    expect(listThreads(db, 200)[0]?.taskState).toBe('suggested')
  })

  it('„Hallo Lena" via Verteiler erzeugt die Aufgabe (Inhaber-Anrede überstimmt absent)', async () => {
    db = createAiTestDb()
    const msgId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['verteiler@verein.de'],
      body: 'Hallo Lena,\n\nkannst du die Plakate abholen?'
    })
    modelReply({ ...baseReply, addressed_to_me: true })

    expect(await runTriage(db, msgId)).toBe('done')
    expect(countOpenTasks(db)).toBeGreaterThan(0)
  })

  it('historische Mails (vor Konto-Einrichtung) erzeugen keine Aufgaben', async () => {
    const db = createAiTestDb()
    // Konto JETZT eingerichtet — die Mail trägt das alte Default-Datum (2023)
    const messageId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['lena.hartmann@example.org'],
      body: 'Hallo Lena,\n\nkannst du die Plakate abholen?',
      accountCreatedAt: Date.now()
    })
    modelReply({ ...baseReply, addressed_to_me: true })

    expect(await runTriage(db, messageId)).toBe('done')
    // Triage/Annotation existiert — nur der Aufgaben-Schritt wurde übersprungen
    const annotation = db
      .prepare('SELECT category FROM ai_annotations WHERE message_id = ?')
      .get(messageId)
    expect(annotation).toBeTruthy()
    expect(countOpenTasks(db)).toBe(0)
    expect(db.prepare('SELECT count(*) n FROM tasks').get()).toEqual({ n: 0 })
    closeTestDb(db)
  })

  it('User-Prompt enthält den EMPFÄNGER-Block mit Platzierung und Anrede', async () => {
    db = createAiTestDb()
    const msgId = seedMail(db, {
      accountEmail: 'lena.hartmann@example.org',
      to: ['verteiler@verein.de'],
      body: 'Hallo Jannik,\n\nanbei die Infos.'
    })
    modelReply({ ...baseReply, addressed_to_me: false })
    await runTriage(db, msgId)

    const call = fakeCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>
    }
    const system = call.messages.find((m) => m.role === 'system')!.content
    const user = call.messages.find((m) => m.role === 'user')!.content
    expect(system).toContain('addressed_to_me')
    expect(user).toContain('EMPFÄNGER (Kontoinhaber)')
    expect(user).toContain('lena.hartmann@example.org')
    expect(user).toContain('weder in An noch CC')
    expect(user).toContain('nennt namentlich: Jannik')
  })
})
