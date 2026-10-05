import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { outboxWorker, classifySendError, MAX_SEND_ATTEMPTS } from '@main/smtp/outbox'
import { sendMail } from '@main/smtp/sender'
import { setSetting } from '@main/db'
import { createTestDb, closeTestDb, seedAccount } from '../helpers/db'

// Für den tick()-Test: echtes SMTP raus, Rest des Moduls unangetastet
vi.mock('@main/smtp/sender', async (importOriginal) => {
  const original = await importOriginal<typeof import('@main/smtp/sender')>()
  return { ...original, sendMail: vi.fn().mockResolvedValue(undefined) }
})

describe('outbox (Undo Send)', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  function setup(): number {
    db = createTestDb()
    setSetting('compose.undoSeconds', '30')
    outboxWorker.init(db, () => {})
    return seedAccount(db, { email: 'me@test.de' })
  }

  const payload = {
    to: ['bob@test.de'],
    cc: [],
    bcc: ['hidden@test.de'],
    subject: 'Test',
    textBody: 'Hallo',
    htmlBody: '<div><b>Hallo</b></div>'
  }

  it('enqueue legt eine pending-Zeile mit Sende-Zeitpunkt in der Zukunft an', () => {
    const acc = setup()
    const { outboxId, sendAt } = outboxWorker.enqueue(acc, payload)
    expect(sendAt).toBeGreaterThan(Date.now())
    const row = db.prepare('SELECT state FROM outbox WHERE id = ?').get(outboxId) as {
      state: string
    }
    expect(row.state).toBe('pending')
  })

  it('cancel bricht ab, gibt den Entwurf zurück und markiert canceled', () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    const result = outboxWorker.cancel(outboxId)
    expect(result.ok).toBe(true)
    expect(result.accountId).toBe(acc)
    expect(result.draft?.subject).toBe('Test')
    expect(result.draft?.bcc).toEqual(['hidden@test.de'])
    expect(result.draft?.htmlBody).toBe('<div><b>Hallo</b></div>')
    const row = db.prepare('SELECT state FROM outbox WHERE id = ?').get(outboxId) as {
      state: string
    }
    expect(row.state).toBe('canceled')
  })

  it('tick pusht die volle Zustandskette pending → sending → sent', async () => {
    db = createTestDb()
    setSetting('compose.undoSeconds', '0')
    const states: string[] = []
    outboxWorker.init(db, (channel, p) => {
      if (channel === 'outbox:changed') states.push((p as { state: string }).state)
    })
    const acc = seedAccount(db, { email: 'me@test.de' })
    outboxWorker.enqueue(acc, payload)
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(1100)
    outboxWorker.stop()
    vi.useRealTimers()
    // 'sending' gehört dazu — das Gesendet-Echo im Renderer hört darauf
    expect(states).toEqual(['pending', 'sending', 'sent'])
  })

  it('cancel auf eine bereits abgebrochene Mail liefert ok=false', () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    outboxWorker.cancel(outboxId)
    const second = outboxWorker.cancel(outboxId)
    expect(second.ok).toBe(false)
    expect(second.draft).toBeNull()
  })
})

