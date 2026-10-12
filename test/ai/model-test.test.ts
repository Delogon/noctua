import { describe, expect, it, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { evaluateTestReply } from '@main/ai/model-test'
import { providerBody, zdrOnly } from '@main/ai/openrouter'
import { setSetting } from '@main/db'
import { createTestDb, closeTestDb } from '../helpers/db'

// M86: Funktions-Test für eigene OpenRouter-Modelle + ZDR-Routing.

describe('evaluateTestReply', () => {
  it('akzeptiert sauberes Triage-JSON', () => {
    expect(evaluateTestReply('{"category":"work","priority":3}')).toEqual({
      ok: true,
      detail: null
    })
  })

  it('toleriert Codefences und Umgebungstext', () => {
    const raw = 'Gerne!\n```json\n{"category":"personal","priority":2}\n```'
    expect(evaluateTestReply(raw).ok).toBe(true)
  })

  it('lehnt Antworten ohne JSON ab — mit Auszug im Detail', () => {
    const verdict = evaluateTestReply('Ich bin ein hilfreiches Sprachmodell.')
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain('kein JSON')
  })

  it('lehnt JSON ohne category oder mit unbrauchbarer priority ab', () => {
    expect(evaluateTestReply('{"priority":3}').ok).toBe(false)
    expect(evaluateTestReply('{"category":"work","priority":9}').ok).toBe(false)
    expect(evaluateTestReply('{"category":"","priority":1}').ok).toBe(false)
  })

  it('lehnt kaputtes JSON ab', () => {
    expect(evaluateTestReply('{"category": "work", priority: }').ok).toBe(false)
  })
})

describe('ZDR-Routing (providerBody)', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('standardmäßig an: data_collection deny', () => {
    db = createTestDb()
    expect(zdrOnly()).toBe(true)
    expect(providerBody()).toEqual({ provider: { data_collection: 'deny' } })
  })

  it('abschaltbar über ai.zdrOnly = 0', () => {
    db = createTestDb()
    setSetting('ai.zdrOnly', '0')
    expect(zdrOnly()).toBe(false)
    expect(providerBody()).toEqual({})
    setSetting('ai.zdrOnly', '1')
    expect(zdrOnly()).toBe(true)
  })
})
