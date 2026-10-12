/**
 * Recency channel of chat retrieval: vector and full-text search are purely
 * topical — "Which mails arrived today?" therefore found topically matching
 * instead of new mails. The newest threads now always run along as a separate
 * channel; if the question has a recognizable time reference they move to the top.
 */

const TEMPORAL_PATTERNS: RegExp[] = [
  /\bheute\b/i,
  /\bgestern\b/i,
  /\bvorgestern\b/i,
  /\bgerade\s+eben\b/i,
  /\bzuletzt\b/i,
  /\bneueste[nrs]?\b/i,
  /\bjüngste[nrs]?\b/i,
  /\baktuellste[nrs]?\b/i,
  /\bletzte[nrs]?\s+(woche|monat|tag|stunde|zeit|mails?|nachricht)/i,
  /\bdiese[nr]?\s+(woche|monat)\b/i,
  /\btoday\b/i,
  /\byesterday\b/i,
  /\blatest\b/i,
  /\bnewest\b/i,
  /\brecent(ly)?\b/i,
  /\bthis\s+(week|month)\b/i,
  /\blast\s+(week|month|days?|hours?)\b/i
]

/** Does the question ask about a time reference ("today", "last week", "latest"…)? */
export function isTemporalQuestion(question: string): boolean {
  return TEMPORAL_PATTERNS.some((re) => re.test(question))
}

/**
 * Merges topical candidates with the newest threads. Time reference in the
 * question ⇒ newest first (they ARE the answer); otherwise they fill up at the
 * end so "What's new?"-style follow-up questions have material.
 */
export function blendThreadKeys(params: {
  topical: string[]
  newest: string[]
  temporal: boolean
  cap: number
}): string[] {
  const ordered = params.temporal
    ? [...params.newest, ...params.topical]
    : [...params.topical, ...params.newest]
  return [...new Set(ordered)].slice(0, Math.max(1, params.cap))
}
