/**
 * Composer account autopilot (Design 3a): new messages silently follow the
 * mailbox last used for the first recipient. If the autopilot changes the
 * visible FROM account, an accent note appears for ~4 s —
 * a manual choice wins and suppresses it.
 */

/** Visibility duration of the autopilot note (~4 s per Design 3a). */
export const FROM_AUTOPILOT_NOTE_MS = 4000

export interface AutoSwitchPlan {
  accountId: number
  /** Only show the note if the visibly selected account really changes. */
  showNote: boolean
}

export function planAutoSwitch(params: {
  /** Preferred account per contacts:preferredAccount — null: no history. */
  preferredAccountId: number | null
  /** Effectively displayed account (selected or first) — null: no accounts. */
  currentAccountId: number | null
  /** Has Tim already chosen himself in this draft? Then he wins. */
  manuallySelected: boolean
  /** Known account IDs — orphaned recommendations are ignored. */
  accountIds: readonly number[]
}): AutoSwitchPlan | null {
  const { preferredAccountId, currentAccountId, manuallySelected, accountIds } = params
  if (manuallySelected || preferredAccountId === null) return null
  if (!accountIds.includes(preferredAccountId)) return null
  return {
    accountId: preferredAccountId,
    showNote: preferredAccountId !== currentAccountId
  }
}
