import { describe, it, expect } from 'vitest'
import { needsYou, priorityTickTone } from '@renderer/features/paper/priority'

/** Design Turn 5: Rang-Ticks und der „Braucht dich"-Filter (Renderer-Seite). */

describe('priorityTickTone', () => {
  it('Rang 5 → Akzent, Rang 4 → Ink, darunter/null → kein Tick', () => {
    expect(priorityTickTone(5)).toBe('accent')
    expect(priorityTickTone(4)).toBe('ink')
    expect(priorityTickTone(3)).toBeNull()
    expect(priorityTickTone(1)).toBeNull()
    expect(priorityTickTone(null)).toBeNull()
  })
})

describe('needsYou („Braucht dich": Rang 4+)', () => {
  it('zählt Rang 4 und 5, nichts darunter', () => {
    expect(needsYou({ aiPriority: 5 })).toBe(true)
    expect(needsYou({ aiPriority: 4 })).toBe(true)
    expect(needsYou({ aiPriority: 3 })).toBe(false)
    expect(needsYou({ aiPriority: null })).toBe(false)
  })

  it('Zähler läuft über die ungefilterte Liste', () => {
    const rows = [{ aiPriority: 5 }, { aiPriority: 4 }, { aiPriority: 2 }, { aiPriority: null }]
    expect(rows.filter(needsYou)).toHaveLength(2)
  })
})
