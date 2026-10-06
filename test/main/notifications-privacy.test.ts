import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'

const { shown } = vi.hoisted(() => ({ shown: [] as Array<Record<string, unknown>> }))
vi.mock('electron', () => ({
  app: { setBadgeCount: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported(): boolean {
      return true
    }
    constructor(private opts: Record<string, unknown>) {}
    on(): this {
      return this
    }
    show(): void {
      shown.push(this.opts)
    }
  }
}))

import { initNotifications, maybeNotify } from '@main/notifications'
import { setSetting } from '@main/db'
import { isRendererSettingWritable } from '@shared/settings-keys'
import { upsertEnvelope } from '@main/mail/ingest'
import { createTestDb, closeTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

let db: Database.Database

function seedImportantMail(): number {
  const acc = seedAccount(db)
  const folder = seedFolder(db, acc, '\\Inbox')
  const res = upsertEnvelope(
    db,
    acc,
    folder,
    makeEnvelope({
      uid: 1,
      messageId: '<n@t>',
      subject: 'Kündigung Ihres Kontos',
      fromName: 'Bank',
      fromAddr: 'bank@x.de',
      date: Date.now()
    })
  )!
  db.prepare(
    `INSERT INTO ai_annotations (message_id, category, priority, prompt_version, summary, created_at)
     VALUES (?, 'personal', 5, 3, 'Überweisung über 4.200 € bis Freitag', 1)`
  ).run(res.messageId)
  return res.messageId
}

beforeEach(() => {
  db = createTestDb()
  shown.length = 0
  initNotifications(db, () => {})
})
afterEach(() => closeTestDb(db))

describe('Benachrichtigungen auf dem Sperrbildschirm (vuln-0015)', () => {
  it('zeigt standardmäßig Absender, Betreff und Kurzfassung', () => {
    maybeNotify(seedImportantMail())
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      title: 'Bank',
      subtitle: 'Kündigung Ihres Kontos',
      body: 'Überweisung über 4.200 € bis Freitag'
    })
  })

  it('blendet mit notifications.hideContent alle Mailinhalte aus', () => {
    setSetting('notifications.hideContent', '1')
    maybeNotify(seedImportantMail())
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ title: 'Noctua', body: 'Neue E-Mail' })
    expect(shown[0].subtitle).toBeUndefined()
    expect(JSON.stringify(shown[0])).not.toMatch(/Bank|Kündigung|4\.200/)
  })

  it('der Renderer darf nur den Schalter setzen, nicht die Schwellen', () => {
    expect(isRendererSettingWritable('notifications.hideContent')).toBe(true)
    expect(isRendererSettingWritable('notifications.enabled')).toBe(false)
    expect(isRendererSettingWritable('notifications.minPriority')).toBe(false)
  })
})
