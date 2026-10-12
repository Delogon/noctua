import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '@main/db/migrate'
import { __setTestDb } from '@main/db'
import { loadVecExtension, openEncrypted } from '@main/db/encryption'
import { applyFlagUpdates, storeBody, upsertEnvelope } from '@main/mail/ingest'
import { listFolders, listThreads, mboxCounts } from '@main/db/repos/threads'
import { metrics } from '@main/diagnostics/metrics'
import { instrumentDb } from '@main/diagnostics/db-profiler'
import { runBenchmark } from '@main/diagnostics/benchmark'
import { collectDatasetStats } from '@main/diagnostics/dataset'
import { makeEnvelope } from '../helpers/db'

// Benchmark with a synthetic large mailbox — reproduces „gets slow with large
// mailboxes" without a real account. Runs only on request:
//
//   NOCTUA_PERF_BENCH=1 NOCTUA_PERF_MESSAGES=50000 pnpm test:perf
//
// As in the app, the DB is SQLCipher-encrypted, WAL, on disk. Result
// (JSON) in NOCTUA_PERF_OUT or test/local/out/large-mailbox-<n>.json.

const enabled = process.env.NOCTUA_PERF_BENCH === '1'
const localDescribe = enabled ? describe : describe.skip
const TOTAL = Number(process.env.NOCTUA_PERF_MESSAGES ?? 20_000)

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const WORDS =
  'rechnung angebot termin projekt meeting bericht update frage antwort danke bitte woche montag freitag kunde team release budget planung vertrag lieferung'.split(
    ' '
  )

function sentence(r: () => number, n: number): string {
  return Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ')
}

/** Mailbox with threads (avg ~2.5 mails), 2000 senders, HTML bodies, annotations. */
function seed(db: Database.Database, total: number): void {
  const r = rng(42)
  const now = Date.now()
  db.prepare(
    `INSERT INTO accounts (email, provider, credential_type, imap_host, imap_port, smtp_host,
       smtp_port, color, created_at, account_name)
     VALUES ('owner@example.org', 'imap', 'password', 'imap.test', 993, 'smtp.test', 465, '#000', ?, 'Bench')`
  ).run(now - 400 * 86_400_000)
  const acc = (db.prepare('SELECT id FROM accounts').get() as { id: number }).id
  const folder = (path: string, special: string | null): number =>
    Number(
      db
        .prepare(`INSERT INTO folders (account_id, path, special_use) VALUES (?, ?, ?)`)
        .run(acc, path, special).lastInsertRowid
    )
  const inbox = folder('INBOX', '\\Inbox')
  const sent = folder('Sent', '\\Sent')
  const archive = folder('Archive', '\\Archive')
  const junk = folder('Junk', '\\Junk')
  const annotate = db.prepare(
    `INSERT OR IGNORE INTO ai_annotations (message_id, category, priority, summary, action_items_json,
       needs_reply, confidence, model, prompt_version, created_at)
     VALUES (?, 'work', 3, 'Kurzfassung', '[]', 0, 0.8, 'bench', 6, ?)`
  )
  const threadRoots: string[] = []
  const tx = db.transaction((from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const roll = r()
      const folderId = roll < 0.7 ? inbox : roll < 0.85 ? sent : roll < 0.98 ? archive : junk
      const reply = threadRoots.length > 0 && r() < 0.6
      const parent = reply
        ? threadRoots[Math.floor(r() * Math.min(threadRoots.length, 4000))]
        : null
      const msgId = `<bench-${i}@example.org>`
      const sender = `sender${Math.floor(r() * 2000)}@firma${Math.floor(r() * 300)}.example`
      const date = now - Math.floor(r() * 365 * 86_400_000)
      const res = upsertEnvelope(
        db,
        acc,
        folderId,
        makeEnvelope({
          uid: i + 1,
          messageId: msgId,
          inReplyTo: parent,
          references: parent ? [parent] : [],
          subject: `${reply ? 'Re: ' : ''}${sentence(r, 4)}`,
          fromAddr: folderId === sent ? 'owner@example.org' : sender,
          fromName: 'Absender Name',
          to: [{ name: null, address: folderId === sent ? sender : 'owner@example.org' }],
          date
        })
      )
      if (!res) continue
      if (!reply) threadRoots.unshift(msgId)
      const text = Array.from({ length: 6 }, () => sentence(r, 14)).join('. ')
      storeBody(db, res.messageId, {
        messageId: msgId,
        inReplyTo: parent,
        references: [],
        subject: null,
        from: null,
        to: [],
        cc: [],
        replyTo: [],
        date,
        text: r() < 0.5 ? text : null,
        html: `<html><body><table><tr><td><p>${text}</p><p>${text}</p><a href="https://x.example/a">Link</a></td></tr></table></body></html>`,
        snippet: text.slice(0, 120),
        attachments: []
      })
      if (folderId === inbox && r() < 0.6) annotate.run(res.messageId, now)
    }
  })
  for (let i = 0; i < total; i += 2000) tx(i, Math.min(total, i + 2000))
}

