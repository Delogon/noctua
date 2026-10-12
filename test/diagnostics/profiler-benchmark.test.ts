import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { metrics } from '@main/diagnostics/metrics'
import { instrumentDb, withSqlCapture } from '@main/diagnostics/db-profiler'
import { analysePlan, runBenchmark } from '@main/diagnostics/benchmark'
import { DiagnosticsService } from '@main/diagnostics/service'
import { upsertEnvelope, storeBody } from '@main/mail/ingest'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

const SECRET_SUBJECT = 'Geheimprojekt Zebra-4711'
const SECRET_ADDR = 'vertraulich.person@example.org'

function seedMailbox(db: Database.Database, n: number): void {
  const acc = seedAccount(db, { email: 'owner@example.org' })
  const inbox = seedFolder(db, acc, '\\Inbox')
  const sent = seedFolder(db, acc, '\\Sent')
  for (let i = 1; i <= n; i++) {
    const folder = i % 4 === 0 ? sent : inbox
    const res = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({
        uid: i,
        messageId: `<m${i}@t>`,
        subject: i === 1 ? SECRET_SUBJECT : `Betreff ${i % 7}`,
        fromAddr: i === 1 ? SECRET_ADDR : `sender${i % 5}@example.org`,
        fromName: 'Absender',
        to: [{ name: null, address: i % 4 === 0 ? SECRET_ADDR : 'owner@example.org' }],
        date: 1_700_000_000_000 + i * 60_000
      })
    )!
    storeBody(db, res.messageId, {
      messageId: `<m${i}@t>`,
      inReplyTo: null,
      references: [],
      subject: SECRET_SUBJECT,
      from: { name: 'Absender', address: SECRET_ADDR },
      to: [],
      cc: [],
      replyTo: [],
      date: 1_700_000_000_000,
      text: `Text der Nachricht ${i} mit ${SECRET_SUBJECT}`,
      html: null,
      snippet: 'x',
      attachments: []
    })
  }
}

