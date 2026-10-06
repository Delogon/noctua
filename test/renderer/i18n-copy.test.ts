import { describe, it, expect } from 'vitest'
import { STRINGS } from '@renderer/i18n/strings'

/**
 * Copy-Hygiene für die String-Tabelle (siehe docs/GLOSSARY.md). Kein Test der
 * Wortwahl im Einzelnen, sondern Heuristiken gegen die typischen Rückfälle:
 * leere Texte, verlorene Platzhalter, „Sie“-Anrede, „Post“ für E-Mail.
 */

const entries = Object.entries(STRINGS) as [string, { en: string; de: string }][]

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('String-Tabelle: Vollständigkeit', () => {
  it('hat viele Einträge', () => {
    expect(entries.length).toBeGreaterThan(900)
  })

  it('jeder Eintrag hat nicht-leeres en und de', () => {
    const bad = entries.filter(([, v]) => v.en.trim() === '' || v.de.trim() === '').map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('en und de verwenden dieselben {Platzhalter}', () => {
    const bad = entries
      .filter(([, v]) => placeholders(v.en).join() !== placeholders(v.de).join())
      .map(([k]) => k)
    expect(bad).toEqual([])
  })
})

describe('Deutsche Texte: Glossar-Heuristiken', () => {
  const de = entries.map(([k, v]) => [k, v.de] as const)

  it('duzt: keine förmliche Anrede („Sie“ mitten im Satz, Ihr/Ihre/Ihnen)', () => {
    const formal = /(?<=[a-zäöüß,;:]\s)Sie\b|\bIhr(?:e[nmrs]?)?\b|\bIhnen\b/
    const bad = de.filter(([, s]) => formal.test(s)).map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('nennt E-Mail nie „Post“ und nie „Mail(s)“ allein', () => {
    const bad = de
      .filter(([, s]) => /\bPost\b|\bPostfach|(?<![-\w])(?:Mails?|MAILS?)\b/.test(s))
      .map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('meidet Anglizismen aus dem Glossar (Account, Thread, Local only, Intelligenz, Vault)', () => {
    const bad = de
      .filter(
        ([k, s]) =>
          !k.startsWith('cmdLanguage') &&
          /\bAccounts?\b|\bThreads?\b|Local only|Intelligenz|\bVault\b/i.test(s)
      )
      .map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('setzt „–“ statt „ — “ und typografische Anführungszeichen', () => {
    const bad = de.filter(([, s]) => / — /.test(s) || /„[^“"]*"/.test(s)).map(([k]) => k)
    expect(bad).toEqual([])
  })
})

describe('Englische Texte: Glossar-Heuristiken', () => {
  const en = entries.map(([k, v]) => [k, v.en] as const)

  it('nutzt „email“ statt „mail“, „account“ statt „mailbox“, US-Schreibweise', () => {
    const bad = en
      .filter(([, s]) =>
        /(?<![\w.-])mails?\b(?![-\s]?servers?\b)|\bmailbox(?!\.org)|colour|organis|cancell(?:ed|ing)/i.test(
          s.replace(/mail\.yourdomain\.com/g, '')
        )
      )
      .map(([k]) => k)
    expect(bad).toEqual([])
  })
})
