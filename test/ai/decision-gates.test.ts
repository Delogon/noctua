import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { FollowupRadar } from '@main/ai/followups'
import { runEventExtraction } from '@main/ai/events'
import {
  applyRulesPostTriage,
  evaluateAiConditions,
  matches,
  ruleJsonSchema,
  ruleNeedsAi,
  ruleQuestionName,
  setRuleActionExecutor
} from '@main/ai/rules'
import { createProfile, setTaskAssignment } from '@main/ai/providers/registry'
import { upsertEnvelope } from '@main/mail/ingest'
import { createAiTestDb, closeTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

const { fakeCreate } = vi.hoisted(() => ({ fakeCreate: vi.fn() }))
vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: fakeCreate } } })
}))

let db: Database.Database
let systemOne: ReturnType<typeof vi.fn>

function configureDecision(): void {
  const p = createProfile({
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiStyle: 'chat',
    isLocal: true
  })
  setTaskAssignment('decision', p.id, 'clef-flash')
}

/** Antwortet auf jede gestellte noul-Frage mit probs[name] (Standard 0.01). */
function stubNoul(probs: Record<string, number>): void {
  systemOne = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, unknown> }
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((name) => [name, { type: 'noul', noul: probs[name] ?? 0.01 }])
    )
    return Response.json({
      model: 'clef-flash',
      answers,
      usage: { input_tokens: 10, output_tokens: 1 }
    })
  })
  vi.stubGlobal('fetch', systemOne)
}

beforeEach(() => {
  db = createAiTestDb()
  fakeCreate.mockReset()
})
afterEach(() => {
  closeTestDb(db)
  vi.unstubAllGlobals()
})

function seedInbox(opts: { subject?: string; from?: string; body?: string } = {}): number {
  const acc = seedAccount(db, { email: 'me@test.de' })
  const folder = seedFolder(db, acc, '\\Inbox')
  const res = upsertEnvelope(
    db,
    acc,
    folder,
    makeEnvelope({
      uid: 1,
      messageId: '<g@t>',
      subject: opts.subject ?? 'Rechnung 4711',
      fromAddr: opts.from ?? 'billing@shop.de',
      fromName: 'Shop',
      to: [{ name: null, address: 'me@test.de' }]
    })
  )!
  db.prepare("UPDATE messages SET body_state = 'full' WHERE id = ?").run(res.messageId)
  db.prepare(
    'INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, ?, NULL)'
  ).run(res.messageId, opts.body ?? 'Anbei die Rechnung über 120 Euro, fällig am 15.')
  return res.messageId
}

describe('Termin-Gate (proposes_meeting aus der Triage)', () => {
  function addCalendar(): void {
    db.prepare(
      `INSERT INTO cal_accounts (name, server_url, home_url, username, created_at)
       VALUES ('T', 'https://x.test/', 'https://x.test/cal/', 'u', 1)`
    ).run()
  }
  function storeDecision(id: number, proposes: number): void {
    db.prepare(
      `INSERT INTO ai_decisions (message_id, model, proposes_meeting, created_at) VALUES (?, 'clef-flash', ?, 1)`
    ).run(id, proposes)
  }

  it('unter der Schwelle: keine Extraktion, kein Textmodell-Aufruf', async () => {
    addCalendar()
    const id = seedInbox({ body: 'Vielen Dank für deine Bestellung, sie wird morgen versendet.' })
    storeDecision(id, 0.1)
    expect(await runEventExtraction(db, id)).toBe('skipped-unsupported')
    expect(fakeCreate).not.toHaveBeenCalled()
  })

  it('ab der Schwelle (0.5): Extraktion läuft', async () => {
    addCalendar()
    const id = seedInbox({ body: 'Treffen wir uns am Dienstag um 10 Uhr im Büro?' })
    storeDecision(id, 0.5)
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ events: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 }
    })
    expect(await runEventExtraction(db, id)).toBe('done')
    expect(fakeCreate).toHaveBeenCalledTimes(1)
  })

  it('ohne gespeicherte Entscheidung (klassische Triage): wie bisher, Extraktion läuft', async () => {
    addCalendar()
    const id = seedInbox({ body: 'Treffen wir uns am Dienstag um 10 Uhr im Büro?' })
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ events: [] }) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 }
    })
    expect(await runEventExtraction(db, id)).toBe('done')
    expect(fakeCreate).toHaveBeenCalledTimes(1)
  })
})

