// Thresholds for decision models (Ollama System One). The models return
// probabilities (noul: P(true) 0..1, score: weighted mean of the level
// indices); from these values on a question counts as "yes". Constants so
// tests, docs and UI cite the same numbers (docs/DECISIONS.md).

/** has_request: the mail asks the account owner for something → have a task title written */
export const HAS_REQUEST_THRESHOLD = 0.5
/** needs_reply: sender expects a personal reply */
export const NEEDS_REPLY_THRESHOLD = 0.6
/** addressed_to_me: the account owner is personally addressed */
export const ADDRESSED_TO_ME_THRESHOLD = 0.5
/** proposes_meeting: the event job only calls extraction from here on */
export const PROPOSES_MEETING_THRESHOLD = 0.5
/** Follow-up radar: sent mail expects a reply */
export const FOLLOWUP_EXPECTS_REPLY_THRESHOLD = 0.5
/** Rule condition "AI": probability from which it matches */
export const RULE_AI_CONDITION_THRESHOLD = 0.6
/** Phishing: score 0 (inconspicuous) … 2 (likely phishing); warning banner from here (= 70 %) */
export const PHISHING_SCORE_MAX = 2
export const PHISHING_SCORE_HIGH = 1.4
/** Spam: score 0 (no spam) … 2 (spam); same scale and threshold as phishing */
export const SPAM_SCORE_MAX = 2
export const SPAM_SCORE_HIGH = 1.4
/** From here a model score (phishing/spam) counts as "suspicious" (= 40 %) */
export const THREAT_SCORE_SUSPICIOUS = 0.8
/**
 * Local rule scores (sum of signal weights, src/main/mail/threat-signals.ts):
 * from SUSPICIOUS a quiet hint, from HIGH a warning — even without a model.
 */
export const HEURISTIC_PHISHING_SUSPICIOUS = 3
export const HEURISTIC_PHISHING_HIGH = 6
export const HEURISTIC_SPAM_SUSPICIOUS = 3
export const HEURISTIC_SPAM_HIGH = 5
/** The text model only writes a summary from this priority on (or for needs_reply) */
export const SUMMARY_MIN_PRIORITY = 3
/** Priority: score 0..4 (five levels) → 1..5 */
export function mapPriorityScore(score: number): number {
  if (!Number.isFinite(score)) return 3
  return Math.min(5, Math.max(1, Math.round(score) + 1))
}

export function isHighPhishing(score: number | null | undefined): boolean {
  return typeof score === 'number' && score >= PHISHING_SCORE_HIGH
}

export type ThreatLevel = 'none' | 'suspicious' | 'high'

/**
 * Combine the model score (0..2, or null without a decision model) and the local rule
 * score into one level. The model alone suffices for "high"; a medium model score
 * is confirmed by local signals; very strong local signals
 * (e.g. homoglyph domain + link deception) warn even without a model.
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
