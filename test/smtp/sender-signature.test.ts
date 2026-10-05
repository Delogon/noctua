import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { sendMail } from '@main/smtp/sender'
import { setSetting } from '@main/db'
import { setSecret } from '@main/auth/secrets'
import { accountSecretKey } from '@main/auth/providers'
import { closeTestDb, createTestDb, seedAccount } from '../helpers/db'

// Versand-Pfad des Stups (M75): compose:send schickt den Text OHNE Signatur —
// sendMail hängt die Konto-Signatur genau einmal an. Diese Tests belegen das
// mit gemocktem SMTP (kein echter Versand).

const { transportSendMail } = vi.hoisted(() => ({ transportSendMail: vi.fn(async () => {}) }))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: transportSendMail, close: vi.fn() }))
  }
}))

const SIGNATURE_CONFIG = JSON.stringify({
  blocks: ['name', 'studio'],
  values: { name: 'Lena Hartmann', studio: 'Studio Fernweh' },
  img: false,
  imgShape: 'rect',
  imgPos: 'left'
})

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('sendMail — Transportsicherheit (SEC-3)', () => {
  let db: Database.Database
  afterEach(() => {
    closeTestDb(db)
    transportSendMail.mockClear()
  })

  async function transportOptions(host: string, port: number): Promise<Record<string, unknown>> {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'me@test.de' })
    setSecret(accountSecretKey(accountId), 'passwort')
    db.prepare('UPDATE accounts SET smtp_host = ?, smtp_port = ? WHERE id = ?').run(
      host,
      port,
      accountId
    )
    const nodemailer = (await import('nodemailer')).default
    vi.mocked(nodemailer.createTransport).mockClear()
    await sendMail(db, {
      accountId,
      to: ['a@b.de'],
      cc: [],
      subject: 's',
      textBody: 't',
      messageId: '<x@test.de>'
    })
    expect(transportSendMail.mock.calls[0][0]).toMatchObject({ messageId: '<x@test.de>' })
    return vi.mocked(nodemailer.createTransport).mock.calls[0][0] as Record<string, unknown>
  }

  it('Port 587 verlangt STARTTLS', async () => {
    expect(await transportOptions('smtp.test', 587)).toMatchObject({
      secure: false,
      requireTLS: true
    })
  })

  it('jeder andere Nicht-465-Port verlangt ebenfalls STARTTLS', async () => {
    expect(await transportOptions('smtp.test', 25)).toMatchObject({
      secure: false,
      requireTLS: true
    })
  })

  it('Port 465 nutzt implizites TLS ohne requireTLS', async () => {
    expect(await transportOptions('smtp.test', 465)).toMatchObject({
      secure: true,
      requireTLS: false
    })
  })

  it('setzt Timeouts', async () => {
    const o = await transportOptions('smtp.test', 587)
    expect(o.connectionTimeout).toBeGreaterThan(0)
    expect(o.greetingTimeout).toBeGreaterThan(0)
    expect(o.socketTimeout).toBeGreaterThan(0)
  })
})

describe('sendMail — Signatur genau einmal (Stups-Pfad)', () => {
  let db: Database.Database

  afterEach(() => {
    closeTestDb(db)
    transportSendMail.mockClear()
  })

  function setup(): number {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'me@test.de' })
    setSecret(accountSecretKey(accountId), 'passwort')
    setSetting(`sig.${accountId}`, SIGNATURE_CONFIG)
    return accountId
  }

  it('hängt die konfigurierte Signatur genau einmal an einen Stups ohne Signatur an', async () => {
    const accountId = setup()
    await sendMail(db, {
      accountId,
      to: ['heike@example.org'],
      cc: [],
      subject: 'Re: Bauzäune',
      textBody: 'Hallo Heike,\n\nwollte kurz nachhaken.'
    })

    expect(transportSendMail).toHaveBeenCalledOnce()
    const sent = transportSendMail.mock.calls[0][0] as { text: string; html?: string }
    expect(sent.text).toBe(
      'Hallo Heike,\n\nwollte kurz nachhaken.\n\nLena Hartmann\nStudio Fernweh'
    )
    expect(occurrences(sent.text, 'Lena Hartmann')).toBe(1)
    // Auch die HTML-Alternative trägt die Signatur nur einmal
    expect(occurrences(sent.html ?? '', 'Lena Hartmann')).toBe(1)
  })

  it('verdoppelt eine bereits im Text stehende Signatur nicht', async () => {
    const accountId = setup()
    await sendMail(db, {
      accountId,
      to: ['heike@example.org'],
      cc: [],
      subject: 'Re: Bauzäune',
      textBody: 'Hallo Heike,\n\nwollte kurz nachhaken.\n\nLena Hartmann\nStudio Fernweh'
    })

    const sent = transportSendMail.mock.calls[0][0] as { text: string }
    expect(occurrences(sent.text, 'Lena Hartmann')).toBe(1)
  })

  it('setzt In-Reply-To/References aus der eigenen gesendeten Mail (Thread-Bezug)', async () => {
    const accountId = setup()
    const folder = db
      .prepare(
        `INSERT INTO folders (account_id, path, special_use, sync_mode) VALUES (?, 'Sent', '\\Sent', 'full')`
      )
      .run(accountId)
    const message = db
      .prepare(
        `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, subject, from_addr, date, internal_date, body_state)
         VALUES (?, ?, 1, '<orig@test>', 'tk', 'Bauzäune', 'me@test.de', 1, 1, 'none')`
      )
      .run(accountId, Number(folder.lastInsertRowid))

    await sendMail(db, {
      accountId,
      to: ['heike@example.org'],
      cc: [],
      subject: 'Re: Bauzäune',
      textBody: 'Stups.',
      replyToMessageId: Number(message.lastInsertRowid)
    })

    const sent = transportSendMail.mock.calls[0][0] as { inReplyTo?: string; references?: string }
    expect(sent.inReplyTo).toBe('<orig@test>')
    expect(sent.references).toContain('<orig@test>')
  })
})
