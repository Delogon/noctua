// Schwellen für Entscheidungsmodelle (Ollama System One). Die Modelle liefern
// Wahrscheinlichkeiten (noul: P(true) 0..1, score: gewichteter Mittelwert der
// Stufenindizes); ab diesen Werten gilt eine Frage als „ja". Konstanten, damit
// Tests, Docs und UI dieselben Zahlen nennen (docs/DECISIONS.md).

/** has_request: bittet die Mail den Kontoinhaber um etwas → Aufgaben-Titel schreiben lassen */
export const HAS_REQUEST_THRESHOLD = 0.5
/** needs_reply: Absender erwartet eine persönliche Antwort */
export const NEEDS_REPLY_THRESHOLD = 0.6
/** addressed_to_me: der Kontoinhaber ist persönlich gemeint */
export const ADDRESSED_TO_ME_THRESHOLD = 0.5
/** proposes_meeting: Termin-Job ruft die Extraktion nur ab hier auf */
export const PROPOSES_MEETING_THRESHOLD = 0.5
/** Follow-up-Radar: gesendete Mail erwartet eine Antwort */
export const FOLLOWUP_EXPECTS_REPLY_THRESHOLD = 0.5
/** Regel-Bedingung „KI": Wahrscheinlichkeit, ab der sie zutrifft */
export const RULE_AI_CONDITION_THRESHOLD = 0.6
/** Phishing: Score 0 (unauffällig) … 2 (wahrscheinlich Phishing); Warnbanner ab hier (= 70 %) */
export const PHISHING_SCORE_MAX = 2
export const PHISHING_SCORE_HIGH = 1.4
/** Zusammenfassung wird nur ab dieser Priorität (oder bei needs_reply) vom Textmodell geschrieben */
export const SUMMARY_MIN_PRIORITY = 3
/** Priorität: score 0..4 (fünf Stufen) → 1..5 */
export function mapPriorityScore(score: number): number {
  if (!Number.isFinite(score)) return 3
  return Math.min(5, Math.max(1, Math.round(score) + 1))
}

export function isHighPhishing(score: number | null | undefined): boolean {
  return typeof score === 'number' && score >= PHISHING_SCORE_HIGH
}
