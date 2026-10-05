import { describe, expect, it } from 'vitest'
import { dayTimeLabel } from '@renderer/features/calendar/format'

const L = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()

describe('dayTimeLabel (Termine über Mitternacht)', () => {
  const overnight = { startUtc: L(5, 22), endUtc: L(6, 1, 30) }

  it('Starttag: Start mit Pfeil (Monatschip: nur der Start)', () => {
    expect(dayTimeLabel(overnight, L(5, 0))).toBe('22:00 →')
    expect(dayTimeLabel(overnight, L(5, 0), 'start')).toBe('22:00')
  })

  it('Folgetag: nur „→ Ende", der Start wird nicht wiederholt', () => {
    expect(dayTimeLabel(overnight, L(6, 0))).toBe('→ 01:30')
    expect(dayTimeLabel(overnight, L(6, 0), 'start')).toBe('→ 01:30')
  })

  it('Termin innerhalb eines Tages: Zeitspanne bzw. Start', () => {
    const e = { startUtc: L(5, 9), endUtc: L(5, 10, 15) }
    expect(dayTimeLabel(e, L(5, 0))).toBe('09:00–10:15')
    expect(dayTimeLabel(e, L(5, 0), 'start')).toBe('09:00')
  })

  it('Ende exakt um Mitternacht gilt noch als derselbe Tag', () => {
    const e = { startUtc: L(5, 22), endUtc: L(6, 0) }
    expect(dayTimeLabel(e, L(5, 0))).toBe('22:00–00:00')
  })

  it('mittlerer Tag eines langen Termins: nur Pfeil', () => {
    const e = { startUtc: L(5, 22), endUtc: L(7, 2) }
    expect(dayTimeLabel(e, L(6, 0))).toBe('→')
  })
})
