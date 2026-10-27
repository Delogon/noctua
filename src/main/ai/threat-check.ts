import type Database from 'better-sqlite3-multiple-ciphers'
import {
  phishingLevel,
  spamLevel,
  PHISHING_SCORE_MAX,
  SPAM_SCORE_MAX,
  THREAT_SCORE_SUSPICIOUS,
  type ThreatLevel
} from '@shared/decision-thresholds'
import { htmlToText } from '../mail/parser'
import { computeMailSignals, type MailSignalInput, type MailSignals } from '../mail/threat-signals'
import { getMessageHeaderDetails } from '../db/repos/message-headers'
import { resolveDecision } from './providers/registry'
import { decide, decideEach, isDecisionConfigError, scoreOf } from './providers/systemone'
import {
  THREAT_QUESTIONS,
  decisionMode,
  fullState,
  questionState,
  type StateBlocks
} from './decision-triage'
import { logUsage } from './budget'
import { sanitizeUntrusted, sanitizeUntrustedLine, wrapUntrusted } from './untrusted'

// Spam and phishing detection: local rules (threat-signals) + decision model.
// The model verdict comes from hybrid triage (ai_decisions) or from a
// standalone check with just the two security questions (mail_threat_checks).
// Noctua only moves mail if the user turns on "Automatically filter spam".

export const AUTO_JUNK_SETTING = 'security.autoJunk'

export interface ThreatVerdict {
  level: ThreatLevel
  /** Model score 0..2, null without a decision-model verdict */
  ai: number | null
  /** Sum of the local signal weights */
  heuristic: number
}

export interface MailSecurityReport {
  phishing: ThreatVerdict
  spam: ThreatVerdict
  signals: string[]
  /** Model that gave the verdict (null = local rules only) */
  model: string | null
  /** A standalone model check is possible and still pending */
  canCheck: boolean
  /** The mail is already in the spam folder */
  inJunk: boolean
}

interface ThreatRow {
  id: number
  account_id: number
  subject: string | null
  from_name: string | null
  from_addr: string | null
  reply_to: string | null
  date: number | null
  text_plain: string | null
  html_raw: string | null
  special_use: string | null
  ai_enabled: number | null
}

function loadRow(db: Database.Database, messageId: number): ThreatRow | undefined {
  return db
    .prepare(
      `SELECT m.id, m.account_id, m.subject, m.from_name, m.from_addr, m.reply_to, m.date,
              b.text_plain, b.html_raw, f.special_use, a.ai_enabled
       FROM messages m
       LEFT JOIN message_bodies b ON b.message_id = m.id
       LEFT JOIN folders f ON f.id = m.folder_id
       LEFT JOIN accounts a ON a.id = m.account_id
       WHERE m.id = ?`
    )
    .get(messageId) as ThreatRow | undefined
}

/** All inputs for the local rules from the DB (body, attachments, headers, contact). */
export function loadThreatInput(
  db: Database.Database,
  messageId: number,
  row: Pick<
    ThreatRow,
    'account_id' | 'subject' | 'from_name' | 'from_addr' | 'reply_to' | 'text_plain' | 'html_raw'
  > | null = null
): MailSignalInput | null {
  const r = row ?? loadRow(db, messageId)
  if (!r) return null
  const attachments = db
    .prepare('SELECT filename, mime_type FROM attachments WHERE message_id = ? LIMIT 50')
    .all(messageId) as Array<{ filename: string | null; mime_type: string | null }>
  const headers = getMessageHeaderDetails(db, messageId)
  const auth = headers?.technicalAvailable
    ? {
        spf: headers.authentication.spf,
        dkim: headers.authentication.dkim,
        dmarc: headers.authentication.dmarc
      }
    : null
  const serverSpamFlag = (headers?.spamHeaders ?? []).some(
    (h) =>
      (/^x-spam-flag$/i.test(h.name) && /^\s*yes/i.test(h.value)) ||
      (/^x-spam-status$/i.test(h.name) && /^\s*yes\b/i.test(h.value))
  )
  const known = db
    .prepare('SELECT sent_count FROM contact_stats WHERE account_id = ? AND addr = ?')
    .get(r.account_id, r.from_addr ?? '') as { sent_count: number } | undefined
  return {
    fromName: r.from_name,
    fromAddr: r.from_addr,
    replyToJson: r.reply_to,
    subject: r.subject,
    html: r.html_raw,
    text: r.text_plain?.trim() || htmlToText(r.html_raw ?? ''),
    attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mime_type })),
    auth,
    serverSpamFlag,
    knownSender: (known?.sent_count ?? 0) > 0
  }
}

