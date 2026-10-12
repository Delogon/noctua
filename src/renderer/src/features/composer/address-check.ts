/**
 * Address classification for the recipient chips (Design 3a).
 *
 * "ok": looks like a complete address (@ with a dot in the domain)
 * "doubtful": contains an @ with something before and after it, but the domain
 *             lacks a dot — stays sendable, but is marked in accent
 * "invalid": everything else — never becomes a chip at all
 */
export type AddressQuality = 'ok' | 'doubtful' | 'invalid'

export function classifyAddress(raw: string): AddressQuality {
  const value = raw.trim()
  if (!value) return 'invalid'
  // Same heuristic as the recipient field's previous isAddress
  if (/\S+@\S+\.\S+/.test(value)) return 'ok'
  if (/\S@\S/.test(value)) return 'doubtful'
  return 'invalid'
}

/** May become a chip — complete AND doubtful addresses. */
export function isChippableAddress(raw: string): boolean {
  return classifyAddress(raw) !== 'invalid'
}

/** Doubtful: @ present, but no dot in the domain. */
export function isDoubtfulAddress(raw: string): boolean {
  return classifyAddress(raw) === 'doubtful'
}

/** Split free-form input into address candidates (comma/semicolon/whitespace). */
export function parseAddresses(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.includes('@'))
}
