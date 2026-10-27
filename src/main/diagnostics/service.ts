import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { metrics, type MetricsSnapshot, type TimingSummary } from './metrics'
import { instrumentDb } from './db-profiler'
import { ProcessSampler, type AppProcessMetric, type ProcessSample } from './sampler'
import { collectDatasetStats } from './dataset'
import { runBenchmark, type BenchmarkResult } from './benchmark'
import { createZip, type ZipEntry } from './zip'

// Diagnostics service: ties together measurement (metrics + SQL profiler), time series,
// mailbox statistics and benchmark. Data stays on the device: in memory
// and as session files in the app data folder (`diagnostics/`), until the user
// exports a ZIP themselves. There is no upload.

export const DIAGNOSTICS_SETTING = 'diagnostics.enabled'
const PERSIST_INTERVAL_MS = 5 * 60_000
const KEEP_SESSIONS = 5

export interface RendererDiagnostics {
  ipc: TimingSummary[]
  longTasks: {
    count: number
    totalMs: number
    maxMs: number
    recent: Array<{ at: number; ms: number }>
  }
  heapUsedMb: number | null
}

export interface DiagnosticsDeps {
  db: Database.Database
  dbPath: string | null
  /** Folder for session files (userData/diagnostics) */
  dir: string
  appInfo: () => Record<string, string | number | boolean | null>
  getAppMetrics?: () => AppProcessMetric[]
}

interface SessionFile {
  format: 'noctua-diagnostics-session/1'
  startedAt: number
  savedAt: number
  metrics: MetricsSnapshot
  samples: ProcessSample[]
}

export interface DiagnosticsStatus {
  enabled: boolean
  startedAt: number
  sampleCount: number
  storedSessions: number
  latest: ProcessSample | null
  topOperations: TimingSummary[]
  topQueries: TimingSummary[]
  slow: Array<{ name: string; ms: number; at: number }>
  benchmark: BenchmarkResult | null
}

const README = `Noctua – Diagnose-Export / diagnostics export
=============================================

Dieses Archiv wurde auf deinem Gerät erzeugt und nirgendwohin gesendet.
Du entscheidest, ob und mit wem du es teilst.
This archive was created on your device and has not been sent anywhere.

Enthalten / contents
- manifest.json     App- und Systemversion, CPU-Modell/-Anzahl, Arbeitsspeicher
- metrics.json      Laufzeiten je Operation (Namen aus dem Code), SQL-Statistik je
                    normalisierter Abfrage (ohne Werte), Zähler, Slow-Log
- samples.json      Zeitreihe: CPU, Speicher, Event-Loop-Verzögerung, SQL/IPC-Last
- dataset.json      Größe des Postfachs: nur Anzahlen (Nachrichten, Threads, Ordner
                    je Rolle, Anhänge, Index-Stand), Konten als „1, 2, …" + Anbieter
- benchmark.json    Laufzeiten typischer Abfragen + Abfragepläne (Tabellen/Indizes)
- renderer.json     Oberfläche: IPC-Antwortzeiten, lange Tasks (Ruckler)
- sessions/         gleiche Messwerte aus früheren App-Sitzungen

Nicht enthalten / not included
Keine Betreffs, Absender, Adressen, Inhalte, Anhänge, Suchbegriffe, Kontonamen,
Dateipfade, Hostnamen, Schlüssel oder Passwörter.
No subjects, senders, addresses, message content, attachments, search terms,
account names, file paths, host names, keys or passwords.
`

export class DiagnosticsService {
  private deps: DiagnosticsDeps | null = null
  private sampler: ProcessSampler | null = null
  private persistTimer: NodeJS.Timeout | null = null
  private lastBenchmark: BenchmarkResult | null = null

  init(deps: DiagnosticsDeps): void {
    this.deps = deps
    const setting = deps.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(DIAGNOSTICS_SETTING) as { value: string } | undefined
    metrics.enabled = setting?.value !== '0'
    instrumentDb(deps.db)
    this.sampler = new ProcessSampler(deps.getAppMetrics ?? null)
    if (metrics.enabled) this.start()
  }

  private start(): void {
    this.sampler?.start()
    if (!this.persistTimer) {
      this.persistTimer = setInterval(() => this.persist(), PERSIST_INTERVAL_MS)
      this.persistTimer.unref?.()
    }
  }

  stop(): void {
    this.sampler?.stop()
    if (this.persistTimer) clearInterval(this.persistTimer)
    this.persistTimer = null
  }

