import { describe, expect, it } from 'vitest'
import { sanitizeAppleVerdict } from '../../src/main/ai/triage'

// Value clamping of the Apple triage (M86): Guided Generation guarantees the
// structure; we clamp the ranges (enum, 1–5, date format) ourselves.

describe('sanitizeAppleVerdict', () => {
  it('lässt ein sauberes Urteil unverändert durch', () => {
    const verdict = sanitizeAppleVerdict({
      category: 'work',
      priority: 4,
      summary: 'Kita bittet um Rückmeldung zum Sommerfest.',
      action_items: [{ title: 'Bescheid geben', due: '2026-07-17' }],
      needs_reply: true,
      addressed_to_me: true,
      confidence: 0.9
    })
    expect(verdict.category).toBe('work')
    expect(verdict.priority).toBe(4)
    expect(verdict.action_items).toEqual([{ title: 'Bescheid geben', due: '2026-07-17' }])
    expect(verdict.needs_reply).toBe(true)
    expect(verdict.confidence).toBe(0.9)
  })

  it('fällt bei unbekannter Kategorie auf other zurück', () => {
    expect(sanitizeAppleVerdict({ category: 'spam', priority: 3, summary: 'x' }).category).toBe(
      'other'
    )
  })

  it('klemmt Priorität auf 1–5 und rundet', () => {
    expect(sanitizeAppleVerdict({ category: 'work', priority: 9, summary: 'x' }).priority).toBe(5)
    expect(sanitizeAppleVerdict({ category: 'work', priority: 0, summary: 'x' }).priority).toBe(1)
    expect(sanitizeAppleVerdict({ category: 'work', priority: 3.6, summary: 'x' }).priority).toBe(4)
    // missing/NaN → neutral 3
    expect(sanitizeAppleVerdict({ category: 'work', summary: 'x' }).priority).toBe(3)
  })

  it('verwirft ungültige Fristen und leere Aufgaben-Titel', () => {
    const verdict = sanitizeAppleVerdict({
      category: 'personal',
      priority: 3,
      summary: 'x',
      action_items: [
        { title: 'Salat mitbringen', due: 'Freitag' },
        { title: '   ', due: '2026-07-17' },
        { title: 'Antworten', due: '2026-07-17' }
      ]
    })
    expect(verdict.action_items).toEqual([
      { title: 'Salat mitbringen', due: null },
      { title: 'Antworten', due: '2026-07-17' }
    ])
  })

  it('klemmt confidence in [0,1] und defaultet bei Unsinn auf 0.5', () => {
    expect(
      sanitizeAppleVerdict({ category: 'work', priority: 3, summary: 'x', confidence: 7 })
        .confidence
    ).toBe(1)
    expect(
      sanitizeAppleVerdict({ category: 'work', priority: 3, summary: 'x', confidence: 'hoch' })
        .confidence
    ).toBe(0.5)
  })

  it('addressed_to_me nur bei explizitem false verneint, needs_reply nur bei true bejaht', () => {
    const verdict = sanitizeAppleVerdict({ category: 'work', priority: 3, summary: 'x' })
    expect(verdict.addressed_to_me).toBe(true)
    expect(verdict.needs_reply).toBe(false)
  })

  it('kürzt überlange Zusammenfassungen aufs Schema-Limit', () => {
    const verdict = sanitizeAppleVerdict({
      category: 'work',
      priority: 3,
      summary: 'a'.repeat(600)
    })
    expect(verdict.summary.length).toBeLessThanOrEqual(300)
  })
})
