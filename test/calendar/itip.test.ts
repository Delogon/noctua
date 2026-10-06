import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import {
  buildCancelIcs,
  buildFreeBusyRequest,
  buildOccurrenceCancelIcs,
  buildReplyIcs,
  buildRequestIcs,
  buildStoredCopy,
  compareRevision,
  findMyAttendee,
  inviteRecipients,
  normalizeSequence,
  parseFreeBusy,
  parseItip,
  setAttendeePartstat
} from '@main/calendar/itip'
import {
  appleAllDayRequest,
  bobAcceptReply,
  googleRequest,
  nextcloudRequest,
  outlookCancel,
  outlookCounter,
  outlookNoVtimezone,
  outlookOccurrenceRequest,
  outlookRequest
} from './invite-fixtures'

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0)

function vevent(ics: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!
}

describe('parseItip', () => {
  it('Nextcloud REQUEST (Europe/Berlin)', () => {
    const p = parseItip(nextcloudRequest)!
    expect(p.method).toBe('REQUEST')
    expect(p.uid).toBe('6f1c2a1e-nc-0001@cloud.example.org')
    expect(p.startUtc).toBe(Date.UTC(2026, 9, 20, 8, 0))
    expect(p.endUtc).toBe(Date.UTC(2026, 9, 20, 9, 0))
    expect(p.organizer).toEqual({ email: 'alice@cloud.example.org', name: 'Alice Organizer' })
    expect(p.attendees).toHaveLength(3)
    expect(p.location).toBe('Raum 4.12, Hauptstraße 1')
    expect(p.description).toContain('https://wiki.example.org/kick')
    expect(p.tzid).toBe('Europe/Berlin')
  })

  it('Outlook/Exchange mit Windows-TZID (W. Europe Standard Time)', () => {
    const p = parseItip(outlookRequest)!
    expect(p.method).toBe('REQUEST')
    expect(p.sequence).toBe(3)
    // 14:00 CEST = 12:00Z
    expect(p.startUtc).toBe(Date.UTC(2026, 9, 21, 12, 0))
    expect(p.endUtc).toBe(Date.UTC(2026, 9, 21, 13, 30))
    expect(p.organizer?.email).toBe('dieter.chef@corp.example.com')
    expect(p.attendees.map((a) => a.email)).toEqual([
      'bob@mail.example.com',
      'eva@corp.example.com'
    ])
    expect(p.attendees[1].role).toBe('OPT-PARTICIPANT')
  })

  it('Windows-Zonenname ohne VTIMEZONE wird über die Tabelle aufgelöst', () => {
    const p = parseItip(outlookNoVtimezone)!
    // Pacific Standard Time im Oktober = PDT (UTC-7)
    expect(p.startUtc).toBe(Date.UTC(2026, 9, 21, 16, 0))
  })

  it('Google: UTC, Serie', () => {
    const p = parseItip(googleRequest)!
    expect(p.startUtc).toBe(Date.UTC(2026, 9, 6, 13, 0))
    expect(p.rrule).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(p.recurrenceId).toBeNull()
    expect(p.attendees[1].email).toBe('bob@mail.example.com')
  })

  it('Apple: ganztägig mit exklusivem Ende', () => {
    const p = parseItip(appleAllDayRequest)!
    expect(p.allDay).toBe(true)
    expect(p.startDay).toBe('2026-11-03')
    expect(p.endDay).toBe('2026-11-05')
  })

  it('Einzelvorkommen: RECURRENCE-ID kanonisch', () => {
    const p = parseItip(outlookOccurrenceRequest)!
    expect(p.recurrenceId).toBe('2026-10-27T09:00:00Z')
    expect(p.sequence).toBe(1)
  })

  it('CANCEL, REPLY, COUNTER', () => {
    expect(parseItip(outlookCancel)).toMatchObject({
      method: 'CANCEL',
      sequence: 4,
      status: 'CANCELLED'
    })
    const r = parseItip(bobAcceptReply('u1'))!
    expect(r.method).toBe('REPLY')
    expect(r.attendees).toEqual([
      expect.objectContaining({ email: 'bob@partner.example.net', partstat: 'ACCEPTED' })
    ])
    const c = parseItip(outlookCounter)!
    expect(c.method).toBe('COUNTER')
    expect(c.startUtc).toBe(Date.UTC(2026, 9, 22, 13, 0))
  })

  it('METHOD-Rückfall aus dem MIME-Parameter, sonst null; Müll und Übergröße', () => {
    const noMethod = nextcloudRequest.replace('METHOD:REQUEST\r\n', '')
    expect(parseItip(noMethod)).toBeNull()
    expect(parseItip(noMethod, 'request')?.method).toBe('REQUEST')
    expect(parseItip('kein ics')).toBeNull()
    expect(parseItip(`${nextcloudRequest}${'X'.repeat(300 * 1024)}`)).toBeNull()
  })

  it('kappt Titel und Teilnehmerzahl', () => {
    const many = Array.from(
      { length: 700 },
      (_, i) => `ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:u${i}@x.example.com`
    ).join('\r\n')
    const ics = nextcloudRequest
      .replace('SUMMARY:Projekt-Kickoff', `SUMMARY:${'A'.repeat(3000)}`)
      .replace('END:VEVENT', `${many}\r\nEND:VEVENT`)
    const p = parseItip(ics)!
    expect(p.summary!.length).toBe(1000)
    expect(p.attendees.length).toBe(500)
  })
})

