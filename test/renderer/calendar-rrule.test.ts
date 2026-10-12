import { describe, expect, it } from 'vitest'
import {
  buildRrule,
  parseRrule,
  weekdayOf,
  NO_RECURRENCE,
  type RecurrenceSpec
} from '@renderer/features/calendar/rrule'
import { alarmChoiceOf, alarmsFromChoice } from '@renderer/features/calendar/alarms'
import {
  diffFields,
  effectiveScope,
  needsScope,
  patchForScope,
  shiftSeriesTime
} from '@renderer/features/calendar/scope'
import type { CalendarEventFields } from '@shared/calendar-types'

// Zeitzone vor dem Sammeln der Tests setzen (Modul-Konstanten mit Date)
process.env.TZ = 'Europe/Berlin'

const timedCtx = { allDay: false, tzid: 'Europe/Berlin' }
const dayCtx = { allDay: true, tzid: null }

function spec(over: Partial<RecurrenceSpec>): RecurrenceSpec {
  return { ...NO_RECURRENCE, ...over }
}

describe('RRULE bauen', () => {
  it('keine Wiederholung → null', () => {
    expect(buildRrule(NO_RECURRENCE, timedCtx)).toBeNull()
  })

  it('täglich/Intervall', () => {
    expect(buildRrule(spec({ freq: 'DAILY' }), timedCtx)).toBe('FREQ=DAILY')
    expect(buildRrule(spec({ freq: 'DAILY', interval: 3 }), timedCtx)).toBe('FREQ=DAILY;INTERVAL=3')
  })

  it('wöchentlich: Wochentage in Wochenreihenfolge', () => {
    expect(buildRrule(spec({ freq: 'WEEKLY', byday: ['FR', 'MO', 'WE'] }), timedCtx)).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE,FR'
    )
  })

  it('monatlich/jährlich ignorieren BYDAY', () => {
    expect(buildRrule(spec({ freq: 'MONTHLY', byday: ['MO'] }), timedCtx)).toBe('FREQ=MONTHLY')
    expect(buildRrule(spec({ freq: 'YEARLY' }), timedCtx)).toBe('FREQ=YEARLY')
  })

  it('COUNT und UNTIL (ganztägig als Datum, sonst UTC am Tagesende der Zone)', () => {
    expect(buildRrule(spec({ freq: 'DAILY', end: { kind: 'count', count: 10 } }), timedCtx)).toBe(
      'FREQ=DAILY;COUNT=10'
    )
    expect(
      buildRrule(spec({ freq: 'DAILY', end: { kind: 'until', date: '2026-12-31' } }), dayCtx)
    ).toBe('FREQ=DAILY;UNTIL=20261231')
    // Berlin im Winter: 23:59:59 lokal = 22:59:59 UTC
    expect(
      buildRrule(spec({ freq: 'DAILY', end: { kind: 'until', date: '2026-12-31' } }), timedCtx)
    ).toBe('FREQ=DAILY;UNTIL=20261231T225959Z')
    // Sommerzeit: 21:59:59 UTC
    expect(
      buildRrule(spec({ freq: 'WEEKLY', end: { kind: 'until', date: '2026-07-15' } }), timedCtx)
    ).toBe('FREQ=WEEKLY;UNTIL=20260715T215959Z')
  })

  it('begrenzt Intervall und Anzahl', () => {
    expect(buildRrule(spec({ freq: 'DAILY', interval: 0 }), timedCtx)).toBe('FREQ=DAILY')
    expect(buildRrule(spec({ freq: 'DAILY', interval: 5000 }), timedCtx)).toBe(
      'FREQ=DAILY;INTERVAL=999'
    )
  })
})

describe('RRULE lesen', () => {
  it('Rundlauf bauen → lesen', () => {
    const specs: RecurrenceSpec[] = [
      spec({ freq: 'DAILY' }),
      spec({ freq: 'WEEKLY', interval: 2, byday: ['MO', 'TH'] }),
      spec({ freq: 'MONTHLY', end: { kind: 'count', count: 6 } }),
      spec({ freq: 'YEARLY', end: { kind: 'until', date: '2030-01-01' } })
    ]
    for (const s of specs) {
      for (const ctx of [timedCtx, dayCtx]) {
        const rule = buildRrule(s, ctx)
        expect(parseRrule(rule, ctx)).toEqual({ kind: 'spec', spec: s })
      }
    }
  })

  it('leer/null → keine Wiederholung; RRULE:-Präfix wird toleriert', () => {
    expect(parseRrule(null, timedCtx)).toEqual({ kind: 'spec', spec: NO_RECURRENCE })
    expect(parseRrule('RRULE:FREQ=DAILY', timedCtx)).toEqual({
      kind: 'spec',
      spec: spec({ freq: 'DAILY' })
    })
  })

  it('UNTIL als UTC wird in den Tag der Terminzone zurückgerechnet', () => {
    const r = parseRrule('FREQ=DAILY;UNTIL=20261231T225959Z', timedCtx)
    expect(r).toEqual({
      kind: 'spec',
      spec: spec({ freq: 'DAILY', end: { kind: 'until', date: '2026-12-31' } })
    })
  })

  it('Komplexes bleibt custom (Originaltext erhalten)', () => {
    const complex = [
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=MONTHLY;BYMONTHDAY=1,15',
      'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1',
      'FREQ=YEARLY;BYMONTH=3',
      'FREQ=WEEKLY;BYDAY=1MO',
      'FREQ=DAILY;COUNT=3;UNTIL=20261231',
      'FREQ=HOURLY',
      'FREQ=WEEKLY;WKST=SU',
      'FREQ=DAILY;X-FOO=1',
      'garbage'
    ]
    for (const rule of complex) {
      expect(parseRrule(rule, timedCtx)).toEqual({ kind: 'custom', text: rule })
    }
  })

  it('weekdayOf', () => {
    expect(weekdayOf('2026-10-05')).toBe('MO')
    expect(weekdayOf('2026-10-11')).toBe('SU')
  })
})

