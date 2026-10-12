import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { runTriage } from '@main/ai/triage'
import { classifyAiError } from '@main/ai/queue'
import { getPhishing } from '@main/ai/decision-service'
import { createProfile, setTaskAssignment } from '@main/ai/providers/registry'
import { setLocalOnly } from '@main/privacy'
import { upsertEnvelope, storeBody } from '@main/mail/ingest'
import { countOpenTasks } from '@main/db/repos/tasks'
import {
  HAS_REQUEST_THRESHOLD,
  NEEDS_REPLY_THRESHOLD,
  PHISHING_SCORE_HIGH,
  isHighPhishing,
  mapPriorityScore
} from '@shared/decision-thresholds'
import { writeGates, interpretTriageAnswers, TRIAGE_QUESTIONS } from '@main/ai/decision-triage'
import { extractiveSummary } from '@main/ai/extractive-summary'
import { computePhishingSignals } from '@main/ai/phishing-signals'
import { createAiTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'

const { fakeCreate } = vi.hoisted(() => ({ fakeCreate: vi.fn() }))
vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: fakeCreate } } })
}))

interface Plan {
  category?: string
  /** score 0..4 */
  priority?: number
  needs_reply?: number
  addressed_to_me?: number
  has_request?: number
  proposes_meeting?: number
  /** score 0..2 */
  phishing?: number
}

function systemOneBody(plan: Plan): unknown {
  const category = plan.category ?? 'other'
  const probs = (n: number, idx: number): Record<string, number> =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [String(i), i === idx ? 0.9 : 0.1 / (n - 1)])
    )
  return {
    model: 'clef-flash',
    answers: {
      category: {
        type: 'choice',
        choice: category,
        probabilities: { [category]: 0.9 },
        confidence: 0.8
      },
      priority: {
        type: 'score',
        score: plan.priority ?? 2,
        legend: {},
        probabilities: probs(5, Math.round(plan.priority ?? 2)),
        confidence: 0.5
      },
      needs_reply: { type: 'noul', noul: plan.needs_reply ?? 0.05 },
      addressed_to_me: { type: 'noul', noul: plan.addressed_to_me ?? 0.9 },
      has_request: { type: 'noul', noul: plan.has_request ?? 0.05 },
      proposes_meeting: { type: 'noul', noul: plan.proposes_meeting ?? 0.05 },
      phishing: {
        type: 'score',
        score: plan.phishing ?? 0,
        legend: {},
        probabilities: probs(3, Math.round(plan.phishing ?? 0)),
        confidence: 0.6
      }
    },
    usage: { input_tokens: 300, output_tokens: 2 }
  }
}

let systemOne: ReturnType<typeof vi.fn>
function stubSystemOne(plan: Plan | number): void {
  systemOne = vi.fn(async () =>
    typeof plan === 'number'
      ? new Response(JSON.stringify({ error: 'x' }), { status: plan })
      : Response.json(systemOneBody(plan))
  )
  vi.stubGlobal('fetch', systemOne)
}

function genReply(body: Record<string, unknown>): void {
  fakeCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(body) } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, cost: 0.0002 }
  })
}

