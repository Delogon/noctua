import { describe, it, expect } from 'vitest'
import {
  OVERRIDE_OPTIONS,
  moveOverrideSelection,
  overrideOptionForKey
} from '@renderer/features/inbox/override-options'

/**
 * Category override (Design 3d): the 1–7/0 mapping and the ↑↓ selection
 * are pure logic — pinned down here so the keys in the overlay are right.
 */
describe('override-options — Tastenzuordnung', () => {
  it('bildet 1–7 auf die sieben Kategorien ab', () => {
    expect(overrideOptionForKey('1')?.category).toBe('personal')
    expect(overrideOptionForKey('2')?.category).toBe('work')
    expect(overrideOptionForKey('3')?.category).toBe('newsletter')
    expect(overrideOptionForKey('4')?.category).toBe('promotions')
    expect(overrideOptionForKey('5')?.category).toBe('notifications')
    expect(overrideOptionForKey('6')?.category).toBe('transactional')
    expect(overrideOptionForKey('7')?.category).toBe('other')
  })

  it('0 gibt die Entscheidung an die Eule zurück (category null)', () => {
    const reset = overrideOptionForKey('0')
    expect(reset).toBeDefined()
    expect(reset?.category).toBeNull()
    expect(reset?.labelKey).toBe('overrideReset')
  })

  it('fremde Tasten treffen nichts', () => {
    expect(overrideOptionForKey('8')).toBeUndefined()
    expect(overrideOptionForKey('l')).toBeUndefined()
    expect(overrideOptionForKey('')).toBeUndefined()
  })

  it('hat genau acht Zeilen — sieben Kategorien plus Zurücksetzen', () => {
    expect(OVERRIDE_OPTIONS).toHaveLength(8)
    expect(new Set(OVERRIDE_OPTIONS.map((o) => o.key)).size).toBe(8)
  })
})

describe('override-options — ↑↓-Auswahl', () => {
  it('bewegt sich zeilenweise und bleibt in der Liste', () => {
    expect(moveOverrideSelection(0, 1)).toBe(1)
    expect(moveOverrideSelection(3, -1)).toBe(2)
    // Bounds: clamped at top and bottom, no wraparound
    expect(moveOverrideSelection(0, -1)).toBe(0)
    expect(moveOverrideSelection(OVERRIDE_OPTIONS.length - 1, 1)).toBe(OVERRIDE_OPTIONS.length - 1)
  })
})
