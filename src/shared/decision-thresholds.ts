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
/** Spam: Score 0 (kein Spam) … 2 (Spam); gleiche Skala und Schwelle wie Phishing */
export const SPAM_SCORE_MAX = 2
export const SPAM_SCORE_HIGH = 1.4
/** Ab hier gilt ein Modell-Score (Phishing/Spam) als „verdächtig" (= 40 %) */
export const THREAT_SCORE_SUSPICIOUS = 0.8
/**
 * Lokale Regel-Scores (Summe der Signalgewichte, src/main/mail/threat-signals.ts):
 * ab SUSPICIOUS ein leiser Hinweis, ab HIGH eine Warnung — auch ohne Modell.
 */
export const HEURISTIC_PHISHING_SUSPICIOUS = 3
export const HEURISTIC_PHISHING_HIGH = 6
export const HEURISTIC_SPAM_SUSPICIOUS = 3
export const HEURISTIC_SPAM_HIGH = 5
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

export type ThreatLevel = 'none' | 'suspicious' | 'high'

/**
 * Modell-Score (0..2 oder null ohne Entscheidungsmodell) und lokaler Regel-Score
 * zu einer Stufe verbinden. Das Modell allein reicht für „high"; ein mittlerer
 * Modell-Score wird durch lokale Signale bestätigt; sehr starke lokale Signale
 * (z. B. Homoglyph-Domain + Link-Täuschung) warnen auch ohne Modell.
 */
export function combineThreatLevel(
  aiScore: number | null,
  heuristic: number,
  heuristicSuspicious: number,
  heuristicHigh: number,
  aiHigh = PHISHING_SCORE_HIGH
): ThreatLevel {
  if (heuristic >= heuristicHigh) return 'high'
  if (aiScore !== null && Number.isFinite(aiScore)) {
    if (aiScore >= aiHigh) return 'high'
    if (aiScore >= THREAT_SCORE_SUSPICIOUS && heuristic >= heuristicSuspicious) return 'high'
    if (aiScore >= THREAT_SCORE_SUSPICIOUS || heuristic >= heuristicSuspicious) return 'suspicious'
    return 'none'
  }
  return heuristic >= heuristicSuspicious ? 'suspicious' : 'none'
}

export function phishingLevel(aiScore: number | null, heuristic: number): ThreatLevel {
  return combineThreatLevel(
    aiScore,
    heuristic,
    HEURISTIC_PHISHING_SUSPICIOUS,
    HEURISTIC_PHISHING_HIGH,
    PHISHING_SCORE_HIGH
  )
}

export function spamLevel(aiScore: number | null, heuristic: number): ThreatLevel {
  return combineThreatLevel(
    aiScore,
    heuristic,
    HEURISTIC_SPAM_SUSPICIOUS,
    HEURISTIC_SPAM_HIGH,
    SPAM_SCORE_HIGH
  )
}
