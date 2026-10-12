import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SpellEngine, editDistance, rankSuggestions } from '@main/spell/engine'

// Integration test against the real vendored dictionaries — exactly the
// combination that runs in the main process (igerman98 DE + SCOWL EN).
let engine: SpellEngine

beforeAll(async () => {
  const dict = (name: string): Buffer =>
    readFileSync(resolve(process.cwd(), 'resources/dictionaries', name))
  engine = await SpellEngine.create([
    { aff: dict('de.aff'), dic: dict('de.dic') },
    { aff: dict('en.aff'), dic: dict('en.dic') }
  ])
}, 30_000)

describe('SpellEngine (Hunspell DE+EN)', () => {
  it('akzeptiert deutsche Komposita (Hunspell-Compound-Regeln)', () => {
    for (const w of [
      'Softwareentwicklungsprozess',
      'Terminvorschlag',
      'Kundengespräch',
      'Türschloss'
    ]) {
      expect(engine.isCorrect(w), w).toBe(true)
    }
  })

  it('akzeptiert englische Wörter und Denglisch-Bindestriche', () => {
    for (const w of ['scheduling', 'attachment', 'Video-Call', 'Meeting-Raum']) {
      expect(engine.isCorrect(w), w).toBe(true)
    }
  })

  it('akzeptiert deutsche Klitika über den ’s-Fallback', () => {
    expect(engine.isCorrect("geht's")).toBe(true)
    expect(engine.isCorrect('gibt’s')).toBe(true)
  })

  it('markiert echte Tippfehler in beiden Sprachen', () => {
    expect(
      engine.check(['Terminvorschalg', 'Besprechnung', 'accomodate', 'Haus', 'house'])
    ).toEqual(['Terminvorschalg', 'Besprechnung', 'accomodate'])
  })

  it('dedupliziert die Prüfliste', () => {
    expect(engine.check(['Huas', 'Huas'])).toEqual(['Huas'])
  })

  it('liefert die naheliegendste Korrektur zuerst', () => {
    expect(engine.suggest('Terminvorschalg')[0]).toBe('Terminvorschlag')
    expect(engine.suggest('wahrscheinlisch')[0]).toBe('wahrscheinlich')
    expect(engine.suggest('occured')[0]).toBe('occurred')
  })

  it('liefert für korrekte Wörter keine Vorschläge', () => {
    expect(engine.suggest('Haus')).toEqual([])
  })
})

describe('rankSuggestions', () => {
  it('sortiert nach Editierdistanz und dedupliziert', () => {
    const out = rankSuggestions('occured', ['zurede', 'occurred', 'occur ed', 'occurred'])
    expect(out[0]).toBe('occurred')
    expect(out.filter((s) => s === 'occurred')).toHaveLength(1)
  })

  it('bevorzugt bei Gleichstand die passende Groß-/Kleinschreibung', () => {
    expect(rankSuggestions('haus', ['Haut', 'haut'])[0]).toBe('haut')
    expect(rankSuggestions('Haus', ['haut', 'Haut'])[0]).toBe('Haut')
  })

  it('kappt auf das Limit und filtert das Ausgangswort', () => {
    expect(rankSuggestions('wort', ['wort', 'a', 'b', 'c', 'd', 'e', 'f'], 5)).toHaveLength(5)
  })
})

describe('editDistance', () => {
  it('misst case-insensitiv', () => {
    expect(editDistance('Haus', 'haus')).toBe(0)
    expect(editDistance('', 'abc')).toBe(3)
  })

  it('zählt Buchstabendreher als eine Operation (Damerau)', () => {
    expect(editDistance('Huas', 'Haus')).toBe(1)
    expect(editDistance('Terminvorschalg', 'Terminvorschlag')).toBe(1)
  })
})
