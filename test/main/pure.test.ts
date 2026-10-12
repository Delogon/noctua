import { describe, it, expect } from 'vitest'
import { newer } from '@main/updates'
import { extractUsage } from '@main/ai/openrouter'
import { detectAddressForm, stripQuoted } from '@main/ai/style'

describe('detectAddressForm (Du/Sie aus dem Verlauf)', () => {
  it('erkennt förmliches Sie', () => {
    expect(
      detectAddressForm([
        'Sehr geehrter Herr Sigl,\n\nkönnen Sie mir die Liste senden? Ich danke Ihnen.'
      ])
    ).toBe('sie')
  })

  it('erkennt Du in typischer Team-Mail', () => {
    expect(
      detectAddressForm([
        'Hi Tim, kannst du mir kurz deine Nummer schicken? Ich melde mich bei dir.'
      ])
    ).toBe('du')
  })

  it('erkennt großgeschriebenes Du/Dein (Briefform)', () => {
    expect(detectAddressForm(['Hallo Tim, ich schicke Dir die Unterlagen. Dein Stefan'])).toBe('du')
  })

  it('satzinitiales „Sie" allein zählt nicht (sie/Sie-Ambiguität)', () => {
    expect(detectAddressForm(['Sie kommt morgen vorbei und bringt alles mit.'])).toBe(null)
  })

  it('bei Gleichstand gewinnt das förmliche Sie', () => {
    expect(detectAddressForm(['Ich danke Ihnen. Ich schicke dir den Rest morgen.'])).toBe('sie')
  })

  it('null ohne jedes Signal (z. B. Englisch)', () => {
    expect(detectAddressForm(['Thanks for the update, see you next week.'])).toBe(null)
  })
})

describe('stripQuoted (Zitat-Historie zählt nicht)', () => {
  it('entfernt >-Zeilen und Am-…-schrieb-Blöcke', () => {
    const mail =
      'Können Sie mir das freigeben?\n\nAm 07.07.2026 schrieb Lena Hartmann:\n> Hi, kannst du mir das schicken?\n> Danke dir!'
    const stripped = stripQuoted(mail)
    expect(stripped).toContain('freigeben')
    expect(stripped).not.toContain('kannst du')
    expect(detectAddressForm([stripped])).toBe('sie')
  })
})

describe('newer (SemVer-Vergleich)', () => {
  it('erkennt höhere Patch/Minor/Major', () => {
    expect(newer('v0.11.1', '0.11.0')).toBe(true)
    expect(newer('v0.12.0', '0.11.9')).toBe(true)
    expect(newer('v1.0.0', '0.99.99')).toBe(true)
  })
  it('ist false bei gleicher oder älterer Version', () => {
    expect(newer('v0.11.0', '0.11.0')).toBe(false)
    expect(newer('v0.10.5', '0.11.0')).toBe(false)
  })
  it('toleriert fehlendes v-Präfix und kürzere Versionen', () => {
    expect(newer('0.11.1', '0.11.0')).toBe(true)
    expect(newer('v1.1', '1.0.9')).toBe(true)
  })
})

describe('extractUsage (Kosten)', () => {
  it('nutzt das gemeldete cost-Feld, wenn vorhanden', () => {
    const u = extractUsage({ prompt_tokens: 1000, completion_tokens: 500, cost: 0.0042 })
    expect(u.costUsd).toBe(0.0042)
    expect(u.inputTokens).toBe(1000)
    expect(u.outputTokens).toBe(500)
  })
  it('schätzt die Kosten aus Tokens, wenn cost fehlt', () => {
    const u = extractUsage({ prompt_tokens: 1_000_000, completion_tokens: 0 })
    expect(u.costUsd).toBeCloseTo(0.14, 5)
  })
  it('liefert Nullen bei fehlender Usage', () => {
    expect(extractUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 })
  })
})
