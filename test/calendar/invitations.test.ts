import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import ICAL from 'ical.js'
import { parseMail } from '@main/mail/parser'
import { storeBody, upsertEnvelope } from '@main/mail/ingest'
import {
  chooseRsvpPath,
  findObjectByUid,
  getInvitationsForMessage,
  removeCancelledEvent,
  respondToInvitation,
  storeInvitations,
  type InvitationRow
} from '@main/calendar/invitations'
import { setCalendarChangedHandler, createEvent } from '@main/calendar/service'
import { setItipMailer, type ItipMail } from '@main/calendar/mailer'
import { listPendingOps } from '@main/calendar/repo'
import { myAddresses } from '@main/calendar/identity'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import {
  appleAllDayRequest,
  bobAcceptReply,
  nextcloudRequest,
  outlookCancel,
  outlookCounter,
  outlookOccurrenceRequest,
  outlookRequest,
  rawInviteMail
} from './invite-fixtures'

let db: Database.Database
let mailAccount: number
let folder: number
let calAccount: number
let calId: number
let sent: Array<{ account: number; mail: ItipMail }>
let uidSeq = 100

beforeEach(() => {
  db = createTestDb()
  mailAccount = seedAccount(db, { email: 'bob@mail.example.com' })
  folder = seedFolder(db, mailAccount, '\\Inbox')
  calAccount = Number(
    db
      .prepare(
        `INSERT INTO cal_accounts (name, server_url, home_url, username, mail_account_id, created_at)
         VALUES ('T', 'https://x.test/', 'https://x.test/cal/', 'bob@mail.example.com', ?, 1)`
      )
      .run(mailAccount).lastInsertRowid
  )
  calId = Number(
    db
      .prepare(
        `INSERT INTO calendars (account_id, url, display_name, components)
         VALUES (?, 'https://x.test/cal/p/', 'Privat', 'VEVENT')`
      )
      .run(calAccount).lastInsertRowid
  )
  sent = []
  setItipMailer((account, mail) => sent.push({ account, mail }))
  setCalendarChangedHandler(() => {})
})
afterEach(() => {
  setItipMailer(null)
  setCalendarChangedHandler(() => {})
  closeTestDb(db)
})

/** Legt eine Mail mit text/calendar an und lässt ingest laufen. */
async function ingest(ics: string, from: string, method = 'REQUEST'): Promise<number> {
  uidSeq += 1
  const raw = rawInviteMail(ics, method).replace(
    'From: Dieter Chef <dieter.chef@corp.example.com>',
    `From: <${from}>`
  )
  const env = upsertEnvelope(
    db,
    mailAccount,
    folder,
    makeEnvelope({ uid: uidSeq, messageId: `<m${uidSeq}@t>`, fromAddr: from })
  )!
  storeBody(db, env.messageId, await parseMail(Buffer.from(raw)))
  return env.messageId
}

const view = (messageId: number): ReturnType<typeof getInvitationsForMessage>[number] =>
  getInvitationsForMessage(db, messageId)[0]

describe('Ingest & Ich-Erkennung', () => {
  it('speichert Zusammenfassung, erkennt mich über das Mail-Konto', async () => {
    const id = await ingest(outlookRequest, 'dieter.chef@corp.example.com')
    const v = view(id)
    expect(v).toMatchObject({
      method: 'REQUEST',
      sequence: 3,
      summary: 'Quartalsplanung',
      myAddress: 'bob@mail.example.com',
      myPartstat: 'NEEDS-ACTION',
      state: 'new',
      outdated: false,
      senderMismatch: false,
      attendeeCount: 2,
      startUtc: Date.UTC(2026, 9, 21, 12, 0),
      localEvent: null,
      suggestedCalendarId: calId
    })
    expect(v.organizer?.email).toBe('dieter.chef@corp.example.com')
  })

  it('Absender ≠ Organisator wird markiert', async () => {
    const id = await ingest(outlookRequest, 'jemand@elsewhere.example.net')
    expect(view(id).senderMismatch).toBe(true)
  })

  it('"Ich" umfasst Mail- und Kalender-Adressen', () => {
    db.prepare(
      `UPDATE cal_accounts SET user_addresses = ?, username = 'dav-user' WHERE id = ?`
    ).run(JSON.stringify(['mailto:alias@mail.example.com']), calAccount)
    const mine = myAddresses(db)
    expect(mine.has('bob@mail.example.com')).toBe(true)
    expect(mine.has('alias@mail.example.com')).toBe(true)
    expect(mine.has('dav-user')).toBe(false)
  })

  it('wiederholter Abruf erzeugt keine Duplikate; .ics-Anhang + Alternative = eine Karte', async () => {
    const id = await ingest(nextcloudRequest, 'alice@cloud.example.org')
    storeBody(db, id, await parseMail(Buffer.from(rawInviteMail(nextcloudRequest))))
    expect((db.prepare('SELECT count(*) c FROM invitations').get() as { c: number }).c).toBe(1)
    storeInvitations(db, id, [
      { method: 'REQUEST', content: nextcloudRequest },
      { method: null, content: nextcloudRequest }
    ])
    expect(getInvitationsForMessage(db, id)).toHaveLength(1)
  })

  it('application/ics-Anhang mit METHOD im ICS wird erkannt', async () => {
    const raw = [
      'From: a@x.example.com',
      'To: bob@mail.example.com',
      'Subject: Termin',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'siehe Anhang',
      '--b',
      'Content-Type: application/ics; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      '',
      nextcloudRequest,
      '--b--',
      ''
    ].join('\r\n')
    const parsed = await parseMail(Buffer.from(raw))
    expect(parsed.calendarParts).toHaveLength(1)
    expect(parsed.calendarParts![0].content).toContain('METHOD:REQUEST')
  })
})

