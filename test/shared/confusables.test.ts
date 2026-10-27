import { describe, expect, it } from 'vitest'
import {
  countInvisibleChars,
  domainSkeleton,
  findMixedScriptWords,
  hasBidiControls,
  isMixedScriptWord,
  skeleton
} from '@shared/confusables'

describe('Homoglyphen und Schriftmischung', () => {
  it('erkennt lateinische Wörter mit kyrillischen/griechischen Ersatzzeichen', () => {
    expect(isMixedScriptWord('Pаypal')).toBe(true) // Cyrillic а
    expect(isMixedScriptWord('Αpple')).toBe(true) // Greek Α
    expect(findMixedScriptWords('Ihr Kоnto bei der Bаnk')).toEqual(['Kоnto', 'Bаnk'])
  })

  it('echte Sprache bleibt unauffällig: Russisch, Griechisch, Umlaute, Akzente', () => {
    expect(findMixedScriptWords('Привет, как дела? Γειά σου κόσμε')).toEqual([])
    expect(findMixedScriptWords('Grüße aus München, café crème, Straße')).toEqual([])
    expect(findMixedScriptWords('Meeting mit Иван am Montag')).toEqual([])
  })

  it('Skelett löst Ersatzzeichen, Vollbreite und mathematische Alphabete auf', () => {
    expect(skeleton('pаypal')).toBe('paypal')
    expect(skeleton('ＰａｙＰａｌ')).toBe('paypal')
    expect(skeleton('𝐩𝐚𝐲𝐩𝐚𝐥')).toBe('paypal')
    expect(domainSkeleton('paypa1')).toBe('paypal')
    expect(domainSkeleton('rnicrosoft')).toBe('microsoft')
    expect(domainSkeleton('g00gle')).toBe('google')
  })

  it('unsichtbare Zeichen: Nullbreite zählt, ZWJ in Emoji und BOM am Anfang nicht', () => {
    expect(countInvisibleChars('Re​ch​nung')).toBe(2)
    expect(countInvisibleChars('👨‍👩‍👧 Familie')).toBe(0)
    expect(countInvisibleChars('﻿Hallo')).toBe(0)
    expect(countInvisibleChars('V‍erify')).toBe(1)
    // Newsletter preview text: zero-width between spaces counts only without insideWords
    expect(countInvisibleChars(' ​ ​ ​ ', true)).toBe(0)
    expect(countInvisibleChars('Re​chnung', true)).toBe(1)
  })

  it('Richtungs-Steuerzeichen (RLO-Trick)', () => {
    expect(hasBidiControls('rechnung‮fdp.exe')).toBe(true)
    expect(hasBidiControls('rechnung.pdf')).toBe(false)
  })
})