/** Signal lines as a block for the decision model's state text. */
export function signalStateBlock(signals: MailSignals): string {
  return signals.lines.length > 0
    ? `\nSecurity check (computed locally before the analysis):\n${signals.lines.map((l) => `- ${sanitizeUntrustedLine(l, 240)}`).join('\n')}`
    : ''
}

function storedAiScores(
  db: Database.Database,
  messageId: number
): { phishing: number | null; spam: number | null; model: string } | null {
  const triage = db
    .prepare('SELECT model, phishing, spam FROM ai_decisions WHERE message_id = ?')
    .get(messageId) as { model: string; phishing: number | null; spam: number | null } | undefined
  const check = db
    .prepare('SELECT model, phishing, spam FROM mail_threat_checks WHERE message_id = ?')
    .get(messageId) as { model: string; phishing: number; spam: number } | undefined
  // Standalone check fills triage gaps (e.g. spam for legacy decisions)
  if (triage && triage.phishing !== null) {
    return {
      model: triage.model,
      phishing: triage.phishing,
      spam: triage.spam ?? check?.spam ?? null
    }
  }
  return check ?? null
}

/** Security report of a mail: local rules computed now + stored model verdict. */
export function getMailSecurity(
  db: Database.Database,
  messageId: number
): MailSecurityReport | null {
  const row = loadRow(db, messageId)
  if (!row) return null
  const input = loadThreatInput(db, messageId, row)!
  const signals = computeMailSignals(input)
  const ai = storedAiScores(db, messageId)
  const aiPhishing = ai?.phishing ?? null
  const aiSpam = ai?.spam ?? null
  return {
    phishing: {
      level: phishingLevel(aiPhishing, signals.phishingScore),
      ai: aiPhishing,
      heuristic: signals.phishingScore
    },
    spam: {
      level: spamLevel(aiSpam, signals.spamScore),
      ai: aiSpam,
      heuristic: signals.spamScore
    },
    signals: signals.codes.slice(0, 30),
    model: ai?.model ?? null,
    canCheck:
      (aiPhishing === null || aiSpam === null) &&
      row.ai_enabled !== 0 &&
      (row.text_plain !== null || row.html_raw !== null) &&
      resolveDecision() !== null,
    inJunk: row.special_use === '\\Junk'
  }
}

/**
 * Standalone spam/phishing check with the decision model (System One):
 * one call with two score questions, local signals as context in the state. For mails
 * that never went through hybrid triage. Returns null without a decision model,
 * without a body, with AI disabled for the account, or on configuration errors.
 */