  setEnabled(enabled: boolean): void {
    const db = this.deps?.db
    db?.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(DIAGNOSTICS_SETTING, enabled ? '1' : '0')
    metrics.enabled = enabled
    if (enabled) this.start()
    else this.stop()
  }

  /** Write the session file (every 5 min and on quit). */
  persist(): void {
    if (!this.deps || !metrics.enabled) return
    try {
      mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 })
      const file: SessionFile = {
        format: 'noctua-diagnostics-session/1',
        startedAt: metrics.startedAt,
        savedAt: Date.now(),
        metrics: metrics.snapshot(),
        samples: this.sampler?.list() ?? []
      }
      writeFileSync(
        join(this.deps.dir, `session-${metrics.startedAt}.json`),
        JSON.stringify(file),
        {
          mode: 0o600
        }
      )
      this.pruneSessions()
    } catch (error) {
      console.warn('[diagnostics] Sitzung nicht gespeichert:', error)
    }
  }

  private sessionFiles(): string[] {
    if (!this.deps) return []
    try {
      return readdirSync(this.deps.dir)
        .filter((f) => /^session-\d+\.json$/.test(f))
        .sort()
    } catch {
      return []
    }
  }

  private pruneSessions(): void {
    const files = this.sessionFiles()
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_SESSIONS))) {
      rmSync(join(this.deps!.dir, f), { force: true })
    }
  }

  status(): DiagnosticsStatus {
    const snap = metrics.snapshot()
    const samples = this.sampler?.list() ?? []
    return {
      enabled: metrics.enabled,
      startedAt: snap.startedAt,
      sampleCount: samples.length,
      storedSessions: this.sessionFiles().length,
      latest: samples.at(-1) ?? null,
      topOperations: snap.timings.slice(0, 8),
      topQueries: snap.sql.slice(0, 5),
      slow: snap.slow.slice(0, 8).map(({ name, ms, at }) => ({ name, ms, at })),
      benchmark: this.lastBenchmark
    }
  }

  async benchmark(): Promise<BenchmarkResult> {
    if (!this.deps) throw new Error('Diagnose nicht initialisiert')
    this.lastBenchmark = await runBenchmark(this.deps.db)
    return this.lastBenchmark
  }

  /** Contents of the export ZIP (without writing – testable). */
  async bundle(renderer: RendererDiagnostics | null, withBenchmark: boolean): Promise<ZipEntry[]> {
    if (!this.deps) throw new Error('Diagnose nicht initialisiert')
    if (withBenchmark) await this.benchmark()
    const json = (value: unknown): string => JSON.stringify(value, null, 2)
    const entries: ZipEntry[] = [
      { name: 'README.txt', data: README },
      {
        name: 'manifest.json',
        data: json({
          format: 'noctua-diagnostics/1',
          createdAt: new Date().toISOString(),
          diagnosticsEnabled: metrics.enabled,
          ...this.deps.appInfo(),
          sqlite: this.sqliteVersion()
        })
      },
      { name: 'metrics.json', data: json(metrics.snapshot()) },
      { name: 'samples.json', data: json(this.sampler?.list() ?? []) },
      { name: 'dataset.json', data: json(collectDatasetStats(this.deps.db, this.deps.dbPath)) }
    ]
    if (this.lastBenchmark) entries.push({ name: 'benchmark.json', data: json(this.lastBenchmark) })
    if (renderer) entries.push({ name: 'renderer.json', data: json(renderer) })
    const current = `session-${metrics.startedAt}.json`
    for (const f of this.sessionFiles()) {
      if (f === current) continue
      try {
        entries.push({ name: `sessions/${f}`, data: readFileSync(join(this.deps.dir, f)) })
      } catch {
        // unreadable: skip
      }
    }
    return entries
  }

  async exportZip(
    filePath: string,
    renderer: RendererDiagnostics | null,
    withBenchmark: boolean
  ): Promise<number> {
    const zip = createZip(await this.bundle(renderer, withBenchmark))
    writeFileSync(filePath, zip, { mode: 0o600 })
    return zip.length
  }

  private sqliteVersion(): string | null {
    try {
      const row = this.deps!.db.prepare('SELECT sqlite_version() v').get() as { v: string }
      return row.v
    } catch {
      return null
    }
  }

  /** Discard everything: measurements, time series, benchmark, session files. */
  clear(): void {
    metrics.reset()
    this.sampler?.clear()
    this.lastBenchmark = null
    if (this.deps) rmSync(this.deps.dir, { recursive: true, force: true })
  }
}

export const diagnostics = new DiagnosticsService()
