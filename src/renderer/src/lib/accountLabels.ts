import type { AccountSummary } from '@shared/types'

/** Consistent mailbox names for filters, badges, palette and pickers. */
export function accountLabels(
  accounts: Array<Pick<AccountSummary, 'id' | 'accountName'>>
): Map<number, string> {
  const map = new Map<number, string>()
  for (const account of accounts) map.set(account.id, account.accountName)
  return map
}
