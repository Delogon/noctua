import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3'
import { logUsage, getUsageSummary, isBudgetExceeded, todayKey } from '@main/ai/budget'
import { setSetting } from '@main/db'
import { createTestDb, closeTestDb } from '../helpers/db'

describe('budget', () => {
  let db: Database.Database | undefined
  afterEach(() => {
    if (db) closeTestDb(db)
    db = undefined
  })

  it('todayKey liefert ein ISO-Datum', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('logUsage akkumuliert Requests, Tokens und Kosten pro Tag/Modell', () => {
    db = createTestDb()
    logUsage(db, 'deepseek/deepseek-v4-flash', 100, 50, 0.001)
    logUsage(db, 'deepseek/deepseek-v4-flash', 200, 60, 0.002)
    const row = db
      .prepare('SELECT requests, input_tokens, cost_usd FROM ai_usage_log WHERE model = ?')
      .get('deepseek/deepseek-v4-flash') as {
      requests: number
      input_tokens: number
      cost_usd: number
    }
    expect(row.requests).toBe(2)
    expect(row.input_tokens).toBe(300)
    expect(row.cost_usd).toBeCloseTo(0.003, 6)
  })

  it('getUsageSummary summiert Tages- und Monatskosten', () => {
    db = createTestDb()
    logUsage(db, 'm', 0, 0, 0.05)
    const s = getUsageSummary(db)
    expect(s.todayCostUsd).toBeCloseTo(0.05, 6)
    expect(s.monthCostUsd).toBeCloseTo(0.05, 6)
  })

  it('isBudgetExceeded greift am Tagesbudget', () => {
    db = createTestDb()
    setSetting('ai.dailyBudgetUsd', '0.10')
    expect(isBudgetExceeded(db)).toBe(false)
    logUsage(db, 'm', 0, 0, 0.15)
    expect(isBudgetExceeded(db)).toBe(true)
  })

  it('isBudgetExceeded greift am Monatslimit', () => {
    db = createTestDb()
    setSetting('ai.dailyBudgetUsd', '999')
    setSetting('ai.monthlyBudgetUsd', '1')
    logUsage(db, 'm', 0, 0, 1.5)
    expect(isBudgetExceeded(db)).toBe(true)
  })
})
