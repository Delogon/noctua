import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { outboxWorker } from '@main/smtp/outbox'
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
