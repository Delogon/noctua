import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type Database from 'better-sqlite3-multiple-ciphers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runTriage } from '@main/ai/triage'
import { runThreatCheck } from '@main/ai/threat-check'
import { createProfile, setTaskAssignment } from '@main/ai/providers/registry'
import { storeBody, upsertEnvelope } from '@main/mail/ingest'
import {
  ADDRESSED_TO_ME_THRESHOLD,
  HAS_REQUEST_THRESHOLD,
  NEEDS_REPLY_THRESHOLD,
  PHISHING_SCORE_HIGH,
  PROPOSES_MEETING_THRESHOLD,
  SPAM_SCORE_HIGH,
  THREAT_SCORE_SUSPICIOUS
} from '@shared/decision-thresholds'
import { closeTestDb, createAiTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { computeMailSignals } from '@main/mail/threat-signals'
import { phishingLevel, spamLevel, type ThreatLevel } from '@shared/decision-thresholds'
import { EVAL_MAILS, OWNER, signalInput, type EvalMail } from './decision-eval.dataset'

// Decision-model eval: runs the app's real hybrid triage against a real Ollama
// decision model (System One) in both modes, single call vs. one call per
// question, and reports accuracy per question and latency per mail.
//
//   NOCTUA_DECISION_EVAL=1 NOCTUA_OLLAMA_URL=http://127.0.0.1:11434 \
//   NOCTUA_DECISION_MODEL=clef-flash pnpm test:decision-eval
//
// Only the decision part is measured; no text model is configured, so summaries
// stay extractive. Results go to test/local/out/decision-eval-<model>.json.

const enabled = process.env.NOCTUA_DECISION_EVAL === '1'
const localDescribe = enabled ? describe : describe.skip
const BASE_URL = process.env.NOCTUA_OLLAMA_URL ?? 'http://127.0.0.1:11434'
const MODEL = process.env.NOCTUA_DECISION_MODEL ?? 'clef-flash'
const MODES = ['single', 'per-question'] as const
type Mode = (typeof MODES)[number]

interface Row {
  category: string
  needs_reply: number
  addressed_to_me: number
  has_request: number
  proposes_meeting: number
  phishing: number
  spam: number
}

const level = (score: number, high: number): 0 | 1 | 2 =>
  score >= high ? 2 : score >= THREAT_SCORE_SUSPICIOUS ? 1 : 0

function seed(db: Database.Database, mails: EvalMail[]): Map<number, EvalMail> {
  const account = seedAccount(db, { email: OWNER.address })
  db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(OWNER.name, account)
  const inbox = seedFolder(db, account, '\\Inbox')
  const out = new Map<number, EvalMail>()
  mails.forEach((mail, i) => {
    const res = upsertEnvelope(
      db,
      account,
      inbox,
      makeEnvelope({
        uid: i + 1,
        messageId: `<${mail.id}@eval>`,
        subject: mail.subject,
        fromAddr: mail.fromAddr,
        fromName: mail.fromName,
        to: mail.to ?? [],
        cc: mail.cc ?? [],
        replyTo: mail.replyTo ? [{ name: null, address: mail.replyTo }] : [],
        listUnsubscribe: mail.listUnsubscribe ?? false,
        date: Date.UTC(2026, 9, 12, 9, i)
      })
    )!
    storeBody(db, res.messageId, {
      messageId: `<${mail.id}@eval>`,
      inReplyTo: null,
      references: [],
      subject: mail.subject,
      from: { name: mail.fromName, address: mail.fromAddr },
      to: mail.to ?? [],
      cc: mail.cc ?? [],
      replyTo: [],
      date: Date.UTC(2026, 9, 12, 9, i),
      text: mail.text,
      html: mail.html ?? null,
      snippet: mail.text.slice(0, 100),
      attachments: []
    })
    out.set(res.messageId, mail)
  })
  return out
}

interface QuestionStats {
  correct: number
  total: number
  /** for yes/no questions: true positives, false positives, false negatives */
  tp?: number
  fp?: number
  fn?: number
}

function score(results: Array<{ mail: EvalMail; row: Row }>): Record<string, QuestionStats> {
  const stats: Record<string, QuestionStats> = {}
  const add = (name: string, ok: boolean, predicted?: boolean, actual?: boolean): void => {
    const s = (stats[name] ??= { correct: 0, total: 0 })
    s.total += 1
    if (ok) s.correct += 1
    if (predicted !== undefined && actual !== undefined) {
      s.tp = (s.tp ?? 0) + (predicted && actual ? 1 : 0)
      s.fp = (s.fp ?? 0) + (predicted && !actual ? 1 : 0)
      s.fn = (s.fn ?? 0) + (!predicted && actual ? 1 : 0)
    }
  }
  for (const { mail, row } of results) {
    add('category', row.category === mail.labels.category)
    const yesNo: Array<[keyof Row, number, boolean]> = [
      ['needs_reply', NEEDS_REPLY_THRESHOLD, mail.labels.needs_reply],
      ['addressed_to_me', ADDRESSED_TO_ME_THRESHOLD, mail.labels.addressed_to_me],
      ['has_request', HAS_REQUEST_THRESHOLD, mail.labels.has_request],
      ['proposes_meeting', PROPOSES_MEETING_THRESHOLD, mail.labels.proposes_meeting]
    ]
    for (const [name, threshold, actual] of yesNo) {
      const predicted = (row[name] as number) >= threshold
      add(name, predicted === actual, predicted, actual)
    }
    add('phishing', level(row.phishing, PHISHING_SCORE_HIGH) === mail.labels.phishing)
    add('spam', level(row.spam, SPAM_SCORE_HIGH) === mail.labels.spam)
    // Warning shown (≥ suspicious) vs. any phishing/spam label
    add(
      'phishing_flagged',
      row.phishing >= THREAT_SCORE_SUSPICIOUS === mail.labels.phishing > 0,
      row.phishing >= THREAT_SCORE_SUSPICIOUS,
      mail.labels.phishing > 0
    )
  }
  return stats
}

const rank: Record<ThreatLevel, 0 | 1 | 2> = { none: 0, suspicious: 1, high: 2 }

/**
 * Model + local rules as the app combines them: warning banners on legitimate
 * emails, recall of any warning, and emails that "Move likely spam to junk"
 * would move (high AND the model itself ≥ suspicious; no known contacts here).
 */
function securityReport(results: Array<{ mail: EvalMail; row: Row }>): Record<string, unknown> {
  const rows = results.map(({ mail, row }) => {
    const rules = computeMailSignals(signalInput(mail))
    const phishing = rank[phishingLevel(row.phishing, rules.phishingScore)]
    const spam = rank[spamLevel(row.spam, rules.spamScore)]
    const autoJunk =
      (phishing === 2 && row.phishing >= THREAT_SCORE_SUSPICIOUS) ||
      (spam === 2 && row.spam >= THREAT_SCORE_SUSPICIOUS)
    return { mail, phishing, spam, autoJunk }
  })
  const legit = rows.filter(({ mail }) => mail.labels.phishing === 0 && mail.labels.spam === 0)
  const bad = rows.filter(({ mail }) => mail.labels.phishing === 2 || mail.labels.spam === 2)
  return {
    falseBanners: legit.filter((r) => r.phishing > 0 || r.spam > 0).map((r) => r.mail.id),
    falseBannerRate: legit.length
      ? legit.filter((r) => r.phishing > 0 || r.spam > 0).length / legit.length
      : null,
    newsletterBanners: rows
      .filter((r) => ['newsletter', 'promotions'].includes(r.mail.labels.category))
      .filter((r) => r.mail.labels.spam === 0 && r.mail.labels.phishing === 0)
      .filter((r) => r.phishing > 0 || r.spam > 0)
      .map((r) => r.mail.id),
    warnedRecall: bad.length
      ? bad.filter((r) => r.phishing > 0 || r.spam > 0).length / bad.length
      : null,
    autoJunkLegitimate: legit.filter((r) => r.autoJunk).map((r) => r.mail.id),
    autoJunkMoved: rows.filter((r) => r.autoJunk).map((r) => r.mail.id)
  }
}

localDescribe(`decision-model eval (${MODEL} at ${BASE_URL})`, () => {
  let db: Database.Database
  const report: Record<string, unknown> = {
    model: MODEL,
    baseUrl: BASE_URL,
    mails: EVAL_MAILS.length
  }

  beforeAll(() => {
    db = createAiTestDb()
    const profile = createProfile({
      name: 'Ollama (eval)',
      baseUrl: `${BASE_URL.replace(/\/+$/, '')}/v1`,
      apiStyle: 'chat',
      isLocal: true
    })
    setTaskAssignment('decision', profile.id, MODEL)
  })
  afterAll(() => {
    const out = join(
      process.cwd(),
      'test',
      'local',
      'out',
      `decision-eval-${MODEL.replace(/[^\w.-]/g, '_')}.json`
    )
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(report, null, 2))
    console.log(`\n→ ${out}`)
    closeTestDb(db)
  })

  for (const mode of MODES) {
    it(
      `${mode}: triage decisions`,
      async () => {
        db.prepare(
          `INSERT INTO settings (key, value) VALUES ('ai.decisionMode', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(mode)
        db.exec('DELETE FROM accounts')
        const mails = seed(db, EVAL_MAILS)
        const results: Array<{ mail: EvalMail; row: Row }> = []
        const latencies: number[] = []
        for (const [messageId, mail] of mails) {
          const t = performance.now()
          await runTriage(db, messageId)
          latencies.push(performance.now() - t)
          const row = db
            .prepare('SELECT * FROM ai_decisions WHERE message_id = ?')
            .get(messageId) as Row | undefined
          expect(row, `${mail.id}: no decision stored`).toBeDefined()
          results.push({ mail, row: row! })
        }
        const stats = score(results)
        latencies.sort((a, b) => a - b)
        report[mode satisfies Mode] = {
          accuracy: Object.fromEntries(
            Object.entries(stats).map(([name, s]) => [
              name,
              {
                accuracy: Math.round((s.correct / s.total) * 1000) / 1000,
                ...(s.tp !== undefined
                  ? {
                      precision: s.tp + (s.fp ?? 0) ? s.tp / (s.tp + (s.fp ?? 0)) : null,
                      recall: s.tp + (s.fn ?? 0) ? s.tp / (s.tp + (s.fn ?? 0)) : null
                    }
                  : {})
              }
            ])
          ),
          latencyMs: {
            median: Math.round(latencies[Math.floor(latencies.length / 2)]),
            max: Math.round(latencies[latencies.length - 1])
          },
          security: securityReport(results),
          misses: results
            .filter(({ mail, row }) => row.category !== mail.labels.category)
            .map(
              ({ mail, row }) =>
                `${mail.id}: category ${row.category} (expected ${mail.labels.category})`
            )
        }
        console.log(`\n${mode}:`, JSON.stringify(report[mode], null, 2))
      },
      30 * 60_000
    )
  }

  it(
    'standalone security check agrees with the triage mode',
    async () => {
      const rows = db.prepare('SELECT id FROM messages').all() as Array<{ id: number }>
      let checked = 0
      for (const { id } of rows) if (await runThreatCheck(db, id)) checked += 1
      expect(checked).toBe(rows.length)
    },
    30 * 60_000
  )
})
