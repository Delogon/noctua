import type { AiCategory } from '@shared/types'
import type { StringKey } from '@renderer/i18n/strings'

// Pure key logic of the category override menu (Design 3d) — separate from the
// overlay so the 1–7/0 mapping and the ↑↓ selection stay testable.

export interface OverrideOption {
  key: string
  category: AiCategory | null
  labelKey: StringKey
}

export const OVERRIDE_OPTIONS: readonly OverrideOption[] = [
  { key: '1', category: 'personal', labelKey: 'catPersonal' },
  { key: '2', category: 'work', labelKey: 'catWork' },
  { key: '3', category: 'newsletter', labelKey: 'catNewsletter' },
  { key: '4', category: 'promotions', labelKey: 'catPromotions' },
  { key: '5', category: 'notifications', labelKey: 'catNotifications' },
  { key: '6', category: 'transactional', labelKey: 'catTransactional' },
  { key: '7', category: 'other', labelKey: 'catOther' },
  { key: '0', category: null, labelKey: 'overrideReset' }
]

/** Option for the pressed key (1–7 sets, 0 hands the decision back to the owl). */
export function overrideOptionForKey(key: string): OverrideOption | undefined {
  return OVERRIDE_OPTIONS.find((option) => option.key === key)
}

/** ↑↓ selection: moves the index and keeps it within the list. */
export function moveOverrideSelection(index: number, delta: -1 | 1): number {
  return Math.max(0, Math.min(OVERRIDE_OPTIONS.length - 1, index + delta))
}
