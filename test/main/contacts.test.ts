import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'
import {
  preferredAccountForContact,
  rebuildContactStats,
  recordSentContacts,
  CONTACT_DISPLAY_NAME_SQL,
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

    // Received: 3× Alice (with name), 1× Bob (without name)
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
    // Self-send in the INBOX: own address must never be suggested
    upsertEnvelope(
      db,
      accountId,
      inbox,
      makeEnvelope({ uid: 21, messageId: '<self@test>', fromAddr: 'tim@test.de', fromName: 'Tim' })
    )
    // Sent: 2× to Carla — sent counts triple, must rank before Alice
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
    // The name search must no longer touch messages: on a real
    // mailbox that was a correlated search per contact (seconds to minutes).
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
    // tim@test.de is in contact_stats via the self-send, but must never appear
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

describe('rebuildContactStats: display name per address', () => {
  let db: Database.Database
  let accountId: number
  let inbox: number
  let uid = 1

  const receive = (
    account: number,
    folder: number,
    fromAddr: string,
    fromName: string | null
  ): void => {
    upsertEnvelope(
      db,
      account,
      folder,
      makeEnvelope({ uid: uid++, messageId: `<dn${uid}@test>`, fromAddr, fromName })
    )
  }
  const displayName = (account: number, addr: string): string | null | undefined =>
    (
      db
        .prepare('SELECT display_name FROM contact_stats WHERE account_id = ? AND addr = ?')
        .get(account, addr) as { display_name: string | null } | undefined
    )?.display_name

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db, { email: 'owner@test.de' })
    inbox = seedFolder(db, accountId, '\\Inbox', 'INBOX')
  })
  afterEach(() => closeTestDb(db))

  it('picks the most frequent non-null name, matching addresses case-insensitively', () => {
    receive(accountId, inbox, 'Max@Firma.de', 'Max M.')
    receive(accountId, inbox, 'max@firma.de', 'Max Mustermann')
    receive(accountId, inbox, 'MAX@FIRMA.DE', 'Max Mustermann')
    receive(accountId, inbox, 'max@firma.de', null)
    rebuildContactStats(db, accountId)
    expect(displayName(accountId, 'max@firma.de')).toBe('Max Mustermann')
  })

  it('leaves the name empty when an address never had one', () => {
    receive(accountId, inbox, 'noreply@shop.example', null)
    rebuildContactStats(db, accountId)
    expect(displayName(accountId, 'noreply@shop.example')).toBeNull()
  })

  it('breaks ties by the most recently used name', () => {
    upsertEnvelope(
      db,
      accountId,
      inbox,
      makeEnvelope({
        uid: uid++,
        messageId: '<tie-old@test>',
        fromAddr: 'tie@example.org',
        fromName: 'Anna',
        date: 1_700_000_000_000
      })
    )
    upsertEnvelope(
      db,
      accountId,
      inbox,
      makeEnvelope({
        uid: uid++,
        messageId: '<tie-new@test>',
        fromAddr: 'tie@example.org',
        fromName: 'Zora',
        date: 1_800_000_000_000
      })
    )
    rebuildContactStats(db, accountId)
    expect(displayName(accountId, 'tie@example.org')).toBe('Zora')
  })

  it('counts names from all accounts (not scoped to the account)', () => {
    const other = seedAccount(db, { email: 'second@test.de' })
    const otherInbox = seedFolder(db, other, '\\Inbox', 'INBOX')
    receive(accountId, inbox, 'shared@example.org', 'Short')
    receive(other, otherInbox, 'shared@example.org', 'Full Name')
    receive(other, otherInbox, 'shared@example.org', 'Full Name')
    rebuildContactStats(db, accountId)
    expect(displayName(accountId, 'shared@example.org')).toBe('Full Name')
  })

  it('looks names up with an index seek, not a scan per contact', () => {
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${CONTACT_DISPLAY_NAME_SQL}`)
      .all(accountId) as Array<{ detail: string }>
    expect(plan.map((row) => row.detail).join('\n')).toMatch(
      /SEARCH m USING (?:COVERING )?INDEX idx_msg_from_addr_lower/
    )
  })
})
