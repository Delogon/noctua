/**
 * Datumszeile für System-Prompts: Die Modelle kennen das heutige Datum nicht —
 * ohne diese Zeile kann die Eule Fragen wie „diesen Monat" oder Diktate wie
 * „sag ihm, ich melde mich morgen" nicht auflösen. Die ISO-Form steht mit
 * dabei, damit das Modell verlässlich rechnen kann.
 */
/**
 * Zeitstempel in LOKALER Zeit für Prompts („2026-07-16 09:12") — toISOString
 * wäre UTC und verschiebt um Mitternacht sogar das Datum. sv-SE liefert das
 * ISO-ähnliche Format; timeZone ist nur für Tests übersteuerbar.
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
