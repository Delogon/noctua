import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { matches, ruleJsonSchema, ruleNeedsAi, applyRules } from '@main/ai/rules'
import { setRuleActionExecutor } from '@main/ai/rules'
import { createTestDb, closeTestDb, seedAccount, seedFolder } from '../helpers/db'

const facts = (over: Partial<Parameters<typeof matches>[1]> = {}): Parameters<typeof matches>[1] => ({
  id: 1,
  from_addr: 'news@shop.de',
  from_name: 'Shop',
  subject: 'Angebot der Woche',
  list_unsubscribe: 1,
  category: 'promotions',
  priority: 2,
  ...over
})

describe('matches', () => {
  it('fromContains prüft Adresse und Name (case-insensitive)', () => {
    expect(matches({ match: { fromContains: ['shop'] }, actions: { archive: true } }, facts())).toBe(true)
    expect(matches({ match: { fromContains: ['bank'] }, actions: { archive: true } }, facts())).toBe(false)
  })

  it('fromDomain matcht exakt und auf Subdomains', () => {
    expect(
      matches({ match: { fromDomain: ['shop.de'] }, actions: { archive: true } }, facts({ from_addr: 'a@shop.de' }))
    ).toBe(true)
    expect(
      matches({ match: { fromDomain: ['shop.de'] }, actions: { archive: true } }, facts({ from_addr: 'a@mail.shop.de' }))
    ).toBe(true)
    expect(
      matches({ match: { fromDomain: ['shop.de'] }, actions: { archive: true } }, facts({ from_addr: 'a@shop.de.evil.com' }))
    ).toBe(false)
  })

  it('subjectContains ist case-insensitive', () => {
    expect(matches({ match: { subjectContains: ['ANGEBOT'] }, actions: { archive: true } }, facts())).toBe(true)
  })

  it('listUnsubscribe vergleicht boolesch', () => {
    expect(matches({ match: { listUnsubscribe: true }, actions: { archive: true } }, facts({ list_unsubscribe: 1 }))).toBe(true)
    expect(matches({ match: { listUnsubscribe: true }, actions: { archive: true } }, facts({ list_unsubscribe: 0 }))).toBe(false)
  })

  it('category und Prioritätsgrenzen', () => {
    expect(matches({ match: { category: ['promotions'] }, actions: { archive: true } }, facts())).toBe(true)
    expect(matches({ match: { minPriority: 4 }, actions: { archive: true } }, facts({ priority: 2 }))).toBe(false)
    expect(matches({ match: { maxPriority: 2 }, actions: { archive: true } }, facts({ priority: 2 }))).toBe(true)
  })

  it('kombiniert Kriterien als UND', () => {
    const rule = { match: { fromDomain: ['shop.de'], subjectContains: ['angebot'] }, actions: { archive: true } }
    expect(matches(rule, facts())).toBe(true)
    expect(matches(rule, facts({ subject: 'Rechnung' }))).toBe(false)
  })
})

describe('ruleJsonSchema', () => {
  it('lehnt leeres match oder leere actions ab', () => {
    expect(() => ruleJsonSchema.parse({ match: {}, actions: { archive: true } })).toThrow()
    expect(() => ruleJsonSchema.parse({ match: { fromContains: ['x'] }, actions: {} })).toThrow()
  })
  it('akzeptiert eine minimale gültige Regel', () => {
    expect(() =>
      ruleJsonSchema.parse({ match: { fromContains: ['x'] }, actions: { archive: true } })
    ).not.toThrow()
  })
})

describe('ruleNeedsAi', () => {
  it('ist true bei Kategorie/Priorität, false bei Absender/Betreff', () => {
    expect(ruleNeedsAi({ match: { category: ['newsletter'] }, actions: { archive: true } })).toBe(true)
    expect(ruleNeedsAi({ match: { minPriority: 4 }, actions: { flag: true } })).toBe(true)
    expect(ruleNeedsAi({ match: { fromDomain: ['x.de'] }, actions: { archive: true } })).toBe(false)
  })
})

describe('applyRules (Integration)', () => {
  let db: Database.Database

  afterEach(() => closeTestDb(db))

  function insertMessage(fromAddr: string, subject: string): number {
    const accountId = seedAccount(db, { email: 'me@test.de' })
    const folderId = seedFolder(db, accountId, '\\Inbox')
    const r = db
      .prepare(
        `INSERT INTO messages (account_id, folder_id, uid, from_addr, from_name, subject, thread_key, date, list_unsubscribe)
         VALUES (?, ?, 1, ?, 'X', ?, 'tk', 1000, 1)`
      )
      .run(accountId, folderId, fromAddr, subject)
    return Number(r.lastInsertRowid)
  }

  it('setCategory schreibt ein user_override', () => {
    db = createTestDb()
    const msgId = insertMessage('news@shop.de', 'Angebot')
    db.prepare(
      `INSERT INTO rules (name, description, source_text, rule_json, needs_ai, enabled, created_at)
       VALUES ('r', '', 'src', ?, 0, 1, 1000)`
    ).run(JSON.stringify({ match: { fromDomain: ['shop.de'] }, actions: { setCategory: 'promotions' } }))

    applyRules(db, msgId, 'ingest')
    const ann = db.prepare('SELECT user_override_category FROM ai_annotations WHERE message_id = ?').get(msgId) as
      | { user_override_category: string }
      | undefined
    expect(ann?.user_override_category).toBe('promotions')
  })

  it('archive ruft den Executor genau einmal auf', () => {
    db = createTestDb()
    const calls: Array<{ ids: number[]; action: string }> = []
    setRuleActionExecutor((ids, action) => calls.push({ ids, action }))
    const msgId = insertMessage('news@shop.de', 'Angebot')
    db.prepare(
      `INSERT INTO rules (name, description, source_text, rule_json, needs_ai, enabled, created_at)
       VALUES ('r', '', 'src', ?, 0, 1, 1000)`
    ).run(JSON.stringify({ match: { subjectContains: ['angebot'] }, actions: { archive: true } }))

    applyRules(db, msgId, 'ingest')
    expect(calls).toEqual([{ ids: [msgId], action: 'archive' }])
    setRuleActionExecutor(() => {})
  })

  it('führt AI-Regeln nur in der post-triage-Phase aus', () => {
    db = createTestDb()
    let called = false
    setRuleActionExecutor(() => {
      called = true
    })
    const msgId = insertMessage('a@b.de', 'irgendwas')
    db.prepare('INSERT INTO ai_annotations (message_id, category, priority, prompt_version, needs_reply, created_at) VALUES (?, ?, 5, 3, 0, 1000)').run(
      msgId,
      'work'
    )
    db.prepare(
      `INSERT INTO rules (name, description, source_text, rule_json, needs_ai, enabled, created_at)
       VALUES ('r', '', 'src', ?, 1, 1, 1000)`
    ).run(JSON.stringify({ match: { minPriority: 4 }, actions: { archive: true } }))

    applyRules(db, msgId, 'ingest') // AI-Regel darf hier NICHT feuern
    expect(called).toBe(false)
    applyRules(db, msgId, 'post-triage')
    expect(called).toBe(true)
    setRuleActionExecutor(() => {})
  })
})
