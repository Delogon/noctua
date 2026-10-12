import { describe, expect, it } from 'vitest'
import { sanitizeFilename } from '../../src/main/mail/filename'

describe('sanitizeFilename', () => {
  it('lässt normale Namen unverändert', () => {
    expect(sanitizeFilename('Rechnung 2026.pdf')).toBe('Rechnung 2026.pdf')
  })

  it('schneidet Pfade ab (beide Separatoren)', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('..\\..\\Windows\\evil.exe')).toBe('evil.exe')
    expect(sanitizeFilename('/abs/path/file.txt')).toBe('file.txt')
  })

  it('entfernt NUL/Steuerzeichen, führende und abschließende Punkte/Leerzeichen', () => {
    expect(sanitizeFilename('a\u0000b\nc.txt')).toBe('abc.txt')
    expect(sanitizeFilename('.bashrc')).toBe('bashrc')
    expect(sanitizeFilename('report.pdf. . ')).toBe('report.pdf')
  })

  it('ersetzt reservierte Zeichen', () => {
    expect(sanitizeFilename('a:b*c?.txt')).toBe('a_b_c_.txt')
  })

  it('kürzt lange Namen und behält die Endung', () => {
    const out = sanitizeFilename('x'.repeat(500) + '.pdf')
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('.pdf')).toBe(true)
  })

  it('nutzt den Fallback bei leeren Namen', () => {
    expect(sanitizeFilename(null)).toBe('anhang')
    expect(sanitizeFilename('')).toBe('anhang')
    expect(sanitizeFilename('...')).toBe('anhang')
    expect(sanitizeFilename('../')).toBe('anhang')
  })
})