describe('SEQUENCE / veraltet', () => {
  it('niedrigere SEQUENCE ist veraltet, höhere nicht; CANCEL nach REQUEST', async () => {
    const old = await ingest(
      outlookRequest.replace('SEQUENCE:3', 'SEQUENCE:1'),
      'dieter.chef@corp.example.com'
    )
    const cur = await ingest(outlookRequest, 'dieter.chef@corp.example.com')
    expect(view(old).outdated).toBe(true)
    expect(view(cur).outdated).toBe(false)
    const cancel = await ingest(outlookCancel, 'dieter.chef@corp.example.com', 'CANCEL')
    expect(view(cancel).method).toBe('CANCEL')
    expect(view(cancel).outdated).toBe(false)
    expect(view(cur).outdated).toBe(true) // SEQUENCE 4 der Absage > 3
    expect(() =>
      respondToInvitation(db, { invitationId: view(old).id, partstat: 'ACCEPTED' })
    ).toThrow(/nicht mehr aktuell/)
  })

  it('Termin im Kalender mit höherer SEQUENCE macht die Einladung veraltet', async () => {
    const id = await ingest(outlookRequest, 'dieter.chef@corp.example.com')
    respondToInvitation(db, { invitationId: view(id).id, partstat: 'ACCEPTED' })
    db.prepare(`UPDATE cal_objects SET sequence = 9 WHERE uid LIKE '04000000%'`).run()
    expect(view(id).outdated).toBe(true)
  })
})