describe('Erinnerungen', () => {
  it('Voreinstellung ↔ Alarme', () => {
    expect(alarmChoiceOf([])).toBe('none')
    for (const id of ['0', '5', '10', '15', '30', '60', '1440'] as const) {
      const alarms = alarmsFromChoice(id, [])
      expect(alarms).toHaveLength(1)
      expect(alarmChoiceOf(alarms)).toBe(id)
    }
    expect(alarmsFromChoice('15', [])[0]).toMatchObject({
      relativeTo: 'START',
      offsetSeconds: -900,
      action: 'DISPLAY'
    })
    expect(alarmsFromChoice('none', alarmsFromChoice('5', []))).toEqual([])
  })

  it('nicht darstellbare Alarme sind custom und bleiben erhalten', () => {
    const two = [...alarmsFromChoice('5', []), ...alarmsFromChoice('30', [])]
    expect(alarmChoiceOf(two)).toBe('custom')
    expect(alarmsFromChoice('custom', two)).toEqual(two)
    expect(alarmChoiceOf([{ ...alarmsFromChoice('5', [])[0], relativeTo: 'END' }])).toBe('custom')
    expect(alarmChoiceOf([{ ...alarmsFromChoice('5', [])[0], offsetSeconds: -420 }])).toBe('custom')
    expect(alarmChoiceOf([{ ...alarmsFromChoice('5', [])[0], absoluteUtc: 123 }])).toBe('custom')
  })
})

const baseFields: CalendarEventFields = {
  summary: 'Standup',
  location: null,
  description: null,
  time: {
    allDay: false,
    start: '2026-10-05T09:00:00',
    end: '2026-10-05T09:30:00',
    tzid: 'Europe/Berlin'
  },
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  status: null,
  transparency: 'OPAQUE',
  alarms: [],
  attendees: [],
  organizer: null
}

describe('Bereichs-Dialog-Logik', () => {
  it('nur Serien brauchen einen Bereich; Einzeltermine laufen als all', () => {
    expect(needsScope({ recurring: true })).toBe(true)
    expect(needsScope({ recurring: false })).toBe(false)
    expect(effectiveScope({ recurring: false }, 'this')).toBe('all')
    expect(effectiveScope({ recurring: true }, 'following')).toBe('following')
    expect(effectiveScope({ recurring: true }, null)).toBe('all')
  })

  it('diffFields schickt nur Geändertes', () => {
    expect(diffFields(baseFields, baseFields)).toEqual({})
    expect(diffFields(baseFields, { ...baseFields, summary: 'Daily' })).toEqual({
      summary: 'Daily'
    })
    const moved = { ...baseFields.time, start: '2026-10-05T10:00:00' }
    expect(diffFields(baseFields, { ...baseFields, time: moved })).toEqual({ time: moved })
  })

  it('Serienzeit verschieben: Delta des Vorkommens auf den Serienstart', () => {
    // Serie startet Mo 5.10. 09:00; bearbeitet wird das Vorkommen vom 19.10., neu 10:00–11:00
    const master = baseFields.time
    const occ = {
      ...master,
      start: '2026-10-19T09:00:00',
      end: '2026-10-19T09:30:00'
    }
    const next = { ...occ, start: '2026-10-19T10:00:00', end: '2026-10-19T11:00:00' }
    expect(shiftSeriesTime(master, occ, next)).toEqual({
      allDay: false,
      start: '2026-10-05T10:00:00',
      end: '2026-10-05T11:00:00',
      tzid: 'Europe/Berlin'
    })
  })

  it('Serienzeit: Tagesverschiebung und Ganztag', () => {
    const master = { allDay: true, start: '2026-10-05', end: '2026-10-06', tzid: null }
    const occ = { allDay: true, start: '2026-10-12', end: '2026-10-13', tzid: null }
    const next = { allDay: true, start: '2026-10-13', end: '2026-10-15', tzid: null }
    expect(shiftSeriesTime(master, occ, next)).toEqual({
      allDay: true,
      start: '2026-10-06',
      end: '2026-10-08',
      tzid: null
    })
  })

  it('patchForScope: this entfernt rrule, all verschiebt Zeit relativ', () => {
    const occ = { ...baseFields.time, start: '2026-10-19T09:00:00', end: '2026-10-19T09:30:00' }
    const next = { ...occ, start: '2026-10-19T08:00:00', end: '2026-10-19T08:30:00' }
    const ctx = { recurring: true, occurrenceTime: occ, masterTime: baseFields.time }
    expect(patchForScope('this', { rrule: 'FREQ=DAILY', time: next }, ctx).rrule).toBeUndefined()
    expect(patchForScope('this', { time: next }, ctx).time).toEqual(next)
    expect(patchForScope('all', { time: next }, ctx).time?.start).toBe('2026-10-05T08:00:00')
    expect(patchForScope('following', { time: next }, ctx).time).toEqual(next)
    expect(patchForScope('all', { time: next }, { ...ctx, recurring: false }).time).toEqual(next)
  })
})
