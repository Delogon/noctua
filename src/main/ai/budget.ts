import type Database from 'better-sqlite3-multiple-ciphers'
import { getSetting } from '../db'

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function logUsage(
  db: Database.Database,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number
): void {
  db.prepare(
    `INSERT INTO ai_usage_log (day, model, requests, input_tokens, output_tokens, cost_usd)
     VALUES (?, ?, 1, ?, ?, ?)
     ON CONFLICT(day, model) DO UPDATE SET
       requests = requests + 1,
       input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_usd = cost_usd + excluded.cost_usd`
  ).run(todayKey(), model, inputTokens, outputTokens, costUsd)
}

/**
 * Budget setting as a number; empty, NaN, Infinity or negative yields the default —
 * otherwise a broken value (NaN >= x is always false) would bypass the gate.
 */
function budgetSetting(key: string, fallback: number): number {
  const raw = getSetting(key)
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function getDailyBudgetUsd(): number {
  return budgetSetting('ai.dailyBudgetUsd', 0.5)
}

export function getMonthlyBudgetUsd(): number {
  return budgetSetting('ai.monthlyBudgetUsd', 10)
}

export function getUsageSummary(db: Database.Database): {
  todayCostUsd: number
  monthCostUsd: number
} {
  const today = todayKey()
  const month = today.slice(0, 7)
  const todayCost = db
    .prepare('SELECT coalesce(sum(cost_usd), 0) c FROM ai_usage_log WHERE day = ?')
    .get(today) as { c: number }
  const monthCost = db
    .prepare(`SELECT coalesce(sum(cost_usd), 0) c FROM ai_usage_log WHERE day LIKE ? || '-%'`)
    .get(month) as { c: number }
  return { todayCostUsd: todayCost.c, monthCostUsd: monthCost.c }
}

/** Hard gate: check before every request; when exceeded, the queue pauses. */
export function isBudgetExceeded(db: Database.Database): boolean {
  const { todayCostUsd, monthCostUsd } = getUsageSummary(db)
  return todayCostUsd >= getDailyBudgetUsd() || monthCostUsd >= getMonthlyBudgetUsd()
}
