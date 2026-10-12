/**
 * Detects the phishing pattern "visible link text looks like a URL but leads
 * to a different host" (SEC-12). Pure, no DOM.
 */

const URL_LIKE =
  /^(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * Returns the hosts if the host shown in the link text differs from the href host
 * (subdomain relationships count as equal), otherwise null.
 */
export function linkHostMismatch(
  text: string,
  href: string
): { shown: string; actual: string } | null {
  const trimmed = text.trim()
  if (!URL_LIKE.test(trimmed) || !/^https?:/i.test(href)) return null
  const shown = hostOf(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
  const actual = hostOf(href)
  if (!shown || !actual) return null
  if (shown === actual || shown.endsWith(`.${actual}`) || actual.endsWith(`.${shown}`)) return null
  return { shown, actual }
}
