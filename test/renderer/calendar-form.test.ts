import { describe, expect, it } from 'vitest'
import type { CalendarEventFields } from '@shared/calendar-types'
import {
  defaultSlot,
  fieldsFromForm,
  formFromFields,
  formFromSlot,
  validateForm,
  withAllDay,
  withFreq,
  withStart
} from '@renderer/features/calendar/event-form'
import { alarmsFromChoice } from '@renderer/features/calendar/alarms'
import { diffFields } from '@renderer/features/calendar/scope'

// Zeitzone vor dem Sammeln der Tests setzen (Modul-Konstanten mit Date)
process.env.TZ = 'Europe/Berlin'

const timedFields: CalendarEventFields = {
  summary: 'Planung',
  location: 'Raum 1',
  description: 'Agenda',
  time: {
    allDay: false,
    start: '2026-10-05T09:00:00',
    end: '2026-10-05T10:30:00',
    tzid: 'Europe/Berlin'
  },
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  status: 'CONFIRMED',
  transparency: null,
  alarms: alarmsFromChoice('15', []),
  attendees: [
    {
      email: 'a@example.org',
      name: null,
      role: 'REQ-PARTICIPANT',
      partstat: 'ACCEPTED',
      rsvp: true,
      cutype: 'INDIVIDUAL'
    }
  ],
  organizer: { email: 'o@example.org', name: 'Org' }
}

describe('Formular ↔ Felder', () => {
  it('Rundlauf bewahrt unveränderte Felder', () => {
    const form = formFromFields(timedFields, 7)
    expect(form).toMatchObject({
      startDate: '2026-10-05',
      startTime: '09:00',
      endTime: '10:30',
      calendarId: 7,
      alarm: '15',
      transparency: 'OPAQUE'
    })
    const out = fieldsFromForm(form, timedFields)
    expect(out).toEqual(timedFields)
    expect(diffFields(timedFields, out)).toEqual({})
  })

  it('ganztägig: Ende wird inklusiv angezeigt und exklusiv gespeichert', () => {
    const f: CalendarEventFields = {
      ...timedFields,
      rrule: null,
      time: { allDay: true, start: '2026-10-05', end: '2026-10-08', tzid: null }
    }
    const form = formFromFields(f, 1)
    expect(form.endDate).toBe('2026-10-07')
    expect(fieldsFromForm(form, f).time).toEqual(f.time)
  })

  it('nicht darstellbare Regel bleibt unverändert', () => {
    const f = { ...timedFields, rrule: 'FREQ=MONTHLY;BYDAY=2TU' }
    const form = formFromFields(f, 1)
    expect(form.recCustom).toBe('FREQ=MONTHLY;BYDAY=2TU')
    expect(fieldsFromForm(form, f).rrule).toBe('FREQ=MONTHLY;BYDAY=2TU')
  })

  it('ungeänderter Termin erzeugt keinen Diff (Sekunden, Regel-Normalform, Alarmtext)', () => {
    const f: CalendarEventFields = {
      ...timedFields,
      time: { ...timedFields.time, start: '2026-10-05T09:00:30', end: '2026-10-05T10:30:00' },
      rrule: 'FREQ=DAILY;INTERVAL=1',
      alarms: [{ ...alarmsFromChoice('15', [])[0], description: 'Reminder', action: 'AUDIO' }]
    }
    const out = fieldsFromForm(formFromFields(f, 1), f)
    expect(diffFields(f, out)).toEqual({})
  })

  it('geänderte Zeit/Regel erscheint im Diff', () => {
    const form = formFromFields(timedFields, 1)
    const out = fieldsFromForm(
      { ...withStart(form, '2026-10-05', '10:00'), rec: { ...form.rec, interval: 2 } },
      timedFields
    )
    const patch = diffFields(timedFields, out)
    expect(Object.keys(patch).sort()).toEqual(['rrule', 'time'])
    expect(patch.rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')
  })

  it('Neuer Termin aus Slot und Standardfenster', () => {
    const start = new Date(2026, 9, 5, 14, 0).getTime()
    const slot = defaultSlot(start)
    expect(slot.endMs - slot.startMs).toBe(3_600_000)
    const form = formFromSlot(slot.startMs, slot.endMs, false, 3)
    expect(form).toMatchObject({ startDate: '2026-10-05', startTime: '14:00', endTime: '15:00' })
    const out = fieldsFromForm({ ...form, summary: ' Neu ' }, null)
    expect(out.summary).toBe('Neu')
    expect(out.rrule).toBeNull()
    expect(out.time.tzid).toBeTruthy()
  })

  it('Ganztags-Slot eines Monatstags', () => {
    const form = formFromSlot(
      new Date(2026, 9, 5).getTime(),
      new Date(2026, 9, 6).getTime(),
      true,
      1
    )
    expect(form).toMatchObject({ allDay: true, startDate: '2026-10-05', endDate: '2026-10-05' })
    expect(fieldsFromForm(form, null).time).toEqual({
      allDay: true,
      start: '2026-10-05',
      end: '2026-10-06',
      tzid: null
    })
  })
})

describe('Formular-Helfer', () => {
  it('Start ändern verschiebt das Ende mit (auch über Mitternacht)', () => {
    const form = formFromFields(timedFields, 1)
    const moved = withStart(form, '2026-10-06', '23:30')
    expect(moved).toMatchObject({ endDate: '2026-10-07', endTime: '01:00' })
  })

  it('Ganztags-Start ändern erhält die Spanne', () => {
    const form = {
      ...formFromSlot(new Date(2026, 9, 5).getTime(), new Date(2026, 9, 6).getTime(), true, 1),
      endDate: '2026-10-07'
    }
    expect(withStart(form, '2026-10-10', '00:00')).toMatchObject({
      startDate: '2026-10-10',
      endDate: '2026-10-12'
    })
  })

  it('Ganztägig umschalten', () => {
    const form = formFromFields(timedFields, 1)
    expect(withAllDay(form, true).allDay).toBe(true)
    const back = withAllDay(withAllDay(form, true), false)
    expect(back).toMatchObject({ allDay: false, startTime: '09:00', endTime: '10:00' })
  })

  it('Wöchentlich ohne Tage übernimmt den Wochentag des Starts', () => {
    const form = formFromSlot(
      new Date(2026, 9, 7, 9).getTime(),
      new Date(2026, 9, 7, 10).getTime(),
      false,
      1
    )
    expect(withFreq(form, 'WEEKLY').rec.byday).toEqual(['WE'])
    expect(withFreq(withFreq(form, 'WEEKLY'), 'DAILY').rec.byday).toEqual([])
  })

  it('Validierung', () => {
    const form = formFromFields(timedFields, 1)
    expect(validateForm(form)).toBeNull()
    expect(validateForm({ ...form, endTime: '09:00' })).toBe('endBeforeStart')
    expect(validateForm({ ...form, endTime: '25:00' })).toBe('invalidTime')
    expect(
      validateForm({ ...form, rec: { ...form.rec, end: { kind: 'until', date: '2026-01-01' } } })
    ).toBe('invalidUntil')
    expect(validateForm({ ...form, allDay: true, endDate: '2026-10-04' })).toBe('endBeforeStart')
  })
})
