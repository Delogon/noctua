import type { ThreadListItem } from '@shared/types'

/**
 * Priority visibility (Design Turn 5): rank 5 rings (accent tick), rank 4
 * notifies (ink tick), everything below stays silent — the list deliberately
 * shows no numbers and does not change sorting.
 */
export function priorityTickTone(aiPriority: number | null): 'accent' | 'ink' | null {
  if (aiPriority === 5) return 'accent'
  if (aiPriority === 4) return 'ink'
  return null
}

/** „Braucht dich" filter: rank 4+ — deliberately the same threshold as priorityTickTone. */
export function needsYou(item: Pick<ThreadListItem, 'aiPriority'>): boolean {
  return (item.aiPriority ?? 0) >= 4
}