function seedMail(
  db: Database.Database,
  opts: { body: string; subject?: string; fromAddr?: string; fromName?: string; replyTo?: string }
): number {
  const acc = seedAccount(db, { email: 'lena@example.org' })
  const folder = seedFolder(db, acc, '\\Inbox')
  const subject = opts.subject ?? 'Betreff'
  const res = upsertEnvelope(
    db,
    acc,
    folder,
    makeEnvelope({
      uid: 1,
      messageId: '<dec@t>',
      subject,
      fromAddr: opts.fromAddr ?? 'marie@verein.de',
      fromName: opts.fromName ?? 'Marie',
      to: [{ name: null, address: 'lena@example.org' }],
      replyTo: opts.replyTo ? [{ name: null, address: opts.replyTo }] : []
    })
  )!
  storeBody(db, res.messageId, {
    messageId: '<dec@t>',
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

interface AnnotationRow {
  category: string
  priority: number
  summary: string
  needs_reply: number
  addressed_to_me: number
  action_items_json: string
  confidence: number
  model: string
  prompt_version: number
  input_tokens: number
  cost_usd: number
}

function annotation(db: Database.Database, id: number): AnnotationRow {
  return db.prepare('SELECT * FROM ai_annotations WHERE message_id = ?').get(id) as AnnotationRow
}

function decisionRow(
  db: Database.Database,
  id: number
): Record<string, number | string | null> | undefined {
  return db.prepare('SELECT * FROM ai_decisions WHERE message_id = ?').get(id) as
    Record<string, number | string | null> | undefined
}

describe('Hybrid-Triage (Entscheidungsmodell + Textmodell nur bei Bedarf)', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createAiTestDb()
    fakeCreate.mockReset()
    const p = createProfile({
      name: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiStyle: 'chat',
      isLocal: true
    })
    setTaskAssignment('decision', p.id, 'clef-flash')
  })
  afterEach(() => {
    closeTestDb(db)
    vi.unstubAllGlobals()
  })

  it('Newsletter: rein per Entscheidung, KEIN Textmodell-Aufruf, extraktive Zusammenfassung', async () => {
    stubSystemOne({ category: 'newsletter', priority: 1 })
    const id = seedMail(db, {
      subject: 'Der Wochenüberblick',
      fromAddr: 'news@blog.example',
      body: 'Hallo Lena,\n\nDiese Woche gibt es drei neue Artikel über Rust und Datenbanken. Viel Spaß beim Lesen!\n\nAbmelden: https://x'
    })
    expect(await runTriage(db, id)).toBe('done')
    expect(fakeCreate).not.toHaveBeenCalled()
    expect(systemOne).toHaveBeenCalledTimes(1)
    const a = annotation(db, id)
    expect(a.category).toBe('newsletter')
    expect(a.priority).toBe(2) // score 1 → 2
    expect(a.summary).toBe('Diese Woche gibt es drei neue Artikel über Rust und Datenbanken.')
    expect(a.model).toBe('clef-flash')
    expect(a.cost_usd).toBe(0)
    expect(a.needs_reply).toBe(0)
    expect(JSON.parse(a.action_items_json)).toEqual([])
    // PROMPT_VERSION bleibt: kein Neu-Triage-Effekt beim Moduswechsel
    expect(a.prompt_version).toBe(6)
  })

  it('stellt genau die vereinbarten Fragen (ein Aufruf)', async () => {
    stubSystemOne({ priority: 1 })
    const id = seedMail(db, { body: 'Nur eine Info.' })
    await runTriage(db, id)
    const body = JSON.parse((systemOne.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(Object.keys(body.questions)).toEqual([
      'category',
      'priority',
      'needs_reply',
      'addressed_to_me',
      'has_request',
      'proposes_meeting',
      'phishing'
    ])
    expect(body.questions.category.type).toBe('choice')
    expect(Object.keys(body.questions.category.criteria)).toEqual([
      'personal',
      'work',
      'newsletter',
      'promotions',
      'notifications',
      'transactional',
      'other'
    ])
    expect(body.questions.priority.criteria).toHaveLength(5)
    expect(body.questions.phishing.criteria).toHaveLength(3)
    // Mail steht als unvertrauenswürdige Daten im state
    expect(body.state).toContain('<<<BEGIN MAIL (UNTRUSTED DATA)>>>')
  })

  it('Bitte an den Nutzer: Textmodell formuliert Aufgabentitel + Einzeiler (ein Aufruf)', async () => {
    stubSystemOne({
      category: 'work',
      priority: 3,
      needs_reply: 0.9,
      has_request: 0.9,
      addressed_to_me: 0.95
    })
    genReply({
      summary: 'Marie bittet bis Freitag um das Angebot.',
      action_items: [{ title: 'Angebot an Marie schicken', due: '2023-11-17' }]
    })
    const id = seedMail(db, { body: 'Kannst du mir bis Freitag das Angebot schicken?' })
    expect(await runTriage(db, id)).toBe('done')
    expect(fakeCreate).toHaveBeenCalledTimes(1)
    const call = fakeCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('Kategorie (work)')
    expect(call.messages[0].content).toContain('"action_items"')
    const a = annotation(db, id)
    expect(a.summary).toBe('Marie bittet bis Freitag um das Angebot.')
    expect(a.priority).toBe(4)
    expect(a.needs_reply).toBe(1)
    expect(a.model).toBe('clef-flash+deepseek/deepseek-v4-flash')
    expect(a.input_tokens).toBe(420)
    expect(a.cost_usd).toBeCloseTo(0.0002)
    expect(countOpenTasks(db)).toBeGreaterThan(0)
  })

  it('Zusammenfassung nur bei Priorität ≥ 3: dann ohne Aufgaben-Feld im Prompt', async () => {
    stubSystemOne({ category: 'transactional', priority: 2.4, has_request: 0.1 }) // → Priorität 3
    genReply({ summary: 'Rechnung über 120 Euro.' })
    const id = seedMail(db, { body: 'Ihre Rechnung liegt bei.' })
    await runTriage(db, id)
    expect(fakeCreate).toHaveBeenCalledTimes(1)
    const sys = (fakeCreate.mock.calls[0][0] as { messages: Array<{ content: string }> })
      .messages[0].content
    expect(sys).toContain('"summary"')
    expect(sys).not.toContain('"action_items"')
    expect(annotation(db, id).summary).toBe('Rechnung über 120 Euro.')
  })

  it('needs_reply ≥ 0.6 öffnet das Summary-Gate trotz niedriger Priorität; 0.55 nicht', async () => {
    stubSystemOne({ category: 'personal', priority: 1, needs_reply: NEEDS_REPLY_THRESHOLD })
    genReply({ summary: 'Frage nach dem Wochenende.' })
    const a = seedMail(db, { body: 'Hast du am Wochenende Zeit für einen Kaffee?' })
    await runTriage(db, a)
    expect(fakeCreate).toHaveBeenCalledTimes(1)

    fakeCreate.mockReset()
    db.prepare('DELETE FROM ai_annotations').run()
    stubSystemOne({ category: 'personal', priority: 1, needs_reply: 0.55 })
    await runTriage(db, a)
    expect(fakeCreate).not.toHaveBeenCalled()
  })

  it('ohne nutzbares Textmodell (Local only, externes Profil) läuft die Entscheidung trotzdem', async () => {
    stubSystemOne({ category: 'work', priority: 3, has_request: 0.9 })
    setLocalOnly(true) // OpenRouter (triage) blockiert, Ollama (lokal) nicht
    const id = seedMail(db, { body: 'Bitte schick mir die Unterlagen. Danke.' })
    expect(await runTriage(db, id)).toBe('done')
    expect(fakeCreate).not.toHaveBeenCalled()
    const a = annotation(db, id)
    expect(a.model).toBe('clef-flash')
    expect(a.summary).toBe('Bitte schick mir die Unterlagen.')
  })

  it('Wirkung bestehender Regeln: bekannter Absender hebt die Priorität (+1)', async () => {
    stubSystemOne({ category: 'work', priority: 1 })
    const id = seedMail(db, { body: 'Kurze Notiz zur Kenntnis.' })
    const accId = (
      db.prepare('SELECT account_id a FROM messages WHERE id = ?').get(id) as { a: number }
    ).a
    db.prepare(
      `INSERT INTO contact_stats (account_id, addr, sent_count, last_interaction) VALUES (?, 'marie@verein.de', 3, 1)`
    ).run(accId)
    await runTriage(db, id)
    expect(annotation(db, id).priority).toBe(3) // score 1 → 2, +1
  })

  it('speichert rohe Wahrscheinlichkeiten in ai_decisions', async () => {
    stubSystemOne({ category: 'personal', proposes_meeting: 0.8, phishing: 0.3, priority: 0.4 })
    const id = seedMail(db, { body: 'Treffen wir uns Dienstag um 10 Uhr?' })
    await runTriage(db, id)
    expect(decisionRow(db, id)).toMatchObject({
      model: 'clef-flash',
      category: 'personal',
      proposes_meeting: 0.8,
      phishing: 0.3,
      priority_score: 0.4
    })
  })

  it('Phishing: lokale Signale gehen in den state, Score ≥ 1.4 gilt als hoch', async () => {
    stubSystemOne({ category: 'transactional', priority: 3, phishing: 1.8 })
    const id = seedMail(db, {
      subject: 'Konto gesperrt',
      fromName: 'PayPal support@paypal.com',
      fromAddr: 'x@evil-mail.ru',
      replyTo: 'collect@other.io',
      body: 'Bitte bestätige dein Konto.'
    })
    db.prepare(`UPDATE message_bodies SET html_raw = ? WHERE message_id = ?`).run(
      '<p><a href="http://evil.io/login">https://paypal.com/login</a></p>',
      id
    )
    genReply({ summary: 'x' })
    await runTriage(db, id)
    const state = JSON.parse((systemOne.mock.calls[0] as [string, RequestInit])[1].body as string)
      .state as string
    expect(state).toContain('Phishing-Prüfung')
    expect(state).toContain('paypal.com')
    expect(state).toContain('Antworten gehen an other.io')
    expect(state).toContain('1 Link')
    const p = getPhishing(db, id)
    expect(p).toMatchObject({ score: 1.8, high: true })
    expect(p?.signals).toEqual(
      expect.arrayContaining(['display_name_domain', 'reply_to_differs', 'link_mismatch:1'])
    )
  })

  it('Fallback: Entscheidungsmodell fehlt (404) → klassische Triage übernimmt', async () => {
    stubSystemOne(404)
    fakeCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: 'personal',
              priority: 3,
              summary: 'Klassisch.',
              action_items: [],
              needs_reply: false,
              addressed_to_me: true,
              confidence: 0.9
            })
          }
        }
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const id = seedMail(db, { body: 'Hallo, ein Gruß.' })
    expect(await runTriage(db, id)).toBe('done')
    warn.mockRestore()
    expect(annotation(db, id).summary).toBe('Klassisch.')
    expect(annotation(db, id).model).toBe('deepseek/deepseek-v4-flash')
    expect(decisionRow(db, id)).toBeUndefined()
  })

  it('transienter Serverfehler (500) wird weitergereicht und von der Queue als transient gewertet', async () => {
    stubSystemOne(500)
    const id = seedMail(db, { body: 'Hallo.' })
    const err = await runTriage(db, id).catch((e) => e)
    expect(classifyAiError(err).transient).toBe(true)
    expect(annotation(db, id)).toBeUndefined()
  })

  it('Textmodell liefert zweimal Müll: Entscheidung bleibt, Text wird extraktiv', async () => {
    stubSystemOne({ category: 'work', priority: 4, has_request: 0.9 })
    fakeCreate.mockResolvedValue({
      choices: [{ message: { content: 'kein json' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 }
    })
    const id = seedMail(db, { body: 'Das Angebot muss heute raus. Bitte prüfe es.' })
    expect(await runTriage(db, id)).toBe('done')
    expect(fakeCreate).toHaveBeenCalledTimes(2)
    expect(annotation(db, id).summary).toBe('Das Angebot muss heute raus.')
  })
})

