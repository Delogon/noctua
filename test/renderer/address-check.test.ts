import { describe, it, expect } from 'vitest'
import {
  classifyAddress,
  isChippableAddress,
  isDoubtfulAddress
} from '@renderer/features/composer/address-check'

/**
 * Design 3a: Doubtful addresses (@ without a dot in the domain) keep
 * their chip — in the accent color, with an explanatory title. Unusable input
 * never becomes a chip.
 */
describe('classifyAddress', () => {
  it('vollständige Adressen sind ok', () => {
    expect(classifyAddress('lena@studiomora.de')).toBe('ok')
    expect(classifyAddress('a@b.c')).toBe('ok')
    expect(classifyAddress('  lena.hartmann@example.org  ')).toBe('ok')
  })

  it('@ ohne Punkt in der Domain ist zweifelhaft', () => {
    expect(classifyAddress('jonas@web')).toBe('doubtful')
    expect(classifyAddress('jonas@localhost')).toBe('doubtful')
  })

  it('Punkt nur im Lokalteil zählt nicht als Domain-Punkt', () => {
    expect(classifyAddress('jonas.k@web')).toBe('doubtful')
  })

  it('ohne verwertbares @ ist es ungültig', () => {
    expect(classifyAddress('jonas')).toBe('invalid')
    expect(classifyAddress('@web')).toBe('invalid')
    expect(classifyAddress('jonas@')).toBe('invalid')
    expect(classifyAddress('')).toBe('invalid')
    expect(classifyAddress('   ')).toBe('invalid')
  })

  it('Helfer spiegeln die Klassifizierung', () => {
    expect(isChippableAddress('jonas@web')).toBe(true)
    expect(isChippableAddress('lena@studiomora.de')).toBe(true)
    expect(isChippableAddress('jonas')).toBe(false)
    expect(isDoubtfulAddress('jonas@web')).toBe(true)
    expect(isDoubtfulAddress('lena@studiomora.de')).toBe(false)
  })
})
