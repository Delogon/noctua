import { describe, it, expect } from 'vitest'
import { blendThreadKeys, isTemporalQuestion } from '@main/ai/chat-recency'

describe('isTemporalQuestion', () => {
  it('erkennt deutsche Zeitbezüge', () => {
    expect(isTemporalQuestion('Welche Mails kamen heute an?')).toBe(true)
    expect(isTemporalQuestion('Was kam gestern rein?')).toBe(true)
    expect(isTemporalQuestion('Zeig mir die neuesten Nachrichten')).toBe(true)
    expect(isTemporalQuestion('Was ist letzte Woche passiert?')).toBe(true)
    expect(isTemporalQuestion('Gab es diesen Monat Rechnungen?')).toBe(true)
  })

  it('erkennt englische Zeitbezüge', () => {
    expect(isTemporalQuestion('What arrived today?')).toBe(true)
    expect(isTemporalQuestion('Any recent invoices?')).toBe(true)
    expect(isTemporalQuestion('Show the latest from Hetzner')).toBe(true)
  })

  it('lässt thematische Fragen unangetastet', () => {
    expect(isTemporalQuestion('Welche Mails betreffen Plakate?')).toBe(false)
    expect(isTemporalQuestion('Was schulde ich Hetzner?')).toBe(false)
    // „Heute"/partial words do not count
    expect(isTemporalQuestion('Wer ist Frau Heutemann?')).toBe(false)
  })
})

describe('blendThreadKeys', () => {
  const topical = ['t1', 't2', 't3']
  const newest = ['n1', 'n2', 't2']

  it('stellt bei Zeitbezug die neuesten nach vorn', () => {
    expect(blendThreadKeys({ topical, newest, temporal: true, cap: 12 })).toEqual([
      'n1',
      'n2',
      't2',
      't1',
      't3'
    ])
  })

  it('füllt ohne Zeitbezug hinten auf', () => {
    expect(blendThreadKeys({ topical, newest, temporal: false, cap: 12 })).toEqual([
      't1',
      't2',
      't3',
      'n1',
      'n2'
    ])
  })

  it('dedupliziert und kappt', () => {
    expect(blendThreadKeys({ topical, newest, temporal: false, cap: 4 })).toHaveLength(4)
    expect(blendThreadKeys({ topical: [], newest, temporal: true, cap: 12 })).toEqual([
      'n1',
      'n2',
      't2'
    ])
  })
})