describe('Ich-Erkennung & SEQUENCE', () => {
  it('findMyAttendee über beliebige eigene Adresse', () => {
    const p = parseItip(nextcloudRequest)!
    expect(findMyAttendee(p.attendees, new Set(['carla@mail.example.com']))?.name).toBe('Carla')
    expect(findMyAttendee(p.attendees, new Set(['x@y.de']))).toBeUndefined()
  })

  it('compareRevision: SEQUENCE vor DTSTAMP', () => {
    expect(
      compareRevision({ sequence: 2, dtstamp: 1 }, { sequence: 1, dtstamp: 999 })
    ).toBeGreaterThan(0)
    expect(compareRevision({ sequence: 1, dtstamp: 5 }, { sequence: 1, dtstamp: 9 })).toBeLessThan(
      0
    )
    expect(compareRevision({ sequence: 1, dtstamp: 5 }, { sequence: 1, dtstamp: 5 })).toBe(0)
  })
})

describe('buildReplyIcs', () => {
  const mine = 'bob@mail.example.com'

  it('nur das eigene ATTENDEE, richtiger PARTSTAT, DTSTAMP, SEQUENCE, UID, METHOD', () => {
    const ics = buildReplyIcs(outlookRequest, {
      attendeeEmail: mine,
      attendeeName: 'Bob Mensch',
      partstat: 'TENTATIVE',
      comment: 'Komme später',
      now: NOW
    })
    expect(ics).toContain('METHOD:REPLY')
    const ev = vevent(ics)
    const atts = ev.getAllProperties('attendee')
    expect(atts).toHaveLength(1)
    expect(atts[0].getFirstValue()).toBe(`mailto:${mine}`)
    expect(atts[0].getParameter('partstat')).toBe('TENTATIVE')
    expect(String(ev.getFirstPropertyValue('uid'))).toBe(
      '040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5A6B7'
    )
    expect(ev.getFirstPropertyValue('sequence')).toBe(3)
    expect(String(ev.getFirstPropertyValue('dtstamp'))).toBe('2026-10-05T12:00:00Z')
    expect(String(ev.getFirstPropertyValue('organizer')).toLowerCase()).toBe(
      'mailto:dieter.chef@corp.example.com'
    )
    expect(ev.getFirstPropertyValue('comment')).toBe('Komme später')
    // Zeiten als UTC, damit kein VTIMEZONE nötig ist
    expect(String(ev.getFirstPropertyValue('dtstart'))).toBe('2026-10-21T12:00:00Z')
    expect(ev.hasProperty('recurrence-id')).toBe(false)
    expect(new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vtimezone')).toHaveLength(0)
  })

  it('RECURRENCE-ID bei Einzelvorkommen', () => {
    const ics = buildReplyIcs(outlookOccurrenceRequest, {
      attendeeEmail: mine,
      attendeeName: null,
      partstat: 'ACCEPTED',
      now: NOW
    })
    expect(String(vevent(ics).getFirstPropertyValue('recurrence-id'))).toBe('2026-10-27T09:00:00Z')
  })

  it('ganztägig bleibt Datum', () => {
    const ics = buildReplyIcs(appleAllDayRequest, {
      attendeeEmail: mine,
      attendeeName: null,
      partstat: 'DECLINED',
      now: NOW
    })
    expect(vevent(ics).getFirstProperty('dtstart')!.getFirstValue().isDate).toBe(true)
    expect(vevent(ics).getFirstProperty('attendee')!.getParameter('partstat')).toBe('DECLINED')
  })
})

describe('buildStoredCopy / setAttendeePartstat', () => {
  const mine = new Set(['bob@mail.example.com'])

  it('entfernt METHOD, VALARM, ATTACH; setzt PARTSTAT und SCHEDULE-AGENT=CLIENT', () => {
    const withAlarm = nextcloudRequest.replace(
      'END:VEVENT',
      'ATTACH:https://evil.example/x\r\nBEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT'
    )
    const stored = buildStoredCopy(withAlarm, {
      myAddresses: new Set(['bob@mail.example.com']),
      partstat: 'ACCEPTED',
      scheduleAgentClient: true
    })
    expect(stored).not.toContain('METHOD')
    expect(stored).not.toContain('VALARM')
    expect(stored).not.toContain('ATTACH')
    const ev = vevent(stored)
    expect(ev.getFirstProperty('organizer')!.getParameter('schedule-agent')).toBe('CLIENT')
    const bob = ev
      .getAllProperties('attendee')
      .find((p) => String(p.getFirstValue()).includes('bob@'))!
    expect(bob.getParameter('partstat')).toBe('ACCEPTED')
    expect(bob.getParameter('rsvp')).toBeUndefined()
    const carla = ev
      .getAllProperties('attendee')
      .find((p) => String(p.getFirstValue()).includes('carla@'))!
    expect(carla.getParameter('partstat')).toBe('NEEDS-ACTION')
  })

  it('setAttendeePartstat: nur eigene Zeile, changed/matched', () => {
    const r = setAttendeePartstat(nextcloudRequest, mine, 'DECLINED', null)
    expect(r.matched && r.changed).toBe(true)
    const again = setAttendeePartstat(r.ics, mine, 'DECLINED', null)
    expect(again.changed).toBe(false)
    expect(
      setAttendeePartstat(nextcloudRequest, new Set(['nobody@x.de']), 'DECLINED', null).matched
    ).toBe(false)
  })

  it('setAttendeePartstat für ein Vorkommen legt eine Ausnahme an', () => {
    const r = setAttendeePartstat(googleRequest, mine, 'DECLINED', '2026-10-13T13:00:00Z')
    expect(r.changed).toBe(true)
    const root = new ICAL.Component(ICAL.parse(r.ics))
    const events = root.getAllSubcomponents('vevent')
    expect(events).toHaveLength(2)
    const ov = events.find((e) => e.hasProperty('recurrence-id'))!
    expect(
      ov
        .getAllProperties('attendee')
        .find((p) => String(p.getFirstValue()).includes('bob@'))!
        .getParameter('partstat')
    ).toBe('DECLINED')
    // Stamm bleibt unverändert
    const master = events.find((e) => !e.hasProperty('recurrence-id'))!
    expect(
      master
        .getAllProperties('attendee')
        .find((p) => String(p.getFirstValue()).includes('bob@'))!
        .getParameter('partstat')
    ).toBe('NEEDS-ACTION')
  })
})

describe('Organisator-Nachrichten', () => {
  it('REQUEST ohne Alarme, DTSTAMP neu', () => {
    const stored = nextcloudRequest
      .replace('METHOD:REQUEST\r\n', '')
      .replace(
        'END:VEVENT',
        'BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nDESCRIPTION:x\r\nEND:VALARM\r\nEND:VEVENT'
      )
    const ics = buildRequestIcs(stored, NOW)
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).not.toContain('VALARM')
    expect(String(vevent(ics).getFirstPropertyValue('dtstamp'))).toBe('2026-10-05T12:00:00Z')
  })

  it('CANCEL: STATUS, SEQUENCE+1, optional nur bestimmte Teilnehmer', () => {
    const ics = buildCancelIcs(nextcloudRequest, NOW, new Set(['carla@mail.example.com']))
    expect(ics).toContain('METHOD:CANCEL')
    const ev = vevent(ics)
    expect(ev.getFirstPropertyValue('status')).toBe('CANCELLED')
    expect(ev.getFirstPropertyValue('sequence')).toBe(1)
    expect(ev.getAllProperties('attendee')).toHaveLength(1)
  })

  it('CANCEL für ein Vorkommen / dieses und folgende', () => {
    const one = buildOccurrenceCancelIcs(googleRequest, '2026-10-13T13:00:00Z', 'this', NOW)
    const ev = vevent(one)
    expect(String(ev.getFirstPropertyValue('recurrence-id'))).toBe('2026-10-13T13:00:00Z')
    expect(ev.getFirstPropertyValue('status')).toBe('CANCELLED')
    expect(ev.hasProperty('rrule')).toBe(false)
    const fut = buildOccurrenceCancelIcs(googleRequest, '2026-10-13T13:00:00Z', 'following', NOW)
    expect(vevent(fut).getFirstProperty('recurrence-id')!.getParameter('range')).toBe(
      'THISANDFUTURE'
    )
  })

  it('Empfänger: ohne Organisator, Ressourcen und SCHEDULE-AGENT=NONE', () => {
    const ics = nextcloudRequest.replace(
      'END:VEVENT',
      'ATTENDEE;CUTYPE=ROOM:mailto:room@x.example.com\r\nATTENDEE;SCHEDULE-AGENT=NONE:mailto:quiet@x.example.com\r\nEND:VEVENT'
    )
    expect(inviteRecipients(ics, 'alice@cloud.example.org').sort()).toEqual([
      'bob@mail.example.com',
      'carla@mail.example.com'
    ])
  })

  it('normalizeSequence: unwesentlich = SEQUENCE bleibt, Verschiebung = höher + PARTSTAT-Reset', () => {
    const base = nextcloudRequest
      .replace('METHOD:REQUEST\r\n', '')
      .replace('PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Carla', 'PARTSTAT=ACCEPTED;CN=Carla')
    // Nur Beschreibung geändert, aber (wie updateIcs) SEQUENCE bereits erhöht
    const minor = base.replace('SEQUENCE:0', 'SEQUENCE:1').replace('Agenda:', 'Neue Agenda:')
    const r1 = normalizeSequence(base, minor, 'alice@cloud.example.org')
    expect(r1.significant).toBe(false)
    expect(vevent(r1.ics).getFirstPropertyValue('sequence')).toBe(0)
    // Verschoben
    const moved = base
      .replace('SEQUENCE:0', 'SEQUENCE:1')
      .replace(
        'DTSTART;TZID=Europe/Berlin:20261020T100000',
        'DTSTART;TZID=Europe/Berlin:20261020T130000'
      )
      .replace(
        'DTEND;TZID=Europe/Berlin:20261020T110000',
        'DTEND;TZID=Europe/Berlin:20261020T140000'
      )
    const r2 = normalizeSequence(base, moved, 'alice@cloud.example.org')
    expect(r2).toMatchObject({ significant: true, rescheduled: true })
    const ev = vevent(r2.ics)
    expect(ev.getFirstPropertyValue('sequence')).toBe(1)
    const carla = ev
      .getAllProperties('attendee')
      .find((p) => String(p.getFirstValue()).includes('carla@'))!
    expect(carla.getParameter('partstat')).toBe('NEEDS-ACTION')
  })
})