describe('Follow-up-Radar per Entscheidungsmodell', () => {
  function seedSent(): number {
    const acc = seedAccount(db, { email: 'me@example.org' })
    const sent = seedFolder(db, acc, '\\Sent')
    const at = Date.now() - 4 * 24 * 3600 * 1000
    const id = upsertEnvelope(
      db,
      acc,
      sent,
      makeEnvelope({
        uid: 9,
        messageId: '<sent@x>',
        subject: 'Angebot',
        fromAddr: 'me@example.org',
        to: [{ name: null, address: 'kunde@firma.de' }],
        date: at,
        internalDate: at
      })
    )!.messageId
    db.prepare("UPDATE messages SET body_state = 'full' WHERE id = ?").run(id)
    db.prepare(
      'INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, ?, NULL)'
    ).run(id, 'Hallo, passt dir der Termin am Donnerstag? Gib mir bitte kurz Bescheid.')
    return id
  }

  it('hoher Wert: wartet auf Antwort, ohne Textmodell-Aufruf', async () => {
    configureDecision()
    stubNoul({ expects_reply: 0.9 })
    const id = seedSent()
    const radar = new FollowupRadar()
    radar.init(db, () => {})
    await radar.scan()
    expect(systemOne).toHaveBeenCalledTimes(1)
    expect(fakeCreate).not.toHaveBeenCalled()
    expect(db.prepare('SELECT state FROM followups WHERE message_id = ?').get(id)).toEqual({
      state: 'waiting'
    })
  })

  it('niedriger Wert: verworfen', async () => {
    configureDecision()
    stubNoul({ expects_reply: 0.1 })
    const id = seedSent()
    const radar = new FollowupRadar()
    radar.init(db, () => {})
    await radar.scan()
    expect(db.prepare('SELECT state FROM followups WHERE message_id = ?').get(id)).toEqual({
      state: 'dismissed'
    })
    expect(fakeCreate).not.toHaveBeenCalled()
  })

  it('Fehler des Entscheidungsmodells: im Zweifel anzeigen', async () => {
    configureDecision()
    systemOne = vi.fn(async () => new Response('{"error":"x"}', { status: 500 }))
    vi.stubGlobal('fetch', systemOne)
    const id = seedSent()
    const radar = new FollowupRadar()
    radar.init(db, () => {})
    await radar.scan()
    expect(db.prepare('SELECT state FROM followups WHERE message_id = ?').get(id)).toEqual({
      state: 'waiting'
    })
  })
})

