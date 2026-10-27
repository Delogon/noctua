import { describe, it, expect } from 'vitest'
import { nextErrorSince } from '@main/sync/engine'

// „since 11:42" (Design 3b): the FIRST error time persists across the
// backoff cycles (error → connecting → error) and only disappears
// with a successful sync.

describe('nextErrorSince', () => {
  const NOW = 1_752_576_600_000

  it('merkt sich den ersten Fehlerzeitpunkt', () => {
    expect(nextErrorSince(null, 'error', NOW)).toBe(NOW)
  })

  it('spätere Fehler im selben Zyklus verschieben ihn nicht', () => {
    expect(nextErrorSince(NOW, 'error', NOW + 60_000)).toBe(NOW)
  })

  it('Reconnect-Versuche (connecting/syncing) lassen ihn stehen', () => {
    expect(nextErrorSince(NOW, 'connecting', NOW + 5_000)).toBe(NOW)
    expect(nextErrorSince(NOW, 'syncing', NOW + 6_000)).toBe(NOW)
  })

  it('erfolgreicher Sync (idle) und Stopp (off) löschen ihn', () => {
    expect(nextErrorSince(NOW, 'idle', NOW + 10_000)).toBeNull()
    expect(nextErrorSince(NOW, 'off', NOW + 10_000)).toBeNull()
  })

  it('gesunde Zustände ohne vorherigen Fehler bleiben leer', () => {
    expect(nextErrorSince(null, 'connecting', NOW)).toBeNull()
    expect(nextErrorSince(null, 'idle', NOW)).toBeNull()
  })
})
