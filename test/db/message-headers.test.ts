import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { upsertEnvelope } from '@main/mail/ingest'
import {
  getMessageHeaderDetails,
  storeMessageHeaderDetails,
  type FetchedMessageHeaderData
} from '@main/db/repos/message-headers'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

const MAX_RAW_HEADER_BYTES = 512 * 1024

function seedMessage(db: Database.Database): number {
  const accountId = seedAccount(db, { email: 'tim@example.org' })
  const folderId = seedFolder(db, accountId, '\\Inbox')
  return upsertEnvelope(
    db,
    accountId,
    folderId,
    makeEnvelope({
      uid: 4140,
      messageId: '<B4140-8-26-2109@stadt-oldenburg.de>',
      inReplyTo: '<antrag@example.org>',
      references: ['<root@example.org>', '<antrag@example.org>'],
      subject: 'SN Plakatierung Wahlwerbung B 4140-8-26/2109',
      fromName: 'Sondernutzung',
      fromAddr: 'sondernutzung@stadt-oldenburg.de',
      to: [
        { name: 'Lena Hartmann', address: 'tim@example.org' },
        { name: 'Team Oldenburg', address: 'team@example.org' }
      ],
      cc: [{ name: 'Wahlkampf', address: 'wahlkampf@example.org' }],
      date: 1_752_576_600_000,
      internalDate: 1_752_576_660_000,
      size: 84_321
    })
  )!.messageId
}

function fetched(overrides: Partial<FetchedMessageHeaderData> = {}): FetchedMessageHeaderData {
  return {
    from: [{ name: 'Sondernutzung', address: 'sondernutzung@stadt-oldenburg.de' }],
    sender: [{ name: 'Stadt Mailer', address: 'mailer@stadt-oldenburg.de' }],
    to: [
      { name: 'Lena Hartmann', address: 'tim@example.org' },
      { name: 'Team Oldenburg', address: 'team@example.org' },
      { name: null, address: 'archiv@example.org' }
    ],
    cc: [
      { name: 'Wahlkampf', address: 'wahlkampf@example.org' },
      { name: 'Vorstand', address: 'vorstand@example.org' }
    ],
    bcc: [{ name: 'Blindkopie', address: 'bcc@example.org' }],
    replyTo: [{ name: 'Servicebüro', address: 'service@stadt-oldenburg.de' }],
    rawHeaders: Buffer.from(
      [
        'From: Sondernutzung <sondernutzung@stadt-oldenburg.de>',
        'Return-Path: <bounce@mailer.stadt-oldenburg.de>',
        'Delivered-To: tim@example.org',
        'Delivered-To: tim@example.org',
        'X-Original-To: alias@example.org',
        'Authentication-Results: mx.google.com;',
        ' spf=pass smtp.mailfrom=bounce@mailer.stadt-oldenburg.de;',
        ' dkim=pass header.d=stadt-oldenburg.de;',
        ' dmarc=pass header.from=stadt-oldenburg.de',
        'Authentication-Results: untrusted.example; spf=fail; dkim=fail; dmarc=fail',
        'ARC-Authentication-Results: i=1; relay.example; spf=neutral',
        'Received: from inbound.stadt-oldenburg.de by mx.google.com',
        'Received: from app.internal by inbound.stadt-oldenburg.de',
        'X-Spam-Status: No, score=-0.1',
        '',
        ''
      ].join('\r\n'),
      'latin1'
    ),
    ...overrides
  }
}

