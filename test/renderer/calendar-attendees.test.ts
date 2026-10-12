import { describe, expect, it } from 'vitest'
import type { CalendarAttendee } from '@shared/calendar-types'
import {
  addAttendee,
  diffAttendees,
  hasAnyAttendees,
  isValidAttendeeEmail,
  myPartstat,
  newAttendee,
  removeAttendee,
  roleOf,
  setAttendeeRole
} from '@renderer/features/calendar/attendees'
import { fieldsFromForm, formFromFields } from '@renderer/features/calendar/event-form'
import { diffFields } from '@renderer/features/calendar/scope'
import type { CalendarEventFields } from '@shared/calendar-types'

const att = (email: string, over: Partial<CalendarAttendee> = {}): CalendarAttendee => ({
  ...newAttendee(email),
  ...over
})

describe('Teilnehmerliste', () => {
  it('fügt normalisiert hinzu und ignoriert Duplikate, ungültige und eigene Adressen', () => {
    let list: CalendarAttendee[] = []
    list = addAttendee(list, ' Bob@Example.COM ', 'Bob')
    expect(list).toEqual([
      {
        email: 'bob@example.com',
        name: 'Bob',
        role: 'REQ-PARTICIPANT',
        partstat: 'NEEDS-ACTION',
        rsvp: true,
        cutype: 'INDIVIDUAL'
      }
    ])
    list = addAttendee(list, 'bob@example.com')
    list = addAttendee(list, 'kein-mail')
    list = addAttendee(list, 'mailto:me@x.example', null, new Set(['me@x.example']))
    expect(list).toHaveLength(1)
    expect(isValidAttendeeEmail('mailto:a@b.de')).toBe(true)
    expect(isValidAttendeeEmail('a@b')).toBe(false)
  })

  it('entfernt und ändert die Rolle ohne Groß-/Kleinschreibung', () => {
    const list = [att('a@x.de'), att('b@x.de')]
    expect(removeAttendee(list, 'A@X.de').map((a) => a.email)).toEqual(['b@x.de'])
    const opt = setAttendeeRole(list, 'B@x.de', 'OPT-PARTICIPANT')
    expect(opt[1].role).toBe('OPT-PARTICIPANT')
    expect(opt[0].role).toBe('REQ-PARTICIPANT')
    expect(roleOf(opt[1])).toBe('OPT-PARTICIPANT')
    expect(roleOf({ role: 'CHAIR' })).toBe('REQ-PARTICIPANT')
    expect(roleOf({ role: 'NON-PARTICIPANT' })).toBe('OTHER')
  })

  it('diffAttendees: neu = Einladung, entfernt = Absage, Rest bleibt', () => {
    const before = [att('a@x.de'), att('b@x.de'), att('c@x.de')]
    const after = [att('B@x.de'), att('c@x.de'), att('d@x.de')]
    expect(diffAttendees(before, after)).toEqual({
      added: ['d@x.de'],
      removed: ['a@x.de'],
      kept: ['b@x.de', 'c@x.de']
    })
    expect(diffAttendees([], [])).toEqual({ added: [], removed: [], kept: [] })
  })

  it('hasAnyAttendees: auch das Entfernen aller Teilnehmer braucht den Schalter', () => {
    expect(hasAnyAttendees([], [])).toBe(false)
    expect(hasAnyAttendees([att('a@x.de')], [])).toBe(true)
    expect(hasAnyAttendees([], [att('a@x.de')])).toBe(true)
  })

  it('myPartstat findet meine Antwort', () => {
    const list = [att('a@x.de'), att('me@x.de', { partstat: 'tentative' })]
    expect(myPartstat(list, new Set(['me@x.de']))).toBe('TENTATIVE')
    expect(myPartstat(list, new Set(['other@x.de']))).toBeNull()
  })
})

describe('Teilnehmer im Formular-Diff', () => {
  const base: CalendarEventFields = {
    summary: 'Sync',
    location: null,
    description: null,
    time: { allDay: false, start: '2026-10-06T09:00:00', end: '2026-10-06T10:00:00', tzid: 'UTC' },
    rrule: null,
    status: null,
    transparency: null,
    alarms: [],
    attendees: [att('a@x.de')],
    organizer: { email: 'me@x.de', name: null }
  }

  it('unverändert: kein Patch, geänderte Liste: nur attendees im Patch', () => {
    const form = formFromFields(base, 1)
    expect(diffFields(base, fieldsFromForm(form, base, base.attendees))).toEqual({})
    const next = fieldsFromForm(form, base, [...base.attendees, att('b@x.de')])
    const patch = diffFields(base, next)
    expect(Object.keys(patch)).toEqual(['attendees'])
    expect(patch.attendees).toHaveLength(2)
  })

  it('Nicht-Organisator (kein Override): Teilnehmer bleiben wie geladen', () => {
    const form = formFromFields(base, 1)
    expect(fieldsFromForm(form, base).attendees).toEqual(base.attendees)
  })

  it('neuer Termin übernimmt die Liste, Organisator bleibt leer (Backend setzt ihn)', () => {
    const form = formFromFields(base, 1)
    const f = fieldsFromForm(form, null, [att('z@x.de')])
    expect(f.attendees.map((a) => a.email)).toEqual(['z@x.de'])
    expect(f.organizer).toBeNull()
  })
})
