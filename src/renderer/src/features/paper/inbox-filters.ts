import type { ThreadListItem } from '@shared/types'
import type { StringKey } from '@renderer/i18n/strings'
import { needsYou } from '@renderer/features/paper/priority'

/**
 * Filter registry of the inbox list (Design Turn 7): future filters are ONE
 * entry here — menu sections, options, row chips and the AND combination
 * derive from it without building new UI.
 */

export type InboxFilterId = 'needsYou'

export interface InboxFilterDef {
  id: InboxFilterId
  /** strings.ts key of the section legend in the menu. */
  section: StringKey
  /** strings.ts key of the option label. */
  label: StringKey
  /** strings.ts key of the extra note after the label (optional). */
  note?: StringKey
  /** Display only (kbd chip) — the binding lives in keymap.ts. */
  hotkey?: string
  predicate: (row: Pick<ThreadListItem, 'aiPriority'>) => boolean
  /** true: option and row chip show the match count (unfiltered). */
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

/** AND combination of all active filters; an empty set leaves the rows untouched. */
export function applyFilters<T extends Pick<ThreadListItem, 'aiPriority'>>(
  rows: T[],
  active: ReadonlySet<InboxFilterId>
): T[] {
  if (active.size === 0) return rows
  const predicates = INBOX_FILTERS.filter((def) => active.has(def.id)).map((def) => def.predicate)
  return rows.filter((row) => predicates.every((matches) => matches(row)))
}

/** Match counts per filter — ALWAYS on the unfiltered rows (stable counters). */
export function filterCounts(
  rows: Array<Pick<ThreadListItem, 'aiPriority'>>
): Record<InboxFilterId, number> {
  const counts = {} as Record<InboxFilterId, number>
  for (const def of INBOX_FILTERS) {
    counts[def.id] = rows.filter(def.predicate).length
  }
  return counts
}

/** Sections in registry order, deduplicated — for menu rendering. */
export function filterSections(): Array<{ section: StringKey; defs: InboxFilterDef[] }> {
  const sections: Array<{ section: StringKey; defs: InboxFilterDef[] }> = []
  for (const def of INBOX_FILTERS) {
    const existing = sections.find((s) => s.section === def.section)
    if (existing) existing.defs.push(def)
    else sections.push({ section: def.section, defs: [def] })
  }
  return sections
}