describe('Regeln mit KI-Bedingung', () => {
  function addRule(rule: unknown, name = 'r'): number {
    const parsed = ruleJsonSchema.parse(rule)
    return Number(
      db
        .prepare(
          `INSERT INTO rules (name, description, source_text, rule_json, needs_ai, enabled, created_at)
           VALUES (?, '', '', ?, ?, 1, 1)`
        )
        .run(name, JSON.stringify(parsed), ruleNeedsAi(parsed) ? 1 : 0).lastInsertRowid
    )
  }
  const archived: number[] = []
  const flagged: number[] = []
  beforeEach(() => {
    archived.length = 0
    flagged.length = 0
    setRuleActionExecutor((ids, action) => {
      if (action === 'archive') archived.push(...ids)
      if (action === 'flag') flagged.push(...ids)
    })
  })

  it('Schema: aiCondition zählt als Kriterium, ≤ 200 Zeichen, braucht KI', () => {
    const rule = ruleJsonSchema.parse({
      match: { aiCondition: 'Ist das eine Rechnung?' },
      actions: { flag: true }
    })
    expect(ruleNeedsAi(rule)).toBe(true)
    expect(() =>
      ruleJsonSchema.parse({ match: { aiCondition: 'x'.repeat(201) }, actions: { flag: true } })
    ).toThrow()
  })

  it('matches: Wahrscheinlichkeit ≥ 0.6 UND übrige Kriterien; ohne Wert nie', () => {
    const rule = ruleJsonSchema.parse({
      match: { aiCondition: 'Rechnung?', fromDomain: ['shop.de'] },
      actions: { flag: true }
    })
    const facts = {
      id: 1,
      from_addr: 'a@shop.de',
      from_name: null,
      subject: 's',
      list_unsubscribe: 0,
      category: null,
      priority: null
    }
    expect(matches(rule, facts, 0.6)).toBe(true)
    expect(matches(rule, facts, 0.59)).toBe(false)
    expect(matches(rule, facts, null)).toBe(false)
    expect(matches(rule, facts)).toBe(false)
    expect(matches(rule, { ...facts, from_addr: 'a@other.de' }, 0.99)).toBe(false)
    expect(matches(rule, facts, 'skip')).toBe(true)
  })

  it('bündelt alle KI-Bedingungen in EINEN Aufruf (eine Frage je Regel)', async () => {
    configureDecision()
    const id = seedInbox()
    const r1 = addRule({
      match: { aiCondition: 'Ist das eine Rechnung?' },
      actions: { flag: true }
    })
    const r2 = addRule({ match: { aiCondition: 'Ist das Werbung?' }, actions: { archive: true } })
    const r3 = addRule({
      match: { aiCondition: 'Geht es um einen Termin?' },
      actions: { flag: true }
    })
    stubNoul({
      [ruleQuestionName(r1)]: 0.95,
      [ruleQuestionName(r2)]: 0.2,
      [ruleQuestionName(r3)]: 0.7
    })
    await applyRulesPostTriage(db, id)
    expect(systemOne).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((systemOne.mock.calls[0] as [string, RequestInit])[1].body))
    expect(Object.keys(body.questions)).toEqual([r1, r2, r3].map(ruleQuestionName))
    expect(body.questions[ruleQuestionName(r1)]).toMatchObject({
      type: 'noul',
      instructions: 'Ist das eine Rechnung?'
    })
    // Mail steht als unvertrauenswürdige Daten im state
    expect(body.state).toContain('<<<BEGIN MAIL (UNTRUSTED DATA)>>>')
    expect(flagged).toEqual([id, id]) // r1 und r3
    expect(archived).toEqual([])
    expect(db.prepare('SELECT hits FROM rules WHERE id = ?').get(r1)).toEqual({ hits: 1 })
    expect(db.prepare('SELECT hits FROM rules WHERE id = ?').get(r2)).toEqual({ hits: 0 })
  })

  it('fragt nur Regeln, deren übrige Kriterien passen (kein Aufruf, wenn keine passt)', async () => {
    configureDecision()
    const id = seedInbox()
    addRule({
      match: { aiCondition: 'Ist das eine Rechnung?', fromDomain: ['andere.de'] },
      actions: { flag: true }
    })
    stubNoul({})
    await applyRulesPostTriage(db, id)
    expect(systemOne).not.toHaveBeenCalled()
    expect(flagged).toEqual([])
  })

  it('ohne Entscheidungsmodell: Regeln mit KI-Bedingung werden übersprungen, kein Request', async () => {
    const id = seedInbox()
    addRule({ match: { aiCondition: 'Ist das eine Rechnung?' }, actions: { flag: true } })
    // normale Regel daneben feuert weiter
    addRule({ match: { category: ['transactional'] }, actions: { flag: true } })
    db.prepare(
      `INSERT INTO ai_annotations (message_id, category, priority, prompt_version, needs_reply, created_at)
       VALUES (?, 'transactional', 3, 6, 0, 1)`
    ).run(id)
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await applyRulesPostTriage(db, id)
    expect(f).not.toHaveBeenCalled()
    expect(flagged).toEqual([id]) // nur die Kategorie-Regel
  })

  it('höchstens 64 Fragen je Aufruf', async () => {
    configureDecision()
    const id = seedInbox()
    for (let i = 0; i < 70; i++) {
      addRule({ match: { aiCondition: `Frage ${i}?` }, actions: { flag: true } }, `r${i}`)
    }
    stubNoul({})
    const probs = await evaluateAiConditions(db, id)
    expect(systemOne).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((systemOne.mock.calls[0] as [string, RequestInit])[1].body))
    expect(Object.keys(body.questions)).toHaveLength(64)
    expect(Object.keys(probs)).toHaveLength(64)
  })

  it('Fehler des Entscheidungsmodells: Regeln pausieren, kein Wurf', async () => {
    configureDecision()
    const id = seedInbox()
    addRule({ match: { aiCondition: 'Rechnung?' }, actions: { flag: true } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"x"}', { status: 500 }))
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await applyRulesPostTriage(db, id)
    warn.mockRestore()
    expect(flagged).toEqual([])
  })
})
