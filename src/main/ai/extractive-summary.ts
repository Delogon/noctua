/**
 * Extraktive Zusammenfassung ohne KI (Hybrid-Triage): der erste sinnvolle Satz
 * des Textes, bereinigt, höchstens 140 Zeichen. Fällt auf den Betreff zurück.
 * Gilt für Mails, bei denen das Entscheidungsmodell „unwichtig" sagt – ein
 * Textmodell wäre dafür Verschwendung.
 */

const MAX_LEN = 140

const GREETING =
  /^(?:hallo|hi|hey|moin|servus|guten (?:morgen|tag|abend)|liebe[rs]?|sehr geehrte[rs]?|hello|dear|good (?:morning|afternoon|evening))\b[^.!?\n]{0,60}[,!:]?\s*$/i
const NOISE_LINE =
  /^(?:--+|__+|==+|\*\*+|von:|from:|an:|to:|cc:|datum:|date:|betreff:|subject:|gesendet:|sent:|view (?:this )?(?:email )?in (?:your )?browser|im browser (?:ansehen|anzeigen)|unsubscribe|abmelden|diese e-?mail wurde)/i

function clean(line: string): string {
  return line
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(new RegExp('[\\u200b-\\u200f\\u2060\\ufeff\\u00ad]', 'g'), '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shorten(text: string): string {
  if (text.length <= MAX_LEN) return text
  const cut = text.slice(0, MAX_LEN - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 80 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, '')}…`
}

export function extractiveSummary(subject: string | null, body: string | null): string {
  const fallback = shorten(clean(subject ?? '')) || 'Kein Textinhalt'
  const lines = (body ?? '').replace(/\r\n?/g, '\n').split('\n')
  for (const raw of lines) {
    // Zitate und Signaturtrenner beenden die Suche nicht, werden aber übersprungen
    if (/^\s*>/.test(raw)) continue
    if (/^\s*--\s*$/.test(raw)) break
    const line = clean(raw)
    if (line.length < 20) continue
    if (GREETING.test(line) || NOISE_LINE.test(line)) continue
    if (!/\p{L}{3,}/u.test(line)) continue
    // erster Satz der Zeile (Punkt/!/? gefolgt von Leerraum und Großbuchstabe/Ziffer)
    const sentence = line.split(/(?<=[.!?])\s+(?=[\p{Lu}\d„"])/u)[0]
    const picked = sentence.length >= 20 ? sentence : line
    return shorten(picked)
  }
  return fallback
}