function timeIt(fn: () => unknown, runs = 3): { medianMs: number; maxMs: number } {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const round = (n: number): number => Math.round(n * 10) / 10
  return { medianMs: round(times[Math.floor(times.length / 2)]), maxMs: round(times.at(-1)!) }
}

localDescribe('Großpostfach-Benchmark (synthetisch, lokal)', () => {
  it(
    `misst Kernoperationen bei ${TOTAL} Nachrichten`,
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'noctua-perf-'))
      const db = openEncrypted(join(dir, 'bench.sqlite'), randomBytes(32).toString('hex'))
      try {
        loadVecExtension(db)
        db.pragma('journal_mode = WAL')
        db.pragma('synchronous = NORMAL')
        db.pragma('foreign_keys = ON')
        runMigrations(db)
        __setTestDb(db)

        const seedStart = performance.now()
        seed(db, TOTAL)
        const seedMs = Math.round(performance.now() - seedStart)
        metrics.reset()
        metrics.enabled = true
        instrumentDb(db)

        const benchmark = await runBenchmark(db, { runs: 3 })

        // Sync window: 500 flag updates like incrementalSync, without a transaction
        const inboxId = (
          db.prepare(`SELECT id FROM folders WHERE special_use = '\\Inbox'`).get() as { id: number }
        ).id
        const uids = (
          db
            .prepare('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid DESC LIMIT 500')
            .all(inboxId) as Array<{ uid: number }>
        ).map((u) => u.uid)
        const flagPass = timeIt(() => {
          applyFlagUpdates(
            db,
            inboxId,
            uids.map((uid) => ({ uid, flags: new Set(['\\Seen']) }))
          )
        })
        // What a single messages:changed triggers in the renderer
        const refreshFanout = timeIt(() => {
          listThreads(db, 300, undefined, 'inbox')
          mboxCounts(db)
          listFolders(db)
        })

        const result = {
          messages: TOTAL,
          seedMs,
          cases: benchmark.cases,
          extra: {
            'sync.flagPass(500 uids)': flagPass,
            'renderer.refreshFanout(list+counts+folders)': refreshFanout
          },
          fullScanQueries: benchmark.plans
            .filter((p) => p.fullScans.length > 0 || p.indexScans.length > 0)
            .map((p) => ({
              sql: p.sql.slice(0, 160),
              fullScans: p.fullScans,
              indexScans: p.indexScans,
              usedBy: p.usedBy
            })),
          dataset: collectDatasetStats(db, join(dir, 'bench.sqlite')).totals
        }
        const out =
          process.env.NOCTUA_PERF_OUT ??
          join(process.cwd(), 'test', 'local', 'out', `large-mailbox-${TOTAL}.json`)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, JSON.stringify(result, null, 2))
        console.log(
          [
            `\nGroßpostfach-Benchmark: ${TOTAL} Nachrichten (Seed ${seedMs} ms)`,
            ...benchmark.cases.map(
              (c) =>
                `  ${c.name.padEnd(40)} ${String(c.medianMs).padStart(9)} ms  ${String(c.statements).padStart(6)} SQL`
            ),
            ...Object.entries(result.extra).map(
              ([k, v]) => `  ${k.padEnd(40)} ${String(v.medianMs).padStart(9)} ms`
            ),
            `  Abfragen mit Tabellen-/Index-Vollscan: ${result.fullScanQueries.length} von ${benchmark.plans.length}`,
            `  → ${out}`
          ].join('\n')
        )
        expect(benchmark.cases.every((c) => c.error === null)).toBe(true)
      } finally {
        __setTestDb(null)
        db.close()
        rmSync(dir, { recursive: true, force: true })
      }
    },
    30 * 60_000
  )
})
