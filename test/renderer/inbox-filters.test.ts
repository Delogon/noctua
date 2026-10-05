import { describe, it, expect } from 'vitest'
import {
  applyFilters,
  filterCounts,
  filterSections,
  INBOX_FILTERS
} from '@renderer/features/paper/inbox-filters'

/** Filter-Registry der Posteingangs-Liste (Design Turn 7). */

const rows = [{ aiPriority: 5 }, { aiPriority: 4 }, { aiPriority: 3 }, { aiPriority: null }]

describe('applyFilters', () => {
  it('leeres Set lässt die Rows unangetastet (Identität)', () => {
    expect(applyFilters(rows, new Set())).toBe(rows)
  })

  it('needsYou filtert auf Rang 4+ (UND-Verknüpfung aktiver Prädikate)', () => {
    const filtered = applyFilters(rows, new Set(['needsYou'] as const))
    expect(filtered).toHaveLength(2)
    expect(filtered.every((r) => (r.aiPriority ?? 0) >= 4)).toBe(true)
  })
})

describe('filterCounts', () => {
  it('zählt IMMER auf den ungefilterten Rows', () => {
    expect(filterCounts(rows)).toEqual({ needsYou: 2 })
    expect(filterCounts([])).toEqual({ needsYou: 0 })
  })
})

describe('Registry', () => {
  it('heute genau ein Filter (needsYou) in genau einer Sektion', () => {
    expect(INBOX_FILTERS.map((d) => d.id)).toEqual(['needsYou'])
    const sections = filterSections()
    expect(sections).toHaveLength(1)
    expect(sections[0].section).toBe('filterSectPriority')
    expect(sections[0].defs.map((d) => d.id)).toEqual(['needsYou'])
  })

  it('gleiche Sektion gruppiert, neue Sektion entsteht mit dem ersten Def', () => {
    // Struktur-Eigenschaft der Gruppierung, nicht der heutigen Registry:
    const sections = filterSections()
    const uniqueSections = new Set(INBOX_FILTERS.map((d) => d.section))
    expect(sections).toHaveLength(uniqueSections.size)
  })
})
