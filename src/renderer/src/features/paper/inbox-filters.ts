import type { ThreadListItem } from '@shared/types'
import type { StringKey } from '@renderer/i18n/strings'
import { needsYou } from '@renderer/features/paper/priority'

/**
 * Filter-Registry der Posteingangs-Liste (Design Turn 7): Künftige Filter
 * sind EIN Eintrag hier — Menü-Sektionen, Optionen, Zeilen-Chips und die
 * UND-Verknüpfung entstehen daraus, ohne neue UI zu bauen.
 */

export type InboxFilterId = 'needsYou'

export interface InboxFilterDef {
  id: InboxFilterId
  /** strings.ts-Key der Sektions-Legende im Menü. */
  section: StringKey
  /** strings.ts-Key der Options-Beschriftung. */
  label: StringKey
  /** strings.ts-Key der Zusatznotiz hinter dem Label (optional). */
  note?: StringKey
  /** Nur Anzeige (kbd-Chip) — das Binding lebt in keymap.ts. */
  hotkey?: string
  predicate: (row: Pick<ThreadListItem, 'aiPriority'>) => boolean
  /** true: Option und Zeilen-Chip zeigen die Trefferzahl (ungefiltert). */
  countRows: boolean
}

export const INBOX_FILTERS: InboxFilterDef[] = [
  {
    id: 'needsYou',
    section: 'filterSectPriority',
    label: 'needsYou',
    note: 'needsYouRankNote',
    hotkey: 'I',
    predicate: needsYou,
    countRows: true
  }
]

/** UND-Verknüpfung aller aktiven Filter; leeres Set lässt die Rows unberührt. */
export function applyFilters<T extends Pick<ThreadListItem, 'aiPriority'>>(
  rows: T[],
  active: ReadonlySet<InboxFilterId>
): T[] {
  if (active.size === 0) return rows
  const predicates = INBOX_FILTERS.filter((def) => active.has(def.id)).map((def) => def.predicate)
  return rows.filter((row) => predicates.every((matches) => matches(row)))
}

/** Trefferzahlen je Filter — IMMER auf den ungefilterten Rows (stabile Zähler). */
export function filterCounts(
  rows: Array<Pick<ThreadListItem, 'aiPriority'>>
): Record<InboxFilterId, number> {
  const counts = {} as Record<InboxFilterId, number>
  for (const def of INBOX_FILTERS) {
    counts[def.id] = rows.filter(def.predicate).length
  }
  return counts
}

/** Sektionen in Registry-Reihenfolge, dedupliziert — fürs Menü-Rendering. */
export function filterSections(): Array<{ section: StringKey; defs: InboxFilterDef[] }> {
  const sections: Array<{ section: StringKey; defs: InboxFilterDef[] }> = []
  for (const def of INBOX_FILTERS) {
    const existing = sections.find((s) => s.section === def.section)
    if (existing) existing.defs.push(def)
    else sections.push({ section: def.section, defs: [def] })
  }
  return sections
}
