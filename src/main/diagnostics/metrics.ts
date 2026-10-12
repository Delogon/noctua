import { performance } from 'node:perf_hooks'
import {
  emptyHistogram,
  observe,
  summarize,
  type Histogram,
  type TimingSummary
} from '@shared/histogram'

export { BUCKETS_MS, percentile, type TimingSummary } from '@shared/histogram'

// Lokale Leistungs-Messung (Diagnose für große Postfächer). Erfasst werden
// ausschließlich Namen von Operationen (Code-Bezeichner, normalisiertes SQL ohne
// Werte) und Zahlen — nie Betreffs, Adressen, Inhalte oder Pfade. Alles bleibt im
// Speicher bzw. im App-Datenordner, bis der Nutzer selbst ein ZIP exportiert.

const MAX_NAMES = 2000
const MAX_SQL = 1000
const MAX_SLOW = 100
const OTHER = '(other)'

/** Zusatzdaten nur als Zahlen/Wahrheitswerte — so kann kein Mail-Text hineinrutschen. */
export type Meta = Record<string, number | boolean>

interface SqlStat extends Histogram {
  prepares: number
  prepareMs: number
  rows: number
}

export interface SqlSummary extends TimingSummary {
  prepares: number
  prepareMs: number
  rows: number
}

export interface SlowEvent {
  name: string
  ms: number
  at: number
  meta?: Meta
}

export interface MetricsSnapshot {
  startedAt: number
  takenAt: number
  enabled: boolean
  timings: TimingSummary[]
  sql: SqlSummary[]
  counters: Record<string, number>
  gauges: Record<string, number>
  slow: SlowEvent[]
}

function cleanMeta(meta: Meta | undefined): Meta | undefined {
  if (!meta) return undefined
  const out: Meta = {}
  for (const [key, value] of Object.entries(meta).slice(0, 12)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key)) continue
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      out[key] = value
    }
  }
  return out
}

const fingerprints = new Map<string, string>()

/**
 * Normalisiertes SQL als Schlüssel: Whitespace zusammengefasst, Literale und
 * Platzhalterlisten durch „?" ersetzt (keine Werte im Export, keine Explosion
 * der Schlüssel durch IN (?, ?, …) unterschiedlicher Länge).
 */
export function sqlFingerprint(sql: string): string {
  const cached = fingerprints.get(sql)
  if (cached !== undefined) return cached
  const fp = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .replace(/\?(?:\s*,\s*\?)+/g, '?…')
    .trim()
    .slice(0, 400)
  if (fingerprints.size > 5000) fingerprints.clear()
  fingerprints.set(sql, fp)
  return fp
}

export class Metrics {
  enabled = true
  /** Ereignisse ab dieser Dauer landen im Slow-Log */
  slowThresholdMs = 100
  startedAt = Date.now()
  private timings = new Map<string, Histogram>()
  private sqlStats = new Map<string, SqlStat>()
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private slow: SlowEvent[] = []

  record(name: string, ms: number, meta?: Meta): void {
    if (!this.enabled || !Number.isFinite(ms)) return
    let h = this.timings.get(name)
    if (!h) {
      if (this.timings.size >= MAX_NAMES) name = OTHER
      h = this.timings.get(name) ?? emptyHistogram()
      this.timings.set(name, h)
    }
    observe(h, ms)
    if (ms >= this.slowThresholdMs) this.noteSlow(name, ms, meta)
  }

  count(name: string, n = 1): void {
    if (!this.enabled) return
    if (!this.counters.has(name) && this.counters.size >= MAX_NAMES) name = OTHER
    this.counters.set(name, (this.counters.get(name) ?? 0) + n)
  }

  gauge(name: string, value: number): void {
    if (!this.enabled || !Number.isFinite(value)) return
    if (!this.gauges.has(name) && this.gauges.size >= MAX_NAMES) return
    this.gauges.set(name, value)
  }

