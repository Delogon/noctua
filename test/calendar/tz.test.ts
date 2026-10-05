import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import {
  buildVTimezone,
  isValidIana,
  offsetAtIana,
  resolveZone,
  wallToUtcIana,
  type VTimezones,
  type Wall
} from '@main/calendar/tz'

const w = (y: number, m: number, d: number, h = 0, mi = 0, s = 0): Wall => ({ y, m, d, h, mi, s })
const iso = (ms: number): string => new Date(ms).toISOString()

describe('tz (Europe/Berlin)', () => {
  it('rechnet Winter- und Sommerzeit korrekt', () => {
    expect(iso(wallToUtcIana(w(2025, 1, 15, 9), 'Europe/Berlin'))).toBe('2025-01-15T08:00:00.000Z')
    expect(iso(wallToUtcIana(w(2025, 7, 15, 9), 'Europe/Berlin'))).toBe('2025-07-15T07:00:00.000Z')
  })

  it('Frühjahrslücke: 02:30 existiert nicht → Offset vor der Umstellung (03:30 CEST)', () => {
    expect(iso(wallToUtcIana(w(2025, 3, 30, 2, 30), 'Europe/Berlin'))).toBe(
      '2025-03-30T01:30:00.000Z'
    )
  })

  it('Herbst-Mehrdeutigkeit: 02:30 nimmt den ersten Zeitpunkt (CEST)', () => {
    expect(iso(wallToUtcIana(w(2025, 10, 26, 2, 30), 'Europe/Berlin'))).toBe(
      '2025-10-26T00:30:00.000Z'
    )
  })

  it('Offsets um die Umstellung', () => {
    expect(offsetAtIana(Date.UTC(2025, 2, 30, 0, 59), 'Europe/Berlin')).toBe(3600_000)
    expect(offsetAtIana(Date.UTC(2025, 2, 30, 1, 1), 'Europe/Berlin')).toBe(7200_000)
  })

  it('isValidIana unterscheidet gültige und ungültige IDs', () => {
    expect(isValidIana('Europe/Berlin')).toBe(true)
    expect(isValidIana('America/Argentina/Buenos_Aires')).toBe(true)
    expect(isValidIana('W. Europe Standard Time')).toBe(false)
    expect(isValidIana('+01:00')).toBe(false)
  })

  it('Windows-Namen, Pfad-Präfixe und eingebettetes VTIMEZONE', () => {
    expect(iso(resolveZone('W. Europe Standard Time').wallToUtc(w(2025, 7, 1, 12)))).toBe(
      '2025-07-01T10:00:00.000Z'
    )
    expect(
      iso(resolveZone('/freeassociation.sourceforge.net/Europe/Berlin').wallToUtc(w(2025, 7, 1, 12)))
    ).toBe('2025-07-01T10:00:00.000Z')

    const vtz = new ICAL.Component(
      ICAL.parse(`BEGIN:VTIMEZONE
TZID:Custom Berlin
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE`)
    )
    const map: VTimezones = new Map([['Custom Berlin', vtz]])
    const zone = resolveZone('Custom Berlin', map)
    expect(iso(zone.wallToUtc(w(2025, 7, 1, 12)))).toBe('2025-07-01T10:00:00.000Z')
    expect(iso(zone.wallToUtc(w(2025, 1, 1, 12)))).toBe('2025-01-01T11:00:00.000Z')
    expect(zone.utcToWall(Date.UTC(2025, 6, 1, 10))).toEqual(w(2025, 7, 1, 12))
  })

  it('utcToWall ist die Umkehrung', () => {
    const zone = resolveZone('Europe/Berlin')
    expect(zone.utcToWall(Date.UTC(2025, 9, 26, 0, 30))).toEqual(w(2025, 10, 26, 2, 30))
    expect(zone.utcToWall(Date.UTC(2025, 9, 26, 1, 30))).toEqual(w(2025, 10, 26, 2, 30))
  })

  it('buildVTimezone erzeugt wiederkehrende Regeln, die dieselben Offsets ergeben', () => {
    const vtz = buildVTimezone('Europe/Berlin', 2025)
    const text = vtz.toString()
    expect(text).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU')
    expect(text).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU')
    expect(text).toContain('TZOFFSETTO:+0200')
    const map: VTimezones = new Map([['X', new ICAL.Component(ICAL.parse(text))]])
    const zone = resolveZone('X', map)
    expect(iso(zone.wallToUtc(w(2027, 7, 1, 12)))).toBe('2027-07-01T10:00:00.000Z')
    expect(iso(zone.wallToUtc(w(2027, 12, 1, 12)))).toBe('2027-12-01T11:00:00.000Z')
  })

  it('buildVTimezone für Zone ohne Sommerzeit', () => {
    const text = buildVTimezone('Asia/Tokyo', 2025).toString()
    expect(text).toContain('TZOFFSETTO:+0900')
    expect(text).not.toContain('DAYLIGHT')
  })

  it('buildVTimezone für US-Regel (2. Sonntag im März)', () => {
    const text = buildVTimezone('America/New_York', 2025).toString()
    expect(text).toContain('BYDAY=2SU')
    expect(text).toContain('BYDAY=1SU')
  })
})
