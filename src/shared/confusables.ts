/**
 * Erkennung von Ersatzzeichen (Homoglyphen), Schriftmischung und unsichtbaren
 * Zeichen — klassische Tricks in Phishing- und Spam-Mails: „pаypal.com" mit
 * kyrillischem „а", „Rechnung" mit Nullbreiten-Leerzeichen zwischen den
 * Buchstaben gegen Spamfilter, „rechnung‮fdp.exe" mit Richtungsumkehr.
 * Rein, ohne DOM und ohne Node-APIs (Main und Renderer).
 */

export type Script = 'latin' | 'cyrillic' | 'greek' | 'other'

/**
 * Kyrillische und griechische Zeichen, die lateinischen zum Verwechseln ähneln
 * (Auszug aus Unicode confusables.txt, auf das in Mails Übliche beschränkt).
 */
const CONFUSABLE_TO_LATIN: Record<string, string> = {
  // Kyrillisch klein
  а: 'a',
  в: 'b',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  ё: 'e',
  һ: 'h',
  і: 'i',
  ї: 'i',
  ј: 'j',
  к: 'k',
  ӏ: 'l',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  г: 'r',
  ѕ: 's',
  т: 't',
  у: 'y',
  ԝ: 'w',
  х: 'x',
  ү: 'y',
  // Kyrillisch groß
  А: 'a',
  В: 'b',
  С: 'c',
  Е: 'e',
  Н: 'h',
  І: 'i',
  Ј: 'j',
  К: 'k',
  М: 'm',
  О: 'o',
  Р: 'p',
  Ѕ: 's',
  Т: 't',
  Х: 'x',
  Ү: 'y',
  // Griechisch klein
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  // Griechisch groß
  Α: 'a',
  Β: 'b',
  Ε: 'e',
  Ζ: 'z',
  Η: 'h',
  Ι: 'i',
  Κ: 'k',
  Μ: 'm',
  Ν: 'n',
  Ο: 'o',
  Ρ: 'p',
  Τ: 't',
  Υ: 'y',
  Χ: 'x'
}

export function scriptOf(char: string): Script | null {
  const cp = char.codePointAt(0) ?? 0
  if (!/\p{L}/u.test(char)) return null
  if (/\p{Script=Latin}/u.test(char)) return 'latin'
  if (cp >= 0x0400 && cp <= 0x052f) return 'cyrillic'
  if (/\p{Script=Greek}/u.test(char)) return 'greek'
  return 'other'
}

/**
 * Ein Wort mischt lateinische mit kyrillischen/griechischen Buchstaben — in
 * echter Sprache praktisch nie, bei Täuschung („Pаypal") typisch. Reine
 * kyrillische/griechische Wörter sind unauffällig.
 */
export function isMixedScriptWord(word: string): boolean {
  let latin = false
  let lookalike = false
  for (const char of word) {
    const script = scriptOf(char)
    if (script === 'latin') latin = true
    else if (script === 'cyrillic' || script === 'greek') lookalike = true
    if (latin && lookalike) return true
  }
  return false
}

/** Wörter mit Schriftmischung (max. `limit`, für Anzeige/Kontext). */
export function findMixedScriptWords(text: string, limit = 5): string[] {
  const out: string[] = []
  for (const word of text.normalize('NFC').match(/[\p{L}\p{M}]+/gu) ?? []) {
    if (isMixedScriptWord(word) && !out.includes(word)) out.push(word)
    if (out.length >= limit) break
  }
  return out
}

/**
 * „Skelett" eines Textes: Kompatibilitätsformen (Vollbreite, mathematische
 * Alphabete 𝐩𝐚𝐲) aufgelöst, klein, Homoglyphen auf Latein abgebildet.
 */
export function skeleton(text: string): string {
  let out = ''
  for (const char of text.normalize('NFKC').toLowerCase()) {
    out += CONFUSABLE_TO_LATIN[char] ?? char
  }
  return out
}

/**
 * Domain-Skelett zusätzlich mit typischen Ziffern-/Buchstabentricks
 * (paypa1, g00gle, rnicrosoft, vvells). Nur für den Vergleich mit Marken.
 */
export function domainSkeleton(domain: string): string {
  return skeleton(domain)
    .replace(/0/g, 'o')
    .replace(/[1|]/g, 'l')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
}

/** Enthält der Text Homoglyphen, die im Skelett zu Latein werden? */
export function hasConfusableChars(text: string): boolean {
  for (const char of text) if (char in CONFUSABLE_TO_LATIN) return true
  return false
}

const ZERO_WIDTH = new Set([0x200b, 0x2060, 0xfeff, 0x180e])
const JOINERS = new Set([0x200c, 0x200d])
const BIDI_CONTROLS = new Set([
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069
])

/**
 * Unsichtbare Zeichen (Nullbreiten-Leerzeichen, Wortverbinder, BOM mitten im
 * Text). ZWJ/ZWNJ zählen nur zwischen zwei lateinischen Buchstaben — in Emoji-
 * Sequenzen und persischer/indischer Schrift sind sie legitim. Mit `insideWords`
 * zählen auch die übrigen nur zwischen Buchstaben (HTML-Newsletter füllen ihren
 * Vorschautext gern mit Nullbreiten-Zeichen zwischen Leerzeichen auf).
 */
export function countInvisibleChars(text: string, insideWords = false): number {
  const chars = [...text]
  let count = 0
  const letter = (c: string | undefined): boolean => !!c && /\p{L}/u.test(c)
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0) ?? 0
    if (ZERO_WIDTH.has(cp)) {
      if (cp === 0xfeff && i === 0) continue
      if (insideWords && !(letter(chars[i - 1]) && letter(chars[i + 1]))) continue
      count += 1
    } else if (JOINERS.has(cp)) {
      if (/[a-z]/i.test(chars[i - 1] ?? '') && /[a-z]/i.test(chars[i + 1] ?? '')) count += 1
    }
  }
  return count
}

/** Richtungs-Steuerzeichen (RLO-Trick „rechnung‮fdp.exe"). */
export function hasBidiControls(text: string): boolean {
  for (const char of text) if (BIDI_CONTROLS.has(char.codePointAt(0) ?? 0)) return true
  return false
}