describe('RSVP-Wegauswahl', () => {
  it('ohne Termin im Kalender: iMIP-Weg, Termin wird mit meinem PARTSTAT und SCHEDULE-AGENT=CLIENT angelegt, REPLY-Mail', async () => {
    const id = await ingest(outlookRequest, 'dieter.chef@corp.example.com')
    const v = view(id)
    const res = respondToInvitation(db, {
      invitationId: v.id,
      partstat: 'TENTATIVE',
      comment: 'vielleicht'
    })
    expect(res).toMatchObject({ path: 'imip', mailQueued: true })
    const obj = findObjectByUid(db, v.uid)!
    expect(obj.calendar_id).toBe(calId)
    expect(obj.pending_op).toBe('create')
    expect(obj.ics).not.toContain('METHOD')
    expect(obj.ics).toMatch(/SCHEDULE-AGENT=CLIENT/)
    expect(obj.ics).toMatch(/PARTSTAT=TENTATIVE/)
    // Mail
    expect(sent).toHaveLength(1)
    expect(sent[0].account).toBe(mailAccount)
    expect(sent[0].mail).toMatchObject({
      method: 'REPLY',
      to: ['dieter.chef@corp.example.com']
    })
    expect(sent[0].mail.subject).toContain('Quartalsplanung')
    expect(sent[0].mail.text).toContain('vielleicht')
    const ev = new ICAL.Component(ICAL.parse(sent[0].mail.ics)).getFirstSubcomponent('vevent')!
    const atts = ev.getAllProperties('attendee')
    expect(atts).toHaveLength(1)
    expect(atts[0].getParameter('partstat')).toBe('TENTATIVE')
    expect(view(id)).toMatchObject({ state: 'responded', respondedPartstat: 'TENTATIVE' })
    expect(view(id).localEvent?.calendarName).toBe('Privat')
  })

  it('kein Doppelversand bei erneutem Klick mit gleicher Antwort', async () => {
    const id = await ingest(nextcloudRequest, 'alice@cloud.example.org')
    const v = view(id)
    respondToInvitation(db, { invitationId: v.id, partstat: 'ACCEPTED' })
    respondToInvitation(db, { invitationId: v.id, partstat: 'ACCEPTED' })
    expect(sent).toHaveLength(1)
    expect(listPendingOps(db, calAccount)).toHaveLength(1)
    // Geänderte Antwort darf erneut senden
    respondToInvitation(db, { invitationId: v.id, partstat: 'DECLINED' })
    expect(sent).toHaveLength(2)
  })

  it('Absage ohne vorhandenen Termin: nur Mail, nichts im Kalender', async () => {
    const id = await ingest(nextcloudRequest, 'alice@cloud.example.org')
    const res = respondToInvitation(db, { invitationId: view(id).id, partstat: 'DECLINED' })
    expect(res).toMatchObject({ path: 'imip', objectId: null, mailQueued: true })
    expect(findObjectByUid(db, view(id).uid)).toBeUndefined()
    expect(sent[0].mail.ics).toContain('PARTSTAT=DECLINED')
  })

  it('Termin liegt per Server-Scheduling schon im Kalender: nur PARTSTAT-Update, KEINE Mail', async () => {
    db.prepare('UPDATE cal_accounts SET auto_schedule = 1 WHERE id = ?').run(calAccount)
    const serverCopy = nextcloudRequest
      .replace('METHOD:REQUEST\r\n', '')
      .replace('VERSION:2.0', 'VERSION:2.0\r\nPRODID:x')
    db.prepare(
      `INSERT INTO cal_objects (calendar_id, href, etag, uid, component, ics, sequence)
       VALUES (?, '/cal/p/a.ics', '"e1"', '6f1c2a1e-nc-0001@cloud.example.org', 'VEVENT', ?, 0)`
    ).run(calId, serverCopy)
    const id = await ingest(nextcloudRequest, 'alice@cloud.example.org')
    const row = db.prepare('SELECT * FROM invitations').get() as InvitationRow
    expect(chooseRsvpPath(db, row)).toBe('server')
    expect(view(id).serverHandlesReply).toBe(true)
    const res = respondToInvitation(db, { invitationId: row.id, partstat: 'ACCEPTED' })
    expect(res.path).toBe('server')
    expect(res.mailQueued).toBe(false)
    expect(sent).toHaveLength(0)
    const obj = findObjectByUid(db, row.uid)!
    expect(obj.pending_op).toBe('update')
    expect(obj.ics).toMatch(/PARTSTAT=ACCEPTED/)
    // Update läuft als If-Match-PUT über die Sync-Op auf dem bekannten ETag
    const ops = listPendingOps(db, calAccount)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'update', base_etag: '"e1"' })
    // SCHEDULE-AGENT wird NICHT gesetzt (der Server soll hier antworten)
    expect(obj.ics).not.toMatch(/SCHEDULE-AGENT/)
  })

  it('auto-schedule, Termin aber noch nicht synchronisiert: iMIP-Weg', async () => {
    db.prepare('UPDATE cal_accounts SET auto_schedule = 1 WHERE id = ?').run(calAccount)
    const id = await ingest(nextcloudRequest, 'alice@cloud.example.org')
    const row = db.prepare('SELECT * FROM invitations').get() as InvitationRow
    expect(chooseRsvpPath(db, row)).toBe('imip')
    void id
  })

  it('Einzelvorkommen: REPLY trägt RECURRENCE-ID, Kalender bekommt eine Ausnahme-Komponente', async () => {
    const id = await ingest(outlookOccurrenceRequest, 'chef@corp.example.com')
    respondToInvitation(db, { invitationId: view(id).id, partstat: 'ACCEPTED' })
    const ev = new ICAL.Component(ICAL.parse(sent[0].mail.ics)).getFirstSubcomponent('vevent')!
    expect(String(ev.getFirstPropertyValue('recurrence-id'))).toBe('2026-10-27T09:00:00Z')
    expect(String(ev.getFirstPropertyValue('dtstamp'))).toMatch(/^20\d\d-/)
  })

  it('COUNTER/REPLY haben keine RSVP-Aktion', async () => {
    const id = await ingest(outlookCounter, 'bob@partner.example.net', 'COUNTER')
    expect(() =>
      respondToInvitation(db, { invitationId: view(id).id, partstat: 'ACCEPTED' })
    ).toThrow()
  })

  it('Ganztägiger Termin wird übernommen', async () => {
    const id = await ingest(appleAllDayRequest, 'anton@icloud.example.com')
    respondToInvitation(db, { invitationId: view(id).id, partstat: 'ACCEPTED' })
    const obj = findObjectByUid(db, 'APPLE-UID-7C1F-0042')!
    expect(obj.all_day).toBe(1)
  })
})

