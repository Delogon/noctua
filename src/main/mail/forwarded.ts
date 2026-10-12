const FORWARDED_SUBJECT = /^\s*(?:fwd?|wg|wtr)\s*(?:\[\d+\])?\s*:/i
const FORWARDED_MARKER =
  /(?:^|\s)(?:>+\s*)?(?:anfang der weitergeleiteten nachricht|begin forwarded message|weitergeleitete nachricht|[-–—\s]*forwarded message[-–—\s]*)\s*:?\s*/i
const INFORMATION_ONLY =
  /^(?:fyi|(?:nur\s+)?zur\s+(?:info(?:rmation)?|kenntnis(?:nahme)?))\s*[.!,:;–—-]*$/i

export function isForwardedSubject(subject: string | null | undefined): boolean {
  return FORWARDED_SUBJECT.test(subject ?? '')
}

/**
 * For a forward, only the text the current sender added before the
 * embedded original counts. That way questions from the
 * forwarded mail aren't accidentally attributed to the current sender.
 */
export function textBeforeForwardedMessage(
  subject: string | null | undefined,
  text: string
): string {
  const clean = text.replace(/[\u200b-\u200d\ufeff]/g, '').trim()
  if (!isForwardedSubject(subject)) return clean
  const marker = FORWARDED_MARKER.exec(clean)
  if (!marker) return clean
  return clean
    .slice(0, marker.index)
    .replace(/^[\s>￼]+|[\s>￼]+$/g, '')
    .trim()
}

/** Forward without a request: empty or merely FYI. */
export function isForwardWithoutRequest(subject: string | null | undefined, text: string): boolean {
  if (!isForwardedSubject(subject)) return false
  const ownText = textBeforeForwardedMessage(subject, text)
  return ownText.length === 0 || INFORMATION_ONLY.test(ownText)
}