  /** Synchron messen; Fehler werden weitergereicht und trotzdem gemessen. */
  time<T>(name: string, fn: () => T, meta?: Meta): T {
    if (!this.enabled) return fn()
    const start = performance.now()
    try {
      return fn()
    } finally {
      this.record(name, performance.now() - start, meta)
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>, meta?: Meta): Promise<T> {
    if (!this.enabled) return fn()
    const start = performance.now()
    try {
      return await fn()
    } finally {
      this.record(name, performance.now() - start, meta)
    }
  }

  /** Für Messungen über mehrere Stellen: end(meta) schließt die Spanne. */
  span(name: string): (meta?: Meta) => void {
    const start = performance.now()
    return (meta) => this.record(name, performance.now() - start, meta)
  }

  sqlPrepare(fp: string, ms: number): void {
    if (!this.enabled) return
    const s = this.sqlStat(fp)
    s.prepares += 1
    s.prepareMs += ms
  }

  sqlExec(fp: string, ms: number, rows: number): void {
    if (!this.enabled) return
    const s = this.sqlStat(fp)
    observe(s, ms)
    s.rows += rows
    if (ms >= this.slowThresholdMs) this.noteSlow(`sql: ${fp.slice(0, 160)}`, ms, { rows })
  }

  private sqlStat(fp: string): SqlStat {
    let s = this.sqlStats.get(fp)
    if (!s) {
      const key = this.sqlStats.size >= MAX_SQL ? OTHER : fp
      s = this.sqlStats.get(key) ?? { ...emptyHistogram(), prepares: 0, prepareMs: 0, rows: 0 }
      this.sqlStats.set(key, s)
    }
    return s
  }

  private noteSlow(name: string, ms: number, meta?: Meta): void {
    const event: SlowEvent = { name, ms: Math.round(ms * 10) / 10, at: Date.now() }
    const clean = cleanMeta(meta)
    if (clean && Object.keys(clean).length > 0) event.meta = clean
    this.slow.push(event)
    if (this.slow.length > MAX_SLOW * 2) {
      // die langsamsten behalten, bei Gleichstand die jüngeren
      this.slow.sort((a, b) => b.ms - a.ms || b.at - a.at)
      this.slow.length = MAX_SLOW
    }
  }

  /** Summen für die Zeitreihe (Deltas pro Messintervall). */
  totals(): { sqlCalls: number; sqlMs: number; ipcCalls: number; ipcMs: number } {
    let sqlCalls = 0
    let sqlMs = 0
    for (const s of this.sqlStats.values()) {
      sqlCalls += s.count
      sqlMs += s.totalMs + s.prepareMs
    }
    let ipcCalls = 0
    let ipcMs = 0
    for (const [name, h] of this.timings) {
      if (!name.startsWith('ipc.')) continue
      ipcCalls += h.count
      ipcMs += h.totalMs
    }
    return { sqlCalls, sqlMs, ipcCalls, ipcMs }
  }

  snapshot(): MetricsSnapshot {
    const timings = [...this.timings].map(([name, h]) => summarize(name, h))
    const sql = [...this.sqlStats].map(([name, s]) => ({
      ...summarize(name, s),
      prepares: s.prepares,
      prepareMs: Math.round(s.prepareMs * 100) / 100,
      rows: s.rows
    }))
    return {
      startedAt: this.startedAt,
      takenAt: Date.now(),
      enabled: this.enabled,
      timings: timings.sort((a, b) => b.totalMs - a.totalMs),
      sql: sql.sort((a, b) => b.totalMs + b.prepareMs - (a.totalMs + a.prepareMs)),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      slow: [...this.slow].sort((a, b) => b.ms - a.ms).slice(0, MAX_SLOW)
    }
  }

  reset(): void {
    this.timings.clear()
    this.sqlStats.clear()
    this.counters.clear()
    this.gauges.clear()
    this.slow = []
    this.startedAt = Date.now()
  }
}

export const metrics = new Metrics()
