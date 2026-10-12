import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import {
  preferredAccountForContact,
  rebuildContactStats,
  recordSentContacts,
  suggestContacts
} from '@main/db/repos/contacts'

describe('suggestContacts', () => {
  let db: Database.Database
  let accountId: number

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db, { email: 'tim@test.de' })
    const inbox = seedFolder(db, accountId, '\\Inbox', 'INBOX')
    const sent = seedFolder(db, accountId, '\\Sent', 'Sent')

    // Empfangen: 3× Alice (mit Name), 1× Bob (ohne Name)
    for (let i = 0; i < 3; i++) {
      upsertEnvelope(
        db,
        accountId,
        inbox,
        makeEnvelope({
          uid: 10 + i,
          messageId: `<a${i}@test>`,
          fromAddr: 'alice@firma.de',
          fromName: 'Alice Ammann'
        })
      )
    }
    upsertEnvelope(
      db,
      accountId,
      inbox,
      makeEnvelope({ uid: 20, messageId: '<b@test>', fromAddr: 'bob@web.de', fromName: null })
    )
    // Self-Send in der INBOX: eigene Adresse darf nie vorgeschlagen werden
    upsertEnvelope(
      db,
      accountId,
      inbox,
      makeEnvelope({ uid: 21, messageId: '<self@test>', fromAddr: 'tim@test.de', fromName: 'Tim' })
    )
    // Gesendet: 2× an Carla — sent zählt dreifach, muss vor Alice ranken
    for (let i = 0; i < 2; i++) {
      upsertEnvelope(
        db,
        accountId,
        sent,
        makeEnvelope({
          uid: 30 + i,
          messageId: `<c${i}@test>`,
          fromAddr: 'tim@test.de',
          fromName: 'Tim',
          to: [{ name: 'Carla', address: 'carla@firma.de' }]
        })
      )
    }
    rebuildContactStats(db, accountId)
  })

  afterEach(() => closeTestDb(db))

  it('rankt angeschriebene Kontakte über nur-empfangene', () => {
    const result = suggestContacts(db, 'firma', 8)
    expect(result.map((r) => r.addr)).toEqual(['carla@firma.de', 'alice@firma.de'])
  })

  it('liefert den häufigsten Anzeigenamen mit', () => {
    const [alice] = suggestContacts(db, 'alice', 8)
    expect(alice.addr).toBe('alice@firma.de')
    expect(alice.name).toBe('Alice Ammann')
  })

  it('findet Kontakte auch über den Namen', () => {
    const result = suggestContacts(db, 'ammann', 8)
    expect(result.map((r) => r.addr)).toEqual(['alice@firma.de'])
  })

  it('haelt den Anzeigenamen in contact_stats, statt ihn pro Abfrage zu suchen', () => {
    // Die Namenssuche darf messages nicht mehr anfassen: auf einem echten
    // Postfach war das eine korrelierte Suche pro Kontakt (Sekunden bis Minuten).
    expect(
      db.prepare('SELECT display_name FROM contact_stats WHERE addr = ?').get('alice@firma.de')
    ).toEqual({ display_name: 'Alice Ammann' })

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT cs.addr FROM contact_stats cs
         JOIN accounts own_account ON own_account.id = cs.account_id
         WHERE cs.addr <> lower(own_account.email)
           AND (cs.addr LIKE ? OR lower(coalesce(cs.display_name, '')) LIKE ?)
         GROUP BY cs.addr`
      )
      .all('%a%', '%a%') as Array<{ detail: string }>
    expect(plan.map((step) => step.detail).join(' ')).not.toMatch(/messages/)
  })

  it('filtert eigene Konto-Adressen aus', () => {
    // tim@test.de steht durch den Self-Send in contact_stats, darf aber nie kommen
    expect(suggestContacts(db, 'test.de', 8)).toEqual([])
    const all = suggestContacts(db, '@', 8).map((r) => r.addr)
    expect(all).toContain('bob@web.de')
    expect(all).not.toContain('tim@test.de')
  })

  it('respektiert das Limit', () => {
    expect(suggestContacts(db, '@', 1)).toHaveLength(1)
  })

  it('schlaegt ein anderes verbundenes Postfach als Empfaenger vor', () => {
    const otherAccount = seedAccount(db, { email: 'lena.hartmann@example.org' })
    recordSentContacts(db, accountId, ['lena.hartmann@example.org'], 1_800_000_000_000)

    expect(suggestContacts(db, 'lena.hartmann', 8).map((row) => row.addr)).toContain(
      'lena.hartmann@example.org'
    )
    expect(otherAccount).not.toBe(accountId)
  })

  it('waehlt das zuletzt fuer einen Kontakt verwendete Absenderkonto', () => {
    const newerAccount = seedAccount(db, { email: 'other@test.de' })
    recordSentContacts(db, accountId, ['person@example.com'], 1_700_000_000_000)
    recordSentContacts(db, newerAccount, ['Person <person@example.com>'], 1_800_000_000_000)

    expect(preferredAccountForContact(db, 'PERSON@example.com')).toBe(newerAccount)
  })

  it('speichert einen Empfaenger pro Versand nur einmal', () => {
    recordSentContacts(
      db,
      accountId,
      ['New@Example.com', 'New <new@example.com>', 'ungueltig'],
      1_800_000_000_000
    )
    const row = db
      .prepare(
        'SELECT sent_count, last_interaction FROM contact_stats WHERE account_id = ? AND addr = ?'
      )
      .get(accountId, 'new@example.com') as { sent_count: number; last_interaction: number }

    expect(row).toEqual({ sent_count: 1, last_interaction: 1_800_000_000_000 })
  })
})