describe('outbox (Zuverlässigkeit)', () => {
  let db: Database.Database
  let states: string[]
  afterEach(() => {
    outboxWorker.stop()
    vi.useRealTimers()
    vi.mocked(sendMail).mockReset().mockResolvedValue(undefined)
    closeTestDb(db)
  })

  const payload = { to: ['bob@test.de'], cc: [], subject: 'Test', textBody: 'Hallo' }

  function setup(): number {
    db = createTestDb()
    setSetting('compose.undoSeconds', '0')
    vi.mocked(sendMail).mockClear()
    states = []
    outboxWorker.init(db, (channel, p) => {
      if (channel === 'outbox:changed') states.push((p as { state: string }).state)
    })
    return seedAccount(db, { email: 'me@test.de' })
  }

  const row = (
    id: number
  ): { state: string; attempts: number; message_id: string; send_at: number } =>
    db.prepare('SELECT state, attempts, message_id, send_at FROM outbox WHERE id = ?').get(id) as {
      state: string
      attempts: number
      message_id: string
      send_at: number
    }

  it('enqueue erzeugt eine stabile Message-ID mit Konto-Domain und reicht sie an sendMail', async () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    const id = row(outboxId).message_id
    expect(id).toMatch(/^<[0-9a-f-]{36}@test\.de>$/)
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(1100)
    expect(vi.mocked(sendMail).mock.calls[0][1]).toMatchObject({ messageId: id })
    expect(row(outboxId).message_id).toBe(id)
  })

  it('Start: hängengebliebenes sending wird unknown, nicht erneut gesendet', async () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    db.prepare(`UPDATE outbox SET state = 'sending' WHERE id = ?`).run(outboxId)
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(row(outboxId).state).toBe('unknown')
    expect(states).toContain('unknown')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('Start: Message-ID im lokalen Gesendet-Ordner → sent', () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    db.prepare(`UPDATE outbox SET state = 'sending' WHERE id = ?`).run(outboxId)
    const folder = db
      .prepare(
        `INSERT INTO folders (account_id, path, special_use, sync_mode) VALUES (?, 'Sent', '\\Sent', 'full')`
      )
      .run(acc)
    db.prepare(
      `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, subject, from_addr, date, internal_date, body_state)
       VALUES (?, ?, 1, ?, 't', 'Test', 'me@test.de', 1, 1, 'none')`
    ).run(acc, Number(folder.lastInsertRowid), row(outboxId).message_id.replace(/^<|>$/g, ''))
    outboxWorker.recoverInterrupted()
    expect(row(outboxId).state).toBe('sent')
  })

  it('transienter Fehler: zurück auf pending mit Backoff, dann Erfolg; gleiche Message-ID', async () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    vi.mocked(sendMail).mockRejectedValueOnce(
      Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    )
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(1100)
    expect(row(outboxId)).toMatchObject({ state: 'pending', attempts: 1 })
    expect(row(outboxId).send_at).toBeGreaterThan(Date.now())
    await vi.advanceTimersByTimeAsync(31_000)
    expect(row(outboxId)).toMatchObject({ state: 'sent', attempts: 2 })
    expect(sendMail).toHaveBeenCalledTimes(2)
    const ids = vi
      .mocked(sendMail)
      .mock.calls.map((c) => (c[1] as { messageId?: string }).messageId)
    expect(ids[0]).toBe(ids[1])
  })

  it('permanenter Fehler (5xx) → sofort error, kein Retry', async () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    vi.mocked(sendMail).mockRejectedValue(Object.assign(new Error('550 no'), { responseCode: 550 }))
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(row(outboxId).state).toBe('error')
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('Retry ist begrenzt: nach MAX_SEND_ATTEMPTS → error', async () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    vi.mocked(sendMail).mockRejectedValue(Object.assign(new Error('421'), { responseCode: 421 }))
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(row(outboxId).state).toBe('error')
    expect(sendMail).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS)
  })

  it('tick ist gegen Re-Entrancy geschützt: langsamer Versand wird nicht doppelt gestartet', async () => {
    const acc = setup()
    const { outboxId } = outboxWorker.enqueue(acc, payload)
    let release: () => void = () => {}
    vi.mocked(sendMail).mockImplementation(() => new Promise<void>((r) => (release = r)))
    vi.useFakeTimers()
    outboxWorker.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(sendMail).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(2000)
    expect(row(outboxId).state).toBe('sent')
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('classifySendError ordnet Fehler ein', () => {
    const e = (props: object): Error => Object.assign(new Error('x'), props)
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']) {
      expect(classifySendError(e({ code }))).toBe('retry')
    }
    expect(classifySendError(e({ responseCode: 451 }))).toBe('retry')
    expect(classifySendError(e({ responseCode: 550 }))).toBe('permanent')
    expect(classifySendError(e({ code: 'EAUTH', responseCode: 535 }))).toBe('permanent')
    expect(classifySendError(new Error('Kein Passwort'))).toBe('permanent')
    // Abbruch mitten in der Datenübertragung: evtl. zugestellt → nie blind erneut
    expect(classifySendError(e({ code: 'ECONNRESET', command: 'DATA' }))).toBe('unknown')
  })
})
