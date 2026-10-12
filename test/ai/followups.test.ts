import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { FollowupRadar } from '@main/ai/followups'
import { upsertEnvelope } from '@main/mail/ingest'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

describe('FollowupRadar – Weiterleitungen', () => {
  let db: Database.Database

  afterEach(() => closeTestDb(db))

  function seedForward(body: string): number {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'me@example.org' })
    const sent = seedFolder(db, accountId, '\\Sent')
    const sentAt = Date.now() - 4 * 24 * 3600 * 1000
    const messageId = upsertEnvelope(
      db,
      accountId,
      sent,
      makeEnvelope({
        uid: 701,
        messageId: '<forward@example.org>',
        subject: 'Fwd: Helpdesk-Ticket',
        fromAddr: 'me@example.org',
        to: [{ name: null, address: 'other@example.org' }],
        date: sentAt,
        internalDate: sentAt
      })
    )!.messageId
    db.prepare("UPDATE messages SET body_state = 'full' WHERE id = ?").run(messageId)
    db.prepare(
      'INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, ?, NULL)'
    ).run(messageId, body)
    db.prepare(
      `INSERT INTO followups (message_id, thread_key, state, expects_reply, checked_at)
       SELECT id, thread_key, 'waiting', 1, 1 FROM messages WHERE id = ?`
    ).run(messageId)
    return messageId
  }

  it('verwirft einen bestehenden Stups aus einer reinen FYI-Weiterleitung', () => {
    const messageId = seedForward(
      'FYI\n\n> Anfang der weitergeleiteten Nachricht:\n> Von: Helpdesk\n> Bitte antworte uns.'
    )
    const radar = new FollowupRadar()
    radar.init(db, () => {})

    expect(radar.list()).toEqual([])
    expect(
      db.prepare('SELECT state, expects_reply FROM followups WHERE message_id = ?').get(messageId)
    ).toEqual({ state: 'dismissed', expects_reply: 0 })
  })

  it('behaelt eine Weiterleitung mit eigener Bitte als moeglichen Stups', () => {
    seedForward(
      'Kannst du das bitte prüfen?\n\nAnfang der weitergeleiteten Nachricht:\nVon: Helpdesk\nBitte antworte uns.'
    )
    const radar = new FollowupRadar()
    radar.init(db, () => {})

    expect(radar.list()).toHaveLength(1)
  })

  it('legt auch ohne KI keinen neuen Stups fuer eine FYI-Weiterleitung an', async () => {
    const messageId = seedForward(
      'Nur zur Info.\n\nAnfang der weitergeleiteten Nachricht:\nVon: Helpdesk\nBitte antworte uns.'
    )
    db.prepare('DELETE FROM followups WHERE message_id = ?').run(messageId)
    const radar = new FollowupRadar()
    radar.init(db, () => {})

    await radar.scan()

    expect(radar.list()).toEqual([])
    expect(
      db.prepare('SELECT state, expects_reply FROM followups WHERE message_id = ?').get(messageId)
    ).toEqual({ state: 'dismissed', expects_reply: 0 })
  })
})
