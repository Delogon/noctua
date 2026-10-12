import { describe, it, expect } from 'vitest'
import {
  cleanIpcError,
  confirmAfter,
  DISCONNECT_CONFIRM_WINDOW_MS,
  freshnessOf,
  parseVoiceMeta,
  syncErrorLine
} from '@renderer/features/paper/account-states'

describe('confirmAfter (Zweitklick-Bestätigung beim Trennen, Design 3b)', () => {
  it('nur arm spannt die Bestätigung', () => {
    expect(confirmAfter('arm')).toBe(true)
  })

  it('Esc, Blur, Timeout, KEEP und Bestätigen entspannen', () => {
    expect(confirmAfter('esc')).toBe(false)
    expect(confirmAfter('blur')).toBe(false)
    expect(confirmAfter('timeout')).toBe(false)
    expect(confirmAfter('keep')).toBe(false)
    expect(confirmAfter('confirm')).toBe(false)
  })

  it('das Rückfall-Fenster beträgt 5 Sekunden (Design-Wert)', () => {
    expect(DISCONNECT_CONFIRM_WINDOW_MS).toBe(5000)
  })
})

describe('parseVoiceMeta (Frische-Metadaten der Voice-Card)', () => {
  it('liest gültige Metadaten', () => {
    expect(parseVoiceMeta('{"replies": 132, "updatedAt": 1752576600000}')).toEqual({
      replies: 132,
      updatedAt: 1_752_576_600_000
    })
  })

  it('rundet krumme Antwort-Zahlen ab', () => {
    expect(parseVoiceMeta('{"replies": 12.9, "updatedAt": 1000}')).toEqual({
      replies: 12,
      updatedAt: 1000
    })
  })

  it('null bei kaputtem JSON, fehlenden Feldern oder Unsinn', () => {
    expect(parseVoiceMeta(null)).toBeNull()
    expect(parseVoiceMeta('')).toBeNull()
    expect(parseVoiceMeta('kein json')).toBeNull()
    expect(parseVoiceMeta('{"replies": 5}')).toBeNull()
    expect(parseVoiceMeta('{"updatedAt": 1000}')).toBeNull()
    expect(parseVoiceMeta('{"replies": -1, "updatedAt": 1000}')).toBeNull()
    expect(parseVoiceMeta('{"replies": "viele", "updatedAt": 1000}')).toBeNull()
    expect(parseVoiceMeta('{"replies": 5, "updatedAt": 0}')).toBeNull()
  })
})

describe('freshnessOf (kalendertag-genaue Frische, Design 3e)', () => {
  const noon = new Date(2026, 6, 15, 12, 0).getTime()

  it('gleicher Kalendertag = heute', () => {
    expect(freshnessOf(new Date(2026, 6, 15, 0, 5).getTime(), noon)).toEqual({ kind: 'today' })
    expect(freshnessOf(noon, noon)).toEqual({ kind: 'today' })
  })

  it('gestern endet um Mitternacht, nicht nach 24 h', () => {
    expect(freshnessOf(new Date(2026, 6, 14, 23, 59).getTime(), noon)).toEqual({
      kind: 'yesterday'
    })
    // 13 hours ago, but a day boundary in between → yesterday
    expect(freshnessOf(new Date(2026, 6, 14, 23, 0).getTime(), noon)).toEqual({
      kind: 'yesterday'
    })
  })

  it('davor zählt in ganzen Tagen', () => {
    expect(freshnessOf(new Date(2026, 6, 10, 18, 0).getTime(), noon)).toEqual({
      kind: 'days',
      days: 5
    })
  })

  it('Zukunfts-Zeitstempel (verstellte Uhr) gelten als heute', () => {
    expect(freshnessOf(new Date(2026, 6, 16, 9, 0).getTime(), noon)).toEqual({ kind: 'today' })
  })
})

describe('cleanIpcError (Transport-Rauschen raus, echte Meldung rein)', () => {
  it('entfernt Electrons remote-method-Präfix samt innerem Error:', () => {
    expect(
      cleanIpcError("Error invoking remote method 'ai:refreshStyle': Error: 401 User not found.")
    ).toBe('401 User not found.')
  })

  it('lässt bereits saubere Meldungen unangetastet', () => {
    expect(cleanIpcError('Stil-Analyse lieferte kein JSON — bitte nochmal versuchen')).toBe(
      'Stil-Analyse lieferte kein JSON — bitte nochmal versuchen'
    )
  })
})

describe('syncErrorLine (gespeicherter Fehlertext inline, Design 3b)', () => {
  it('kombiniert Fehlertext und Zeitpunkt', () => {
    expect(syncErrorLine('IMAP: connection refused (993)', 'since 11:42')).toBe(
      'IMAP: connection refused (993) — since 11:42'
    )
  })

  it('ohne Zeitpunkt bleibt der Fehlertext allein', () => {
    expect(syncErrorLine('IMAP: connection refused (993)', null)).toBe(
      'IMAP: connection refused (993)'
    )
  })

  it('null ohne brauchbaren Fehlertext — der Aufrufer fällt aufs Label zurück', () => {
    expect(syncErrorLine(null, 'since 11:42')).toBeNull()
    expect(syncErrorLine('   ', 'since 11:42')).toBeNull()
  })
})
