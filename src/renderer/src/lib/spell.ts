import { invoke } from '@renderer/lib/ipc'

export interface SpellMark {
  word: string
  start: number
  end: number
}

// Words start and end with a letter; inside, apostrophe
// (geht's, don't) and hyphen (E-Mail-Adresse) are allowed.
const WORD_RE = /[\p{L}\p{M}](?:[\p{L}\p{M}'’-]*[\p{L}\p{M}])?/gu

// URLs and mail addresses are not checked — their fragments ("hotmail",
// "hartmann") would almost always be false positives.
const SKIP_RE = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gi

/** Splits text into checkable word tokens with offsets. */
export function tokenizeWords(text: string): SpellMark[] {
  const excluded: Array<[number, number]> = []
  for (const m of text.matchAll(SKIP_RE)) excluded.push([m.index, m.index + m[0].length])
  const tokens: SpellMark[] = []
  for (const m of text.matchAll(WORD_RE)) {
    const word = m[0]
    if (word.length < 2 || word.length > 80) continue
    const start = m.index
    const end = start + word.length
    if (excluded.some(([s, e]) => start < e && end > s)) continue
    tokens.push({ word, start, end })
  }
  return tokens
}

// Session caches: verdicts and suggestions per word form, plus the words
// dismissed via "Ignore" (e.g. proper names).
const verdicts = new Map<string, boolean>()
const ignored = new Set<string>()
const suggestionCache = new Map<string, string[]>()

export function ignoreWord(word: string): void {
  ignored.add(word)
}

/** Checks the text and returns the misspelled tokens. */
export async function findMisspellings(text: string): Promise<SpellMark[]> {
  const tokens = tokenizeWords(text)
  const unknown = [...new Set(tokens.map((t) => t.word))].filter((w) => !verdicts.has(w))
  for (let i = 0; i < unknown.length; i += 2000) {
    const slice = unknown.slice(i, i + 2000)
    const { misspelled } = await invoke('spell:check', { words: slice })
    const bad = new Set(misspelled)
    for (const w of slice) verdicts.set(w, bad.has(w))
  }
  return tokens.filter((t) => verdicts.get(t.word) === true && !ignored.has(t.word))
}

export async function suggestionsFor(word: string): Promise<string[]> {
  const cached = suggestionCache.get(word)
  if (cached) return cached
  const { suggestions } = await invoke('spell:suggest', { word })
  suggestionCache.set(word, suggestions)
  return suggestions
}
