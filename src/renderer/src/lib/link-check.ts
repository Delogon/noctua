/**
 * Erkennt Phishing-Muster „sichtbarer Linktext sieht wie eine URL aus, führt aber
 * zu einem anderen Host" (SEC-12). Rein, ohne DOM.
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
 * Liefert die Hosts, wenn der im Linktext sichtbare Host vom href-Host abweicht
 * (Subdomain-Beziehungen gelten als gleich), sonst null.
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