describe('Free/Busy', () => {
  it('parst FREEBUSY (UTC, Dauer, Typen, FREE ignoriert, verschmolzen)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REPLY',
      'BEGIN:VFREEBUSY',
      'UID:x',
      'DTSTAMP:20261005T000000Z',
      'DTSTART:20261006T000000Z',
      'DTEND:20261007T000000Z',
      'FREEBUSY;FBTYPE=BUSY:20261006T080000Z/20261006T090000Z,20261006T090000Z/PT30M',
      'FREEBUSY;FBTYPE=BUSY-TENTATIVE:20261006T130000Z/20261006T140000Z',
      'FREEBUSY;FBTYPE=FREE:20261006T150000Z/20261006T160000Z',
      'END:VFREEBUSY',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(parseFreeBusy(ics)).toEqual([
      { startUtc: Date.UTC(2026, 9, 6, 8), endUtc: Date.UTC(2026, 9, 6, 9, 30), type: 'BUSY' },
      {
        startUtc: Date.UTC(2026, 9, 6, 13),
        endUtc: Date.UTC(2026, 9, 6, 14),
        type: 'BUSY-TENTATIVE'
      }
    ])
    expect(parseFreeBusy('müll')).toEqual([])
  })

  it('Anfrage enthält VFREEBUSY mit Organizer und allen Attendees', () => {
    const ics = buildFreeBusyRequest({
      organizer: 'me@x.example.com',
      attendees: ['a@x.example.com', 'b@y.example.com'],
      rangeStart: Date.UTC(2026, 9, 6),
      rangeEnd: Date.UTC(2026, 9, 8),
      uid: 'fb-1',
      now: NOW
    })
    expect(ics).toContain('METHOD:REQUEST')
    expect(ics).toContain('BEGIN:VFREEBUSY')
    expect(ics).toContain('DTSTART:20261006T000000Z')
    expect(ics.match(/ATTENDEE/g)).toHaveLength(2)
  })
})
