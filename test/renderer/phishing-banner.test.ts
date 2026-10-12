import { describe, expect, it } from 'vitest'
import { bannerKind, parseSignal } from '@renderer/features/paper/phishing-signals'
import { isHighPhishing } from '@shared/decision-thresholds'
import { STRINGS } from '@renderer/i18n/strings'

const v = (level: 'none' | 'suspicious' | 'high'): { level: typeof level; ai: null } => ({
  level,
  ai: null
})

describe('Spam-/Phishing-Banner', () => {
  it('Signale werden auf Texte abgebildet, unbekannte entfallen', () => {
    expect(parseSignal('link_mismatch:2')).toEqual({ key: 'phishReasonLinkMismatch', n: 2 })
    expect(parseSignal('reply_to_differs')).toEqual({ key: 'phishReasonReplyTo', n: 1 })
    expect(parseSignal('homoglyph_sender')).toEqual({ key: 'threatReasonHomoglyphSender', n: 1 })
    expect(parseSignal('unbekannt')).toBeNull()
  })

  it('jeder Signal-Code des Main-Prozesses hat einen Text', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/main/mail/threat-signals.ts', 'utf8')
    )
    const names = [...src.matchAll(/add\(\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) expect(parseSignal(name), name).not.toBeNull()
  })

  it('Phishing geht vor Spam; im Spam-Ordner keine Spam-Meldung', () => {
    expect(bannerKind({ phishing: v('high'), spam: v('high'), inJunk: false })).toBe(
      'phishing-high'
    )
    expect(bannerKind({ phishing: v('suspicious'), spam: v('high'), inJunk: false })).toBe(
      'spam-high'
    )
    expect(bannerKind({ phishing: v('none'), spam: v('high'), inJunk: true })).toBeNull()
    expect(bannerKind({ phishing: v('none'), spam: v('suspicious'), inJunk: false })).toBe(
      'spam-suspicious'
    )
    expect(bannerKind({ phishing: v('none'), spam: v('none'), inJunk: false })).toBeNull()
  })

  it('zeigt die Warnung ab Score 1.4 (von 2) – Text nennt Links und Zugangsdaten', () => {
    expect(isHighPhishing(1.4)).toBe(true)
    expect(isHighPhishing(1.0)).toBe(false)
    expect(STRINGS.phishingBanner.de).toBe(
      'Diese E-Mail sieht nach Phishing aus – klicke keine Links, gib keine Zugangsdaten ein.'
    )
  })
})