describe('CANCEL', () => {
  it('"aus Kalender entfernen" nur wenn der Organisator übereinstimmt', async () => {
    const req = await ingest(outlookRequest, 'dieter.chef@corp.example.com')
    respondToInvitation(db, { invitationId: view(req).id, partstat: 'ACCEPTED' })
    // gefälschte Absage eines anderen Organisators
    const forged = await ingest(
      outlookCancel.replace(/dieter\.chef@corp\.example\.com/g, 'mallory@evil.example.net'),
      'mallory@evil.example.net',
      'CANCEL'
    )
    expect(() => removeCancelledEvent(db, view(forged).id)).toThrow(/Organisator/)
    expect(findObjectByUid(db, view(req).uid)).toBeDefined()
    const cancel = await ingest(outlookCancel, 'dieter.chef@corp.example.com', 'CANCEL')
    removeCancelledEvent(db, view(cancel).id)
    // Termin war nur lokal (pending create) → verschwindet ersatzlos
    expect(findObjectByUid(db, view(req).uid)).toBeUndefined()
    expect(sent).toHaveLength(1) // nur die frühere Antwort, keine Mail beim Entfernen
  })
})

describe('REPLY (Organisator-Seite)', () => {
  async function ownEvent(): Promise<string> {
    // Ich (bob@mail.example.com) organisiere; ohne Server-Scheduling → Einladung wird eingereiht
    createEvent({
      calendarId: calId,
      summary: 'Planung',
      location: null,
      description: null,
      time: {
        allDay: false,
        start: '2026-10-22T10:00:00',
        end: '2026-10-22T11:00:00',
        tzid: 'Europe/Berlin'
      },
      rrule: null,
      status: null,
      transparency: null,
      alarms: [],
      attendees: [
        {
          email: 'bob@partner.example.net',
          name: 'Bob',
          role: 'REQ-PARTICIPANT',
          partstat: 'NEEDS-ACTION',
          rsvp: true,
          cutype: 'INDIVIDUAL'
        }
      ],
      organizer: { email: 'bob@mail.example.com', name: null }
    })
    return (db.prepare('SELECT uid FROM cal_objects').get() as { uid: string }).uid
  }

  it('übernimmt PARTSTAT, wenn Absender = Teilnehmer', async () => {
    const uid = await ownEvent()
    const id = await ingest(
      bobAcceptReply(uid).replace(/me@mail\.example\.com/g, 'bob@mail.example.com'),
      'bob@partner.example.net',
      'REPLY'
    )
    expect(view(id)).toMatchObject({
      state: 'reply-applied',
      reply: { email: 'bob@partner.example.net', partstat: 'ACCEPTED' }
    })
    expect(findObjectByUid(db, uid)!.ics).toMatch(/PARTSTAT=ACCEPTED/)
  })

  it('gefälschter Absender wird ignoriert', async () => {
    const uid = await ownEvent()
    const id = await ingest(
      bobAcceptReply(uid).replace(/me@mail\.example\.com/g, 'bob@mail.example.com'),
      'mallory@evil.example.net',
      'REPLY'
    )
    expect(view(id).state).toBe('reply-ignored')
    expect(findObjectByUid(db, uid)!.ics).not.toMatch(/PARTSTAT=ACCEPTED/)
  })

  it('REPLY auf fremden Termin (wir sind nicht Organisator) oder unbekannte UID wird ignoriert', async () => {
    const id = await ingest(bobAcceptReply('unknown-uid'), 'bob@partner.example.net', 'REPLY')
    expect(view(id).state).toBe('reply-ignored')
  })

  it('veraltete Antwort (SEQUENCE niedriger als Termin) wird ignoriert', async () => {
    const uid = await ownEvent()
    db.prepare('UPDATE cal_objects SET sequence = 2 WHERE uid = ?').run(uid)
    const id = await ingest(
      bobAcceptReply(uid, 1).replace(/me@mail\.example\.com/g, 'bob@mail.example.com'),
      'bob@partner.example.net',
      'REPLY'
    )
    expect(view(id).state).toBe('reply-ignored')
  })
})
