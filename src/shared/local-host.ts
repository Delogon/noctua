// Heuristic: is a profile's base URL local/on-prem? Only a suggestion when
// creating it — the user decides on the flag.

/** Host of a URL without port/brackets, lowercased; null for an invalid URL. */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
  } catch {
    return null
  }
}

/** localhost, 127.0.0.0/8, ::1, *.local and RFC1918 (10/8, 172.16/12, 192.168/16). */
export function suggestIsLocal(url: string): boolean {
  const host = hostOf(url)
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1') return true
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number)
  if ([a, b, c, d].some((n) => n > 255)) return false
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
