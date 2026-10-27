import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { outputLanguage, outputLanguageName } from '@main/ai/output-language'
import { buildHybridWritePrompt, interpretTriageAnswers } from '@main/ai/decision-triage'
import { eventsSystemPrompt } from '@main/ai/events'
import { closeTestDb, createTestDb } from '../helpers/db'

describe('Ausgabesprache der Modelle', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => closeTestDb(db))

  const setLanguage = (value: string): void => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('ui.language', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(value)
  }

  it('folgt der App-Sprache, Standard Deutsch', () => {
    expect(outputLanguage()).toBe('de')
    setLanguage('en')
    expect(outputLanguage()).toBe('en')
    setLanguage('de')
    expect(outputLanguage()).toBe('de')
    expect(outputLanguageName('de')).toBe('German')
    expect(outputLanguageName('en')).toBe('English')
  })

  it('englische Prompts verlangen Text in der App-Sprache', () => {
    const decision = interpretTriageAnswers({})
    const gates = { tasks: true, summary: true }
    expect(buildHybridWritePrompt(gates, decision, 'de')).toContain('one line in German')
    expect(buildHybridWritePrompt(gates, decision, 'en')).toContain('one line in English')
    setLanguage('en')
    expect(buildHybridWritePrompt(gates, decision)).toContain('in English')
    expect(eventsSystemPrompt()).toContain('short title of the appointment, in English')
  })
})
