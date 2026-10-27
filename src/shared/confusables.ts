/**
 * Detection of lookalike characters (homoglyphs), script mixing and invisible
 * characters — classic tricks in phishing and spam mails: "pаypal.com" with
 * Cyrillic "а", "Rechnung" with zero-width spaces between the
 * letters to beat spam filters, "rechnung‮fdp.exe" with direction override.
 * Pure, no DOM and no Node APIs (main and renderer).
 */

export type Script = 'latin' | 'cyrillic' | 'greek' | 'other'

/**
 * Cyrillic and Greek characters that look confusingly like Latin ones
 * (excerpt from Unicode confusables.txt, limited to what is common in mails).
 */
const CONFUSABLE_TO_LATIN: Record<string, string> = {
  // Cyrillic lowercase
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
  // Cyrillic uppercase
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
  // Greek lowercase
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
  // Greek uppercase
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
 * A word mixes Latin with Cyrillic/Greek letters — practically never in
 * real language, typical for deception ("Pаypal"). Purely
 * Cyrillic/Greek words are inconspicuous.
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

/** Words with mixed scripts (max. `limit`, for display/context). */
export function findMixedScriptWords(text: string, limit = 5): string[] {
  const out: string[] = []
  for (const word of text.normalize('NFC').match(/[\p{L}\p{M}]+/gu) ?? []) {
    if (isMixedScriptWord(word) && !out.includes(word)) out.push(word)
    if (out.length >= limit) break
  }
  return out
}

/**
 * "Skeleton" of a text: compatibility forms (full-width, mathematical
 * alphabets 𝐩𝐚𝐲) resolved, lowercased, homoglyphs mapped to Latin.
 */
export function skeleton(text: string): string {
  let out = ''
  for (const char of text.normalize('NFKC').toLowerCase()) {
    out += CONFUSABLE_TO_LATIN[char] ?? char
  }
  return out
}

/**
 * Domain skeleton, additionally with typical digit/letter tricks
 * (paypa1, g00gle, rnicrosoft, vvells). Only for comparison with brands.
 */
export function domainSkeleton(domain: string): string {
  return skeleton(domain)
    .replace(/0/g, 'o')
    .replace(/[1|]/g, 'l')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
}

/** Does the text contain homoglyphs that become Latin in the skeleton? */
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
 * Invisible characters (zero-width spaces, word joiners, BOM mid-text).
 * ZWJ/ZWNJ only count between two Latin letters — in emoji sequences and
 * Persian/Indic scripts they are legitimate. With `insideWords` the others
 * also only count between letters (HTML newsletters like to pad their
 * preview text with zero-width characters between spaces).
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

/** Direction control characters (RLO trick "rechnung‮fdp.exe"). */
export function hasBidiControls(text: string): boolean {
  for (const char of text) if (BIDI_CONTROLS.has(char.codePointAt(0) ?? 0)) return true
  return false
}
