import { describe, it, expect } from 'vitest'
import { FROM_AUTOPILOT_NOTE_MS, planAutoSwitch } from '@renderer/features/composer/from-autopilot'

/**
 * Design 3a: The account autopilot follows the recipient's preferred account.
 * If it switches the visible account, a note appears; a manual choice
 * always wins and suppresses it.
 */
describe('planAutoSwitch', () => {
  const accountIds = [1, 2, 3]

  it('wechselt mit Notiz, wenn das bevorzugte Konto ein anderes ist', () => {
    expect(
      planAutoSwitch({
        preferredAccountId: 2,
        currentAccountId: 1,
        manuallySelected: false,
        accountIds
      })
    ).toEqual({ accountId: 2, showNote: true })
  })

  it('pinnt ohne Notiz, wenn das bevorzugte Konto schon sichtbar ist', () => {
    expect(
      planAutoSwitch({
        preferredAccountId: 1,
        currentAccountId: 1,
        manuallySelected: false,
        accountIds
      })
    ).toEqual({ accountId: 1, showNote: false })
  })

  it('manuelle Wahl gewinnt — kein Wechsel, keine Notiz', () => {
    expect(
      planAutoSwitch({
        preferredAccountId: 2,
        currentAccountId: 1,
        manuallySelected: true,
        accountIds
      })
    ).toBeNull()
  })

  it('ohne Historie passiert nichts', () => {
    expect(
      planAutoSwitch({
        preferredAccountId: null,
        currentAccountId: 1,
        manuallySelected: false,
        accountIds
      })
    ).toBeNull()
  })

  it('verwaiste Empfehlungen (Konto entfernt) werden ignoriert', () => {
    expect(
      planAutoSwitch({
        preferredAccountId: 99,
        currentAccountId: 1,
        manuallySelected: false,
        accountIds
      })
    ).toBeNull()
  })

  it('ohne Konten passiert nichts', () => {
    expect(
      planAutoSwitch({
        preferredAccountId: 1,
        currentAccountId: null,
        manuallySelected: false,
        accountIds: []
      })
    ).toBeNull()
  })

  it('die Notiz bleibt ~4 s stehen', () => {
    expect(FROM_AUTOPILOT_NOTE_MS).toBe(4000)
  })
})