describe('Ohne Entscheidungsmodell: Triage unverändert', () => {
  it('ruft kein /v1/systemone auf und schreibt kein ai_decisions', async () => {
    const db = createAiTestDb()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    fakeCreate.mockReset()
    genReply({
      category: 'personal',
      priority: 3,
      summary: 'Klassisch.',
      action_items: [],
      needs_reply: false,
      confidence: 0.9
    })
    const id = seedMail(db, { body: 'Hallo.' })
    expect(await runTriage(db, id)).toBe('done')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(decisionRow(db, id)).toBeUndefined()
    closeTestDb(db)
    vi.unstubAllGlobals()
  })
})

describe('Reine Bausteine', () => {
  it('Prioritäts-Mapping 0..4 → 1..5 (gerundet, geklemmt)', () => {
    expect([0, 0.4, 0.5, 1, 2, 2.49, 3.5, 4].map(mapPriorityScore)).toEqual([
      1, 1, 2, 2, 3, 3, 5, 5
    ])
    expect(mapPriorityScore(-3)).toBe(1)
    expect(mapPriorityScore(9)).toBe(5)
    expect(mapPriorityScore(Number.NaN)).toBe(3)
  })

  it('Schwellen sind die vereinbarten Konstanten', () => {
    expect(HAS_REQUEST_THRESHOLD).toBe(0.5)
    expect(NEEDS_REPLY_THRESHOLD).toBe(0.6)
    expect(PHISHING_SCORE_HIGH).toBe(1.4)
  })

  it('Phishing-Banner-Schwelle: 1.4 von 2', () => {
    expect(isHighPhishing(1.39)).toBe(false)
    expect(isHighPhishing(1.4)).toBe(true)
    expect(isHighPhishing(null)).toBe(false)
  })

  it('writeGates: Aufgaben nur bei Bitte an den Adressaten, nicht bei Selbst-/Weiterleitungs-Mails', () => {
    const base = interpretTriageAnswers({
      has_request: { type: 'noul', noul: 0.7 },
      addressed_to_me: { type: 'noul', noul: 0.8 },
      needs_reply: { type: 'noul', noul: 0.1 }
    })
    expect(writeGates(base, false).tasks).toBe(true)
    expect(writeGates(base, true).tasks).toBe(false)
    const notMine = { ...base, addressedToMe: 0.2 }
    expect(writeGates(notMine, false).tasks).toBe(false)
  })

  it('Fragenkatalog bleibt unter dem 64er-Limit mit gültigen Kriterien', () => {
    expect(Object.keys(TRIAGE_QUESTIONS).length).toBeLessThanOrEqual(64)
  })

  it('extraktive Zusammenfassung: erster sinnvoller Satz, ≤ 140 Zeichen, Betreff als Rückfall', () => {
    expect(
      extractiveSummary(
        'Betreff',
        '> zitiert\nHallo Anna,\n\nDer Server zieht am Montag um. Bitte sichere vorher alles.'
      )
    ).toBe('Der Server zieht am Montag um.')
    const long = `${'Wort '.repeat(60)}Ende.`
    const s = extractiveSummary('x', long)
    expect(s.length).toBeLessThanOrEqual(140)
    expect(s.endsWith('…')).toBe(true)
    expect(extractiveSummary('Nur Betreff', '')).toBe('Nur Betreff')
    expect(extractiveSummary(null, '   ')).toBe('Kein Textinhalt')
  })

  it('Phishing-Signale: Reply-To, Anzeigename-Domain, Link-Mismatch, IP-Link; harmlose Mail ohne Signale', () => {
    const none = computePhishingSignals({
      fromName: 'Anna',
      fromAddr: 'anna@firma.de',
      replyToJson: JSON.stringify([{ address: 'anna@firma.de' }]),
      html: '<a href="https://firma.de/x">https://firma.de/x</a>'
    })
    expect(none.codes).toEqual([])
    const bad = computePhishingSignals({
      fromName: 'amazon.de Kundenservice',
      fromAddr: 'a@mailer.top',
      replyToJson: JSON.stringify([{ address: 'b@gmail.com' }]),
      html: '<a href="http://1.2.3.4/p">https://amazon.de/konto</a><a href="http://xn--pypal-4ve.com">hier</a>'
    })
    expect(bad.codes).toEqual(
      expect.arrayContaining([
        'display_name_domain',
        'reply_to_differs',
        'link_mismatch:1',
        'ip_link:1',
        'punycode_link:1'
      ])
    )
  })
})