export async function runThreatCheck(
  db: Database.Database,
  messageId: number
): Promise<{ phishing: number; spam: number; model: string } | null> {
  const cfg = resolveDecision()
  if (!cfg) return null
  const row = loadRow(db, messageId)
  if (!row || row.ai_enabled === 0) return null
  if (row.text_plain === null && row.html_raw === null) return null
  const input = loadThreatInput(db, messageId, row)!
  const signals = computeMailSignals(input)
  const body = sanitizeUntrusted(input.text ?? '', 6000)
  let replyTo: string | null = null
  try {
    const addresses = (JSON.parse(row.reply_to ?? '[]') as Array<{ address?: string }>)
      .map((r) => r.address)
      .filter((a): a is string => !!a)
    if (addresses.length > 0)
      replyTo = `Reply-To: ${sanitizeUntrustedLine(addresses.join(', '), 300)}`
  } catch {
    // broken JSON: no Reply-To line
  }
  const security = signalStateBlock(signals).trim()
  const blocks: StateBlocks = {
    header: [
      `From: ${sanitizeUntrustedLine(row.from_name, 120)} <${sanitizeUntrustedLine(row.from_addr ?? 'unknown', 200)}>`,
      `Subject: ${sanitizeUntrustedLine(row.subject, 300) || '(no subject)'}`
    ].join('\n'),
    replyTo,
    recipient: null,
    signals: input.knownSender
      ? 'Signals: The recipient has written to this sender before (known contact)'
      : null,
    security: security || null,
    body: `Content:\n${wrapUntrusted('MAIL', body || '(no text content)')}`,
    bodyShort: `Content (excerpt):\n${wrapUntrusted('MAIL', body.slice(0, 2000) || '(no text content)')}`
  }
  const params = { baseUrl: cfg.profile.baseUrl, apiKey: cfg.apiKey, model: cfg.model }

  let result: {
    answers: Awaited<ReturnType<typeof decide>>['answers']
    usage: { inputTokens: number; outputTokens: number }
  }
  try {
    result =
      decisionMode() === 'single'
        ? await decide({ ...params, state: fullState(blocks), questions: THREAT_QUESTIONS })
        : await decideEach(params, THREAT_QUESTIONS, (name) => questionState(name, blocks))
  } catch (error) {
    if (isDecisionConfigError(error)) {
      console.warn('[security] decision model unusable:', error)
      return null
    }
    throw error
  }
  logUsage(db, cfg.model, result.usage.inputTokens, result.usage.outputTokens, 0)
  const clamp = (n: number, max: number): number => Math.min(max, Math.max(0, n))
  const phishing = clamp(scoreOf(result.answers, 'phishing')?.score ?? 0, PHISHING_SCORE_MAX)
  const spam = clamp(scoreOf(result.answers, 'spam')?.score ?? 0, SPAM_SCORE_MAX)
  db.prepare(
    `INSERT OR REPLACE INTO mail_threat_checks (message_id, model, phishing, spam, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(messageId, cfg.model, phishing, spam, Date.now())
  return { phishing, spam, model: cfg.model }
}

type JunkExecutor = (messageIds: number[]) => void
let moveToJunk: JunkExecutor = () => {}
/** Set by bootstrap (syncEngine.applyAction(..., 'spam')) — avoids import cycles. */
export function setJunkExecutor(fn: JunkExecutor): void {
  moveToJunk = fn
}

/**
 * After triage: with "Automatically filter spam" on, a mail lands
 * in the spam folder if spam OR phishing is "high" AND the model itself says
 * at least "suspicious" (local rules alone never move), it is in the inbox and the
 * sender is not a known contact. Returns true if it was moved.
 */
export function maybeAutoJunk(db: Database.Database, messageId: number): boolean {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(AUTO_JUNK_SETTING) as
    { value: string } | undefined
  if (setting?.value !== '1') return false
  const row = loadRow(db, messageId)
  if (!row || row.special_use !== '\\Inbox') return false
  const report = getMailSecurity(db, messageId)
  if (!report || report.model === null) return false
  const known = db
    .prepare('SELECT sent_count FROM contact_stats WHERE account_id = ? AND addr = ?')
    .get(row.account_id, row.from_addr ?? '') as { sent_count: number } | undefined
  if ((known?.sent_count ?? 0) > 0) return false
  // "high" AND the model itself at least "suspicious" – strong rules alone never move
  const confirmed = (v: ThreatVerdict): boolean =>
    v.level === 'high' && v.ai !== null && v.ai >= THREAT_SCORE_SUSPICIOUS
  if (!confirmed(report.spam) && !confirmed(report.phishing)) return false
  moveToJunk([messageId])
  return true
}