describe('message-header-details-repo', () => {
  let db: Database.Database

  afterEach(() => closeTestDb(db))

  it('parst gefaltete und mehrfache Auth-Header und liefert alle Empfänger', () => {
    db = createTestDb()
    const messageId = seedMessage(db)
    storeMessageHeaderDetails(db, messageId, fetched())

    const details = getMessageHeaderDetails(db, messageId)

    expect(details).not.toBeNull()
    expect(details?.technicalAvailable).toBe(true)
    expect(details?.from).toEqual([
      { name: 'Sondernutzung', address: 'sondernutzung@stadt-oldenburg.de' }
    ])
    expect(details?.sender).toEqual([
      { name: 'Stadt Mailer', address: 'mailer@stadt-oldenburg.de' }
    ])
    expect(details?.to.map((recipient) => recipient.address)).toEqual([
      'tim@example.org',
      'team@example.org',
      'archiv@example.org'
    ])
    expect(details?.cc.map((recipient) => recipient.address)).toEqual([
      'wahlkampf@example.org',
      'vorstand@example.org'
    ])
    expect(details?.bcc).toEqual([{ name: 'Blindkopie', address: 'bcc@example.org' }])
    expect(details?.replyTo).toEqual([
      { name: 'Servicebüro', address: 'service@stadt-oldenburg.de' }
    ])

    expect(details?.authentication).toMatchObject({
      spf: 'pass',
      dkim: 'pass',
      dmarc: 'pass',
      mailedBy: 'mailer.stadt-oldenburg.de',
      signedBy: 'stadt-oldenburg.de',
      reportedBy: 'mx.google.com'
    })
    expect(details?.authentication.headers).toHaveLength(3)
    expect(details?.authentication.headers[0]).toEqual({
      name: 'Authentication-Results',
      value:
        'mx.google.com; spf=pass smtp.mailfrom=bounce@mailer.stadt-oldenburg.de; dkim=pass header.d=stadt-oldenburg.de; dmarc=pass header.from=stadt-oldenburg.de'
    })
    expect(details?.authentication.headers[1].value).toContain('untrusted.example; spf=fail')
    expect(details?.deliveredTo).toEqual(['tim@example.org', 'alias@example.org'])
    expect(details?.received).toEqual([
      'from inbound.stadt-oldenburg.de by mx.google.com',
      'from app.internal by inbound.stadt-oldenburg.de'
    ])
    expect(details?.spamHeaders).toEqual([{ name: 'X-Spam-Status', value: 'No, score=-0.1' }])
    expect(details?.messageIdHeader).toBe('<B4140-8-26-2109@stadt-oldenburg.de>')
    expect(details?.inReplyTo).toBe('<antrag@example.org>')
    expect(details?.references).toEqual(['<root@example.org>', '<antrag@example.org>'])
    expect(details?.returnPath).toBe('<bounce@mailer.stadt-oldenburg.de>')
  })

  it('begrenzt den lokalen Rohkopf bytegenau und markiert die Kürzung', () => {
    db = createTestDb()
    const messageId = seedMessage(db)
    const prefix = 'Authentication-Results: mx.example; spf=pass\r\nX-Large: '
    const oversized = Buffer.from(`${prefix}${'x'.repeat(MAX_RAW_HEADER_BYTES)}\r\n\r\n`, 'latin1')

    storeMessageHeaderDetails(db, messageId, fetched({ rawHeaders: oversized }))
    const details = getMessageHeaderDetails(db, messageId)

    expect(details?.rawHeadersTruncated).toBe(true)
    expect(Buffer.byteLength(details?.rawHeaders ?? '', 'latin1')).toBe(MAX_RAW_HEADER_BYTES)
    expect(details?.rawHeaders?.startsWith(prefix)).toBe(true)
    // Ein gekappter Rohkopf ist kein vollständiger Authentifizierungsbeleg.
    expect(details?.authentication.spf).toBe('unknown')
  })

  it('vermischt aktuelle Auth-Ergebnisse nicht mit ARC und neutralisiert Richtungszeichen', () => {
    db = createTestDb()
    const messageId = seedMessage(db)
    const rawHeaders = Buffer.from(
      [
        'Authentication-Results: mx.receiver.example; spf=fail; dkim=fail; dmarc=fail',
        'ARC-Authentication-Results: i=1; old-hop.example; spf=pass; dkim=pass; dmarc=pass',
        'X-Spam-Status: \u061cNo\u200f',
        '',
        ''
      ].join('\r\n'),
      'utf8'
    )

    storeMessageHeaderDetails(
      db,
      messageId,
      fetched({
        from: [
          {
            name: 'Sonder\u200fnutzung',
            address: 'sondernutzung@\u061cstadt-oldenburg.de'
          }
        ],
        rawHeaders
      })
    )

    const details = getMessageHeaderDetails(db, messageId)
    expect(details?.authentication).toMatchObject({ spf: 'fail', dkim: 'fail', dmarc: 'fail' })
    expect(details?.from[0]).toEqual({
      name: 'Sonder�nutzung',
      address: 'sondernutzung@�stadt-oldenburg.de'
    })
    expect(details?.rawHeaders).not.toContain('\u061c')
    expect(details?.rawHeaders).not.toContain('\u200f')
  })

  it('fällt ohne technischen Cache auf sichere Envelope-Daten zurück', () => {
    db = createTestDb()
    const messageId = seedMessage(db)

    const details = getMessageHeaderDetails(db, messageId)

    expect(details).toMatchObject({
      technicalAvailable: false,
      from: [{ name: 'Sondernutzung', address: 'sondernutzung@stadt-oldenburg.de' }],
      to: [
        { name: 'Lena Hartmann', address: 'tim@example.org' },
        { name: 'Team Oldenburg', address: 'team@example.org' }
      ],
      cc: [{ name: 'Wahlkampf', address: 'wahlkampf@example.org' }],
      sender: [],
      bcc: [],
      replyTo: [],
      authentication: {
        spf: 'unknown',
        dkim: 'unknown',
        dmarc: 'unknown',
        mailedBy: null,
        signedBy: null,
        reportedBy: null,
        headers: []
      },
      received: [],
      rawHeaders: null,
      rawHeadersTruncated: false
    })
  })
})
