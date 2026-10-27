import { describe, expect, it } from 'vitest'
import { computeMailSignals } from '@main/mail/threat-signals'
import { phishingLevel, spamLevel, type ThreatLevel } from '@shared/decision-thresholds'
import { EVAL_MAILS, signalInput, type EvalMail } from '../local/decision-eval.dataset'

// Local rules only (no decision model) on the labelled eval set. Guards the
// false-positive side: a warning banner on a legitimate email costs trust.
// The model side runs with `pnpm test:decision-eval` against a real Ollama.

const rank: Record<ThreatLevel, 0 | 1 | 2> = { none: 0, suspicious: 1, high: 2 }

function rulesLevels(mail: EvalMail): { phishing: 0 | 1 | 2; spam: 0 | 1 | 2 } {
  const signals = computeMailSignals(signalInput(mail))
  return {
    phishing: rank[phishingLevel(null, signals.phishingScore)],
    spam: rank[spamLevel(null, signals.spamScore)]
  }
}

describe('local threat rules on the labelled eval set', () => {
  const results = EVAL_MAILS.map((mail) => ({ mail, rules: rulesLevels(mail) }))

  it('never warn about legitimate emails', () => {
    const falseAlarms = results
      .filter(({ mail }) => mail.labels.phishing === 0 && mail.labels.spam === 0)
      .filter(({ rules }) => rules.phishing > 0 || rules.spam > 0)
      .map(({ mail }) => mail.id)
    expect(falseAlarms).toEqual([])
  })

  it('flag most phishing and spam without a model', () => {
    const recall = (kind: 'phishing' | 'spam'): { flagged: number; total: number } => {
      const positives = results.filter(({ mail }) => mail.labels[kind] === 2)
      return {
        // Any warning banner counts: a prize scam warned as spam is still warned
        flagged: positives.filter(({ rules }) => rules.phishing > 0 || rules.spam > 0).length,
        total: positives.length
      }
    }
    // Phishing with technical or textual traces; the rules cannot judge
    // content-only spam (cold SEO outreach), that is the model's part.
    expect(recall('phishing')).toEqual({ flagged: 5, total: 5 })
    expect(recall('spam')).toMatchObject({ total: 6 })
    expect(recall('spam').flagged).toBeGreaterThanOrEqual(5)
  })
})
