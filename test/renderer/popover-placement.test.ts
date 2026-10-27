import { describe, expect, it } from 'vitest'
import { computePopoverPlacement } from '../../src/renderer/src/lib/popover-placement'

// Geometry of automatic popover placement (M83): direction choice and
// clamping at window edges — the hook itself only measures + passes through.

const VIEWPORT = { width: 1000, height: 800 }

describe('computePopoverPlacement', () => {
  it('öffnet linksbündig unter dem Anker, wenn rechts Platz ist', () => {
    const anchor = { left: 100, top: 50, width: 120, height: 24 }
    const p = computePopoverPlacement(anchor, { width: 300, height: 200 }, VIEWPORT)
    expect(p).toEqual({ left: 100, top: 78, maxHeight: null, openUp: false })
  })

  it('weicht auf rechtsbündig aus, wenn linksbündig rechts hinausragen würde', () => {
    // Anchor near the right edge: 900 + 300 > 992
    const anchor = { left: 900, top: 50, width: 80, height: 24 }
    const p = computePopoverPlacement(anchor, { width: 300, height: 200 }, VIEWPORT)
    expect(p.left).toBe(900 + 80 - 300)
    expect(p.openUp).toBe(false)
  })

  it('klemmt an die linke Kante, wenn auch rechtsbündig hinausragen würde', () => {
    // Tim's case: anchor at left of the pane, menu wider than the space to its left
    const anchor = { left: 40, top: 50, width: 60, height: 24 }
    const narrow = { width: 320, height: 800 }
    const p = computePopoverPlacement(anchor, { width: 292, height: 200 }, narrow)
    expect(p.left).toBe(8)
    expect(p.left + 292).toBeLessThanOrEqual(narrow.width - 8)
  })

  it('klemmt an die rechte Kante, wenn der Anker selbst hinausragt', () => {
    // Anchor ends past the window edge → even right-aligned sticks out
    const anchor = { left: 900, top: 50, width: 150, height: 24 }
    const p = computePopoverPlacement(anchor, { width: 300, height: 200 }, VIEWPORT)
    expect(p.left + 300).toBe(VIEWPORT.width - 8)
  })

  it('öffnet nach oben, wenn unterm Anker weniger Raum ist als darüber', () => {
    const anchor = { left: 100, top: 700, width: 120, height: 24 }
    const p = computePopoverPlacement(anchor, { width: 300, height: 200 }, VIEWPORT)
    expect(p.openUp).toBe(true)
    expect(p.maxHeight).toBeNull()
    // Bottom edge ends at the gap above the anchor
    expect(p.top + 200).toBe(700 - 4)
    expect(p.top).toBeGreaterThanOrEqual(8)
  })

  it('kappt die Höhe, wenn keine Seite das ganze Popover fasst', () => {
    const anchor = { left: 100, top: 100, width: 120, height: 24 }
    const short = { width: 1000, height: 300 }
    const p = computePopoverPlacement(anchor, { width: 300, height: 400 }, short)
    // Below: 300 − 8 − (100+24+4) = 164; above: 100 − 4 − 8 = 88 → stays below
    expect(p.openUp).toBe(false)
    expect(p.maxHeight).toBe(164)
    expect(p.top).toBe(128)
  })

  it('kappt nach oben geöffnet an der Oberkante', () => {
    const anchor = { left: 100, top: 250, width: 120, height: 24 }
    const short = { width: 1000, height: 300 }
    const p = computePopoverPlacement(anchor, { width: 300, height: 400 }, short)
    // Below: 300 − 8 − 278 = 14; above: 250 − 12 = 238 → above, capped at 238
    expect(p.openUp).toBe(true)
    expect(p.maxHeight).toBe(238)
    expect(p.top).toBe(8)
  })
})