describe('SQL-Profiler und Benchmark', () => {
  let db: Database.Database
  let dir: string
  beforeEach(() => {
    db = createTestDb()
    metrics.reset()
    metrics.enabled = true
    instrumentDb(db)
    dir = mkdtempSync(join(tmpdir(), 'noctua-diag-'))
  })
  afterEach(() => {
    closeTestDb(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('misst Anweisungen je normalisiertem SQL; Transaktionen, pluck und iterate funktionieren weiter', () => {
    seedMailbox(db, 10)
    const count = db.prepare('SELECT count(*) FROM messages WHERE uid > ?').pluck().get(0)
    expect(count).toBe(10)
    expect([...db.prepare('SELECT id FROM messages').iterate()]).toHaveLength(10)
    db.transaction(() => db.prepare('UPDATE messages SET seen = 1 WHERE uid = ?').run(1))()
    const sql = metrics.snapshot().sql
    const select = sql.find((s) => s.name === 'SELECT count(*) FROM messages WHERE uid > ?')!
    expect(select).toMatchObject({ count: 1, prepares: 1, rows: 1 })
    const update = sql.find((s) => s.name.startsWith('UPDATE messages SET seen = ?'))!
    expect(update.rows).toBe(1)
  })

  it('Plananalyse erkennt Vollscans und temporäre B-Bäume', () => {
    expect(
      analysePlan([
        'SCAN m',
        'SCAN f USING INDEX idx_x',
        'SEARCH a USING INTEGER PRIMARY KEY (rowid=?)',
        'USE TEMP B-TREE FOR ORDER BY'
      ])
    ).toEqual({ fullScans: ['m'], indexScans: ['f'], tempBtrees: 1 })
  })

  it('captures only the SQL of the benchmark case, not concurrent statements', async () => {
    const seen: string[] = []
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    const asyncCase = withSqlCapture(
      (sql) => seen.push(sql),
      async () => {
        db.prepare(`SELECT 'case-1'`).get()
        await sleep(20)
        db.prepare(`SELECT 'case-2'`).get()
      }
    )
    // Meanwhile sync/AI work runs in another async context
    db.prepare(`SELECT 'unrelated-1'`).get()
    await sleep(5)
    db.prepare(`SELECT 'unrelated-2'`).get()
    await asyncCase
    db.prepare(`SELECT 'after'`).get()
    expect(seen).toEqual([`SELECT 'case-1'`, `SELECT 'case-2'`])
  })

  it('Benchmark: alle Fälle ohne Fehler, Schreibfälle zurückgerollt, Pläne erfasst', async () => {
    seedMailbox(db, 40)
    const jobsBefore = db.prepare('SELECT count(*) n FROM ai_jobs').get()
    const contactsBefore = db.prepare('SELECT count(*) n FROM contact_stats').get()
    const result = await runBenchmark(db, { runs: 2 })
    expect(result.cases.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'threads.list.inbox(300)',
        'threads.mboxCounts',
        'folders.list',
        'thread.open(newest inbox)',
        'ai.queue.discoverTriage',
        'contacts.rebuildStats(account 1)'
      ])
    )
    for (const c of result.cases) {
      expect(c.error, c.name).toBeNull()
      expect(c.runs).toBe(2)
    }
    // listThreads builds a page with a fixed number of set-based queries, not per thread
    const list = result.cases.find((c) => c.name === 'threads.list.inbox(300)')!
    expect(list.statements).toBeGreaterThan(0)
    expect(list.statements).toBeLessThanOrEqual(10)
    expect(db.prepare('SELECT count(*) n FROM ai_jobs').get()).toEqual(jobsBefore)
    expect(db.prepare('SELECT count(*) n FROM contact_stats').get()).toEqual(contactsBefore)
    expect(result.plans.length).toBeGreaterThan(5)
    expect(result.plans.every((p) => p.plan.length > 0)).toBe(true)
  })

  it('Export enthält die erwarteten Dateien und keinerlei Mail-Inhalte', async () => {
    seedMailbox(db, 30)
    const service = new DiagnosticsService()
    service.init({
      db,
      dbPath: null,
      dir,
      appInfo: () => ({ appVersion: '0.0.0-test', platform: 'test' })
    })
    // the benchmark search and real parameterized queries run beforehand
    db.prepare('SELECT id FROM messages WHERE subject = ? AND from_addr = ?').all(
      SECRET_SUBJECT,
      SECRET_ADDR
    )
    service.persist()
    const entries = await service.bundle(
      {
        ipc: [
          {
            name: 'threads:list',
            count: 1,
            totalMs: 5,
            meanMs: 5,
            maxMs: 5,
            p50Ms: 5,
            p95Ms: 5,
            p99Ms: 5
          }
        ],
        longTasks: { count: 0, totalMs: 0, maxMs: 0, recent: [] },
        heapUsedMb: null
      },
      true
    )
    service.stop()
    const names = entries.map((e) => e.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'README.txt',
        'manifest.json',
        'metrics.json',
        'samples.json',
        'dataset.json',
        'benchmark.json',
        'renderer.json'
      ])
    )
    const all = entries.map((e) => e.data.toString()).join('\n')
    expect(all).not.toContain('Zebra-4711')
    expect(all).not.toContain('vertraulich')
    expect(all).not.toContain('owner@example.org')
    expect(all).not.toContain('example.org')
    const dataset = JSON.parse(entries.find((e) => e.name === 'dataset.json')!.data.toString())
    expect(dataset.totals.messages).toBe(30)
    expect(dataset.accounts[0]).toMatchObject({ index: 1, messages: 30 })
    expect(readdirSync(dir).some((f) => f.startsWith('session-'))).toBe(true)
    const metricsJson = JSON.parse(entries.find((e) => e.name === 'metrics.json')!.data.toString())
    expect(metricsJson.sql.length).toBeGreaterThan(0)
  })

  it('Löschen entfernt Messwerte und Sitzungsdateien; Abschalten wird gespeichert', () => {
    const service = new DiagnosticsService()
    service.init({ db, dbPath: null, dir, appInfo: () => ({}) })
    metrics.record('x', 1)
    service.persist()
    service.clear()
    expect(metrics.snapshot().timings).toEqual([])
    expect(() => readdirSync(dir)).toThrow()
    service.setEnabled(false)
    expect(metrics.enabled).toBe(false)
    expect(
      db.prepare(`SELECT value FROM settings WHERE key = 'diagnostics.enabled'`).get()
    ).toEqual({ value: '0' })
    service.setEnabled(true)
    service.stop()
  })
})
