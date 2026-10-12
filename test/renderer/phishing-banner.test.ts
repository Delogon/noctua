import { describe, expect, it } from 'vitest'
import { parseSignal } from '@renderer/features/paper/phishing-signals'
import { isHighPhishing } from '@shared/decision-thresholds'
import { STRINGS } from '@renderer/i18n/strings'

describe('Phishing-Banner', () => {
  it('Signale werden auf Texte abgebildet, unbekannte entfallen', () => {
    expect(parseSignal('link_mismatch:2')).toEqual({ key: 'phishReasonLinkMismatch', n: 2 })
    expect(parseSignal('reply_to_differs')).toEqual({ key: 'phishReasonReplyTo', n: 1 })
    expect(parseSignal('unbekannt')).toBeNull()
  })

  it('zeigt die Warnung ab Score 1.4 (von 2) – Text nennt Links und Zugangsdaten', () => {
    expect(isHighPhishing(1.4)).toBe(true)
    expect(isHighPhishing(1.0)).toBe(false)
    expect(STRINGS.phishingBanner.de).toBe(
      'Diese E-Mail sieht nach Phishing aus – klicke keine Links, gib keine Zugangsdaten ein.'
    )
  })
})
