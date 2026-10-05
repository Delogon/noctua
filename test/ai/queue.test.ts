import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb, closeTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import { setSetting } from '@main/db'
import { getDailyBudgetUsd, getMonthlyBudgetUsd } from '@main/ai/budget'

const runTriage = vi.fn()
vi.mock('@main/ai/triage', () => ({
  PROMPT_VERSION: 7,
  runTriage: (...args: unknown[]) => runTriage(...args)
}))
vi.mock('@main/notifications', () => ({ maybeNotify: vi.fn(), updateBadge: vi.fn() }))

import { AiQueue, classifyAiError } from '@main/ai/queue'

interface JobRow {
  status: string
  attempts: number
  next_attempt_at: number | null
  last_error: string | null
}

describe('AiQueue (REL-2)', () => {
  let db: Database.Database
  let queue: AiQueue
  let messageIds: number[]

  function addJob(index: number, status = 'pending', attempts = 0): number {
    const info = db
      .prepare(
        `INSERT INTO ai_jobs (message_id, kind, status, attempts) VALUES (?, 'triage', ?, ?)`
      )
      .run(messageIds[index], status, attempts)
    return Number(info.lastInsertRowid)
  }
  const job = (id: number): JobRow =>
    db
      .prepare('SELECT status, attempts, next_attempt_at, last_error FROM ai_jobs WHERE id = ?')
      .get(id) as JobRow

  beforeEach(() => {
    db = createTestDb()
    runTriage.mockReset()
    const account = seedAccount(db)
    const inbox = seedFolder(db, account, '\\Inbox', 'INBOX')
    messageIds = [1, 2, 3, 4, 5, 6].map(
      (uid) =>
        upsertEnvelope(db, account, inbox, makeEnvelope({ uid, messageId: `<q${uid}@t>` }))!
          .messageId
    )
    queue = new AiQueue()
    queue.init(db, vi.fn())
  })
  afterEach(() => {
    queue.stop()
    closeTestDb(db)
  })

  it('setzt beim Start hängende running-Jobs auf pending zurück', () => {
    const stuck = addJob(0, 'running')
    const done = addJob(1, 'done')
    expect(queue.recoverRunning()).toBe(1)
    expect(job(stuck).status).toBe('pending')
    expect(job(done).status).toBe('done')
  })

  it('transienter Fehler (429 + Retry-After) verbrennt keinen Versuch und plant neu', async () => {
    const id = addJob(0)
    runTriage.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '120' } })
    )
    const before = Date.now()
    queue.kick()
    await vi.waitFor(() => expect(job(id).last_error).toBe('rate limited'))
    const row = job(id)
    expect(row.status).toBe('pending')
    expect(row.attempts).toBe(0)
    expect(row.next_attempt_at!).toBeGreaterThanOrEqual(before + 120_000)
  })

  it('Netzwerkfehler gelten als transient, 400er und Parse-Fehler als permanent', () => {
    expect(classifyAiError(new Error('fetch failed')).transient).toBe(true)
    expect(classifyAiError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).transient).toBe(
      true
    )
    expect(classifyAiError(Object.assign(new Error('x'), { status: 503 })).transient).toBe(true)
    expect(classifyAiError(Object.assign(new Error('x'), { status: 401 })).transient).toBe(false)
    expect(classifyAiError(new Error('Triage-Output ungültig')).transient).toBe(false)
  })

  it('permanenter Fehler zählt Versuche und endet nach MAX_ATTEMPTS als error', async () => {
    const retry = addJob(0, 'pending', 0)
    const last = addJob(1, 'pending', 4)
    runTriage.mockRejectedValue(new Error('Triage-Output ungültig'))
    queue.kick()
    await vi.waitFor(() => expect(job(last).status).toBe('error'))
    await vi.waitFor(() => expect(job(retry).attempts).toBe(1))
    expect(job(retry).status).toBe('pending')
    expect(job(last).attempts).toBe(5)
  })

  it('Circuit Breaker pausiert die Queue nach Serie transienter Fehler', async () => {
    const ids = [0, 1, 2, 3, 4, 5].map((i) => addJob(i))
    runTriage.mockRejectedValue(new Error('fetch failed'))
    queue.kick()
    await vi.waitFor(() => expect(runTriage.mock.calls.length).toBeGreaterThanOrEqual(5))
    await new Promise((r) => setTimeout(r, 50))
    // Parallelität 2: ein bereits gestarteter Job kann die Schwelle überholen
    const calls = runTriage.mock.calls.length
    expect(calls).toBeLessThanOrEqual(6)
    // kein Job wurde als error verbraucht
    for (const id of ids) expect(job(id).status).not.toBe('error')
    // weiteres kick() während der Pause startet nichts
    queue.kick()
    await new Promise((r) => setTimeout(r, 30))
    expect(runTriage.mock.calls.length).toBe(calls)
  })

  it('requeueFailed holt error-Jobs zurück; PROMPT_VERSION-Wechsel tut es beim Start', () => {
    const failed = addJob(0, 'error', 5)
    setSetting('ai.queuePromptVersion', '6')
    runTriage.mockResolvedValue('skipped-no-client')
    queue.start()
    queue.stop()
    expect(job(failed).status).not.toBe('error')
    expect(job(failed).attempts).toBe(0)

    db.prepare(`UPDATE ai_jobs SET status = 'error', attempts = 5`).run()
    expect(queue.requeueFailed()).toBe(1)
    expect(job(failed).status).toBe('pending')
  })
})

describe('Budget-Settings (REL-2)', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
  })
  afterEach(() => closeTestDb(db))

  it('fällt bei NaN/negativ/leer/Infinity auf die Defaults zurück', () => {
    for (const bad of ['abc', 'NaN', '-1', '', '  ', 'Infinity']) {
      setSetting('ai.dailyBudgetUsd', bad)
      setSetting('ai.monthlyBudgetUsd', bad)
      expect(getDailyBudgetUsd()).toBe(0.5)
      expect(getMonthlyBudgetUsd()).toBe(10)
    }
  })

  it('akzeptiert gültige Werte inkl. 0', () => {
    setSetting('ai.dailyBudgetUsd', '1.25')
    setSetting('ai.monthlyBudgetUsd', '0')
    expect(getDailyBudgetUsd()).toBe(1.25)
    expect(getMonthlyBudgetUsd()).toBe(0)
  })
})
