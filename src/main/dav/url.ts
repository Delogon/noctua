/** URL helpers for the WebDAV client: transport rules and href normalization. */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(hostname)
}

export class InsecureUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsecureUrlError'
  }
}

/**
 * Credentials only go out over HTTPS. http:// is allowed exclusively for
 * loopback (local Radicale/Baïkal for testing).
 */
export function assertSecureUrl(url: URL): void {
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return
  throw new InsecureUrlError(
    url.protocol === 'http:'
      ? 'Unverschlüsselte Verbindung (http://) ist nicht erlaubt — bitte https:// verwenden'
      : `Nicht unterstütztes Protokoll: ${url.protocol}`
  )
}

/** Parses a server address entered by the user (without scheme → https://). */
export function parseServerInput(raw: string): URL {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Server-Adresse fehlt')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error('Ungültige Server-Adresse')
  }
  if (url.username || url.password) {
    throw new Error('Zugangsdaten gehören nicht in die URL')
  }
  assertSecureUrl(url)
  url.hash = ''
  return url
}

const PCHAR_KEEP = /[A-Za-z0-9\-._~!$&'()*+,;=:@]/

function canonicalSegment(segment: string): string {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return segment
  }
  let out = ''
  for (const ch of decoded) {
    out += PCHAR_KEEP.test(ch) ? ch : encodeURIComponent(ch)
  }
  return out
}

/**
 * Normalized path of an href (absolute or relative to `base`): same
 * resource → same string, even if the server sometimes sends `%40` and sometimes `@`.
 * Used as a key in the DB and for comparisons.
 */
export function normalizeHref(href: string, base: string | URL): string {
  const url = new URL(href, base)
  return url.pathname.split('/').map(canonicalSegment).join('/')
}

/** Normalized path with trailing slash (for collections). */
export function normalizeCollectionHref(href: string, base: string | URL): string {
  const p = normalizeHref(href, base)
  return p.endsWith('/') ? p : `${p}/`
}

/** Absolute URL for a stored path on the server `origin`. */
export function hrefToUrl(href: string, base: string | URL): string {
  return new URL(href, base).toString()
}

export function sameOrigin(a: URL, b: URL): boolean {
  return a.origin === b.origin
}

/**
 * Does `candidate` belong to the same provider as `anchor`? (same origin or
 * same registrable domain, e.g. caldav.icloud.com → p01-caldav.icloud.com).
 * Protects against a server redirecting the credentials to a foreign
 * host via href.
 */
export function isRelatedHost(anchor: URL, candidate: URL): boolean {
  if (sameOrigin(anchor, candidate)) return true
  if (anchor.protocol !== candidate.protocol && candidate.protocol !== 'https:') return false
  const a = anchor.hostname.toLowerCase().split('.')
  const c = candidate.hostname.toLowerCase().split('.')
  if (a.length < 2 || c.length < 2) return false
  const second = ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']
  const keep = (parts: string[]): number => (second.includes(parts[parts.length - 2]) ? 3 : 2)
  const n = Math.max(keep(a), keep(c))
  return a.slice(-n).join('.') === c.slice(-n).join('.')
}
