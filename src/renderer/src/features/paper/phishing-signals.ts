import type { StringKey } from '@renderer/i18n/strings'

const REASON_KEY: Record<string, StringKey> = {
  display_name_domain: 'phishReasonDisplayName',
  reply_to_differs: 'phishReasonReplyTo',
  link_mismatch: 'phishReasonLinkMismatch',
  ip_link: 'phishReasonIpLink',
  punycode_link: 'phishReasonPunycode'
}

/** "link_mismatch:2" → { key: 'link_mismatch', n: 2 }; unbekannte Codes entfallen. */
export function parseSignal(code: string): { key: StringKey; n: number } | null {
  const [name, count] = code.split(':')
  const key = REASON_KEY[name]
  return key ? { key, n: Math.max(1, Number(count) || 1) } : null
}
