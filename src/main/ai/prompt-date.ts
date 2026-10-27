/**
 * Date line for system prompts: the models don't know today's date —
 * without this line the owl can't resolve questions like "this month" or dictations
 * like "tell him I'll get back tomorrow". The ISO form is included
 * so the model can calculate reliably.
 */
/**
 * Timestamp in LOCAL time for prompts ("2026-07-16 09:12") — toISOString
 * would be UTC and around midnight even shifts the date. sv-SE yields the
 * ISO-like format; timeZone can only be overridden for tests.
 */
export function localStamp(ts: number | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {})
  })
    .format(typeof ts === 'number' ? new Date(ts) : ts)
    .replace(',', '')
}

export function currentDateLine(now = new Date()): string {
  const readable = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now)
  const iso = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now)
  return `Today is ${readable} (${iso}), ${time}.`
}
