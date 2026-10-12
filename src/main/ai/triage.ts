import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { htmlToText } from '../mail/parser'
import { getTriageProvider } from './openrouter'
import {
  budgetBlocks,
  resolveDecision,
  resolveTask,
  type ResolvedDecision
} from './providers/registry'
import type { ResolvedTask } from './providers/types'
import { decide, isDecisionConfigError } from './providers/systemone'
import {
  DECISION_STATE_NOTE,
  TRIAGE_QUESTIONS,
  buildHybridWritePrompt,
  hybridWriteSchema,
  interpretTriageAnswers,
  writeGates,
  type HybridWrite
} from './decision-triage'
import { computeMailSignals } from '../mail/threat-signals'
import { loadThreatInput, signalStateBlock } from './threat-check'
import { extractiveSummary } from './extractive-summary'
import { NEEDS_REPLY_THRESHOLD, ADDRESSED_TO_ME_THRESHOLD } from '@shared/decision-thresholds'
import { AppleGuardrailError, appleFmStatus, appleGate, appleTriage } from './apple-fm'
import { logUsage } from './budget'
import { createTasksFromTriage, isUserAuthoredMail } from '../db/repos/tasks'
import { isForwardWithoutRequest, textBeforeForwardedMessage } from '../mail/forwarded'
import { recipientPlacement, salutationTarget } from './addressee'
import { localStamp } from './prompt-date'
import { outputLanguage, outputLanguageName, type OutputLanguage } from './output-language'
import {
  UNTRUSTED_SYSTEM_NOTE,
  sanitizeUntrusted,
  sanitizeUntrustedLine,
  wrapUntrusted
} from './untrusted'

// v6: mail content in delimiters + "data, not instructions" (SEC-15). The output format
// is unchanged; existing annotations remain valid. On startup the bump only resets
// permanently failed jobs (requeueOnPromptChange) — completed jobs stay
// locked via UNIQUE(message_id, kind); there is NO re-triage of the 30-day window.
export const PROMPT_VERSION = 6

export const AI_CATEGORIES = [
  'personal',
  'work',
  'newsletter',
  'promotions',
  'notifications',
  'transactional',
  'other'
] as const

// Action items as an object with optional deadline; v1 strings are tolerated.
const actionItemSchema = z.union([
  z.object({
    title: z.string().max(200),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null)
  }),
  z
    .string()
    .max(200)
    .transform((title) => ({ title, due: null as string | null }))
])

const triageResultSchema = z.object({
  category: z.enum(AI_CATEGORIES),
  priority: z.number().int().min(1).max(5),
  summary: z.string().max(300),
  action_items: z.array(actionItemSchema).max(5).default([]),
  needs_reply: z.boolean().default(false),
  // Backward compatible: legacy answers (prompt v4) without the field count as addressed.
  addressed_to_me: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.5)
})

/**
 * Task gate for the on-device model (M88): a single narrow question. The
 * wording is eval-driven (scripts/apple-triage-eval) — re-measure changes
 * there, don't reword by gut feeling.
 */
export const APPLE_GATE_PROMPT = `You check EXACTLY ONE question for an email client:
Does a single human in this email ask the account owner named in the RECIPIENT block to do
something PERSONALLY, is there a real deadline for THEM (pay, submit a form, book), or is the
sender clearly waiting for a personal reply from the account owner (e.g. a direct question to them)?

Answer NO for: newsletters, advertising (even with a deadline such as "only until Sunday"),
service notifications, security notices and codes, reports, automatic reminders, mass mailings
with a group salutation, emails whose salutation names a different person, and pure information
without a request.
When in doubt: NO.`

function systemPrompt(language: OutputLanguage = outputLanguage()): string {
  return `You are the triage classifier of a personal email client.
${UNTRUSTED_SYSTEM_NOTE}
Analyse the email and reply ONLY with a JSON object, exactly in this form:
{
  "category": "personal" | "work" | "newsletter" | "promotions" | "notifications" | "transactional" | "other",
  "priority": 1-5,
  "summary": "one line in ${outputLanguageName(language)}, max. 140 characters, factual",
  "action_items": [{"title": "concrete task for the recipient, in ${outputLanguageName(language)}", "due": "YYYY-MM-DD or null"}],
  "needs_reply": true|false,
  "addressed_to_me": true|false,
  "confidence": 0.0-1.0
}

addressed_to_me: true ONLY if the account owner named in the RECIPIENT block is meant personally
(addressed by name, addressed directly, or clearly the person the request is for). false if the
salutation or request is aimed at someone else (e.g. a salutation with another name, a mailing-list
email meant for someone else, an email sent for information only).
action_items ONLY if a human asks the named account owner personally to do something, or there is
a real deadline for THEM (pay, reply, book, cancel, prepare). If the salutation or request is aimed
at another person: NO action_items and needs_reply=false.
NEVER create action_items from: sign-in notifications ("new sign-in", "security alert", 2FA or
verification codes), password emails, system notifications, newsletters, advertising or pure
information — even if the text contains calls to action such as "check/change your password";
such standard security notices are NOT tasks for the user.
Set due only if a concrete deadline is recognisable (convert it to an absolute date relative to the
email's date), otherwise null.

Categories:
- personal: real people, private communication
- work: professional communication from real people
- newsletter: editorial mailings, digests
- promotions: advertising, offers, marketing — including product announcements and feature
  marketing from services the recipient already uses
- notifications: automatic notifications from services (social, tools, calendar)
- transactional: invoices, orders, shipping, security codes, contracts
- other: none of these

Priority: 5 = urgent/important for the recipient (a human is waiting for a reply, hard deadline,
security incident), 4 = service warnings that lead to restrictions if ignored (storage full, payment
failed, account suspension pending), 3 = normal, 1 = ignorable (mass advertising, small-talk
duplicates).
needs_reply only for real people who expect a reply.
summary states the core (who wants what), no filler phrases.`
}

interface TriageRow {
  id: number
  account_id: number
  subject: string | null
  from_name: string | null
  from_addr: string | null
  to_json: string | null
  cc_json: string | null
  reply_to: string | null
  account_email: string | null
  account_display_name: string | null
  account_name: string | null
  date: number | null
  internal_date: number | null
  account_created_at: number | null
  list_unsubscribe: number
  text_plain: string | null
  html_raw: string | null
  folder_special_use: string | null
}

function buildUserPrompt(
  db: Database.Database,
  row: TriageRow,
  extraSignals: string[] = []
): string {
  const fullBodyText = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
  const bodyText = sanitizeUntrusted(textBeforeForwardedMessage(row.subject, fullBodyText), 6000)
  const stats = db
    .prepare('SELECT sent_count FROM contact_stats WHERE account_id = ? AND addr = ?')
    .get(row.account_id, row.from_addr ?? '') as { sent_count: number } | undefined
  const previous = db
    .prepare(
      `SELECT coalesce(a.user_override_category, a.category) cat, count(*) n
       FROM ai_annotations a JOIN messages m ON m.id = a.message_id
       WHERE m.account_id = ? AND m.from_addr = ? GROUP BY cat ORDER BY n DESC LIMIT 1`
    )
    .get(row.account_id, row.from_addr ?? '') as { cat: string } | undefined

  const signals = [
    row.list_unsubscribe ? 'List-Unsubscribe header present (bulk mail signal)' : null,
    stats && stats.sent_count > 0
      ? `The recipient has written to this sender ${stats.sent_count} times before (known contact)`
      : null,
    previous ? `Earlier emails from this sender were classified as "${previous.cat}"` : null,
    ...extraSignals
  ].filter(Boolean)

  // RECIPIENT block: who is the account owner, where are they in the envelope,
  // whom does the salutation address? Basis for addressed_to_me.
  const ownerName = row.account_display_name?.trim() || row.account_name?.trim() || null
  const placement = recipientPlacement(row.account_email, row.to_json, row.cc_json)
  const placementLabel = {
    to: 'is in To',
    cc: 'is only in CC',
    absent: 'is neither in To nor CC (mailing list / Bcc delivery)'
  }[placement]
  const salutation = salutationTarget(bodyText)
  const salutationLabel =
    salutation.kind === 'named'
      ? `names: ${salutation.names.join(', ')}`
      : salutation.kind === 'group'
        ? 'group salutation (e.g. "Hello everyone")'
        : 'no recognisable salutation'

  return [
    `From: ${sanitizeUntrustedLine(row.from_name, 120)} <${sanitizeUntrustedLine(row.from_addr ?? 'unknown', 200)}>`,
    `Subject: ${sanitizeUntrustedLine(row.subject, 300) || '(no subject)'}`,
    `Date: ${row.date ? localStamp(row.date) : 'unknown'}`,
    `RECIPIENT (account owner): ${ownerName ? `${ownerName} ` : ''}<${row.account_email ?? 'unknown'}>; ${placementLabel}; salutation of the email: ${salutationLabel}`,
    signals.length > 0 ? `Signals: ${signals.join('; ')}` : null,
    '',
    'Content:',
    wrapUntrusted('MAIL', bodyText || '(no text content)')
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export type TriageOutcome = 'done' | 'skipped-no-client' | 'skipped-missing'

type TriageVerdict = z.infer<typeof triageResultSchema>

/**
 * Bring the on-device model's raw result into schema form: guided
 * generation guarantees the structure, but we clamp value ranges (category enum,
 * priority clamp, date format) deterministically here.
 */
export function sanitizeAppleVerdict(raw: unknown): TriageVerdict {
  const value = (raw ?? {}) as Record<string, unknown>
  const category = (AI_CATEGORIES as readonly string[]).includes(String(value.category))
    ? String(value.category)
    : 'other'
  const rawPriority = Number(value.priority)
  const priority = Number.isFinite(rawPriority)
    ? Math.min(5, Math.max(1, Math.round(rawPriority)))
    : 3
  const items = Array.isArray(value.action_items) ? value.action_items.slice(0, 5) : []
  const actionItems = items
    .map((item) => {
      const it = (item ?? {}) as Record<string, unknown>
      const title = String(it.title ?? '').slice(0, 200)
      const due = typeof it.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.due) ? it.due : null
      return { title, due }
    })
    .filter((item) => item.title.trim().length > 0)
  const confidence = Number(value.confidence)
  return triageResultSchema.parse({
    category,
    priority,
    summary: String(value.summary ?? '').slice(0, 300),
    action_items: actionItems,
    needs_reply: value.needs_reply === true,
    addressed_to_me: value.addressed_to_me !== false,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5
  })
}

/** Neutral verdict when Apple's guardrails reject the mail content —
 *  the mail stays usable (category other, no tasks, confidence 0). */
function neutralVerdict(subject: string | null): TriageVerdict {
  return triageResultSchema.parse({
    category: 'other',
    priority: 3,
    summary: (subject?.trim() || 'Inhalt nicht analysiert').slice(0, 140),
    action_items: [],
    needs_reply: false,
    addressed_to_me: true,
    confidence: 0
  })
}

/** Classifies a message and writes the annotation. Throws on API errors. */
export async function runTriage(db: Database.Database, messageId: number): Promise<TriageOutcome> {
  const provider = getTriageProvider()
  // Task → profile: under Local only or without key/model, triage pauses
  // as with "no key" (job stays queued, no burned attempt)
  const resolved = provider === 'openrouter' ? resolveTask('triage') : null
  // Decision model (System One): decides first, the text model only writes when needed.
  // Also runs without a usable text model (then extractive summary, no task titles).
  const decisionCfg = provider === 'openrouter' ? resolveDecision() : null
  if (provider === 'openrouter' && !resolved && !decisionCfg) return 'skipped-no-client'

  const row = db
    .prepare(
      `SELECT m.id, m.account_id, m.subject, m.from_name, m.from_addr, m.to_json, m.cc_json,
              m.reply_to, m.date, m.internal_date, m.list_unsubscribe, b.text_plain, b.html_raw,
              a.email account_email, a.display_name account_display_name, a.account_name,
              a.created_at account_created_at,
              f.special_use folder_special_use
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
       LEFT JOIN accounts a ON a.id = m.account_id
       LEFT JOIN folders f ON f.id = m.folder_id
       WHERE m.id = ?`
    )
    .get(messageId) as TriageRow | undefined
  if (!row) return 'skipped-missing'

  if (decisionCfg) {
    const outcome = await runHybridTriage(db, row, messageId, decisionCfg, resolved)
    if (outcome) return outcome
    // Decision-model configuration error: classic triage takes over
  }

  const userPrompt = buildUserPrompt(db, row)

  if (provider === 'apple') {
    const status = await appleFmStatus()
    // Model loading/it's off: put the job back without burning an attempt (like "no key")
    if (status.state !== 'available') return 'skipped-no-client'
    // Two-stage (M88): first the narrow gate question ("is a human asking the
    // account owner personally?"), then the overall verdict. The 3B model
    // answers the isolated question much more reliably than it
    // extracts tasks in the overall verdict — only with gate=yes may
    // action_items and needs_reply create tasks.
    const gateOpen = await appleGate(APPLE_GATE_PROMPT, userPrompt)
    let parsed: TriageVerdict
    try {
      parsed = sanitizeAppleVerdict(await appleTriage(systemPrompt(), userPrompt))
    } catch (error) {
      if (!(error instanceof AppleGuardrailError)) throw error
      parsed = neutralVerdict(row.subject)
    }
    if (!gateOpen) parsed = { ...parsed, action_items: [], needs_reply: false }
    logUsage(db, 'apple/on-device', 0, 0, 0)
    return persistVerdict(db, row, messageId, parsed, 'apple/on-device', {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0
    })
  }

  if (!resolved) return 'skipped-no-client'
  const { client, model } = resolved

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.complete({
      model,
      messages: [
        { role: 'system', content: systemPrompt() },
        {
          role: 'user',
          content:
            attempt === 0
              ? userPrompt
              : `${userPrompt}\n\nYour last answer was invalid (${lastError}). Reply exactly according to the schema.`
        }
      ],
      json: true,
      temperature: 0.1,
      // Reasoning models (e.g. DeepSeek v4 Flash) spend max_tokens
      // on thinking tokens too — 500 cut off answers (finish=length)
      // and burned retries. The output itself stays ~150 tokens.
      maxTokens: 1200
    })

    const { inputTokens, outputTokens, costUsd } = result.usage
    logUsage(db, model, inputTokens, outputTokens, costUsd)

    const raw = result.text
    let parsed: z.infer<typeof triageResultSchema> | null = null
    try {
      parsed = triageResultSchema.parse(JSON.parse(raw))
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : 'parse error'
      continue
    }

    return persistVerdict(db, row, messageId, parsed, model, {
      inputTokens,
      outputTokens,
      costUsd
    })
  }

  throw new Error(
    `Ungültige Antwort des Modells (Vorsortierung) nach erneutem Versuch: ${lastError}`
  )
}

/** First {...} structure of a text model output (tolerate code fences/surrounding text). */
function parseHybridWrite(raw: string): HybridWrite {
  const match = raw.match(/\{[\s\S]*\}/)
  return hybridWriteSchema.parse(JSON.parse(match?.[0] ?? raw))
}

/**
 * Hybrid triage: ONE System One call (category, priority, needs_reply,
 * addressed_to_me, has_request, proposes_meeting, phishing); the text model
 * only writes task titles (has_request) and the one-liner (priority ≥ 3
 * or needs_reply). Everything else gets an extractive summary.
 * Returns null if the decision model is misconfigured
 * (404/not a decision model) – then classic triage runs.
 */
async function runHybridTriage(
  db: Database.Database,
  row: TriageRow,
  messageId: number,
  cfg: ResolvedDecision,
  generative: ResolvedTask | null
): Promise<TriageOutcome | null> {
  const fullBodyText = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
  const bodyText = textBeforeForwardedMessage(row.subject, fullBodyText)
  const signals = computeMailSignals(loadThreatInput(db, messageId, row)!)
  const userPrompt = buildUserPrompt(db, row)
  const state = [DECISION_STATE_NOTE, '', userPrompt, signalStateBlock(signals)].join('\n')

  let result: Awaited<ReturnType<typeof decide>>
  try {
    result = await decide({
      baseUrl: cfg.profile.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      state,
      questions: TRIAGE_QUESTIONS
    })
  } catch (error) {
    if (isDecisionConfigError(error)) {
      console.warn('[ai] Entscheidungsmodell unbrauchbar, klassische Triage:', error)
      return null
    }
    throw error
  }
  logUsage(db, cfg.model, result.usage.inputTokens, result.usage.outputTokens, 0)
  const decision = interpretTriageAnswers(result.answers)

  const userAuthored = isUserAuthoredMail(db, row.from_addr, row.folder_special_use)
  const suppressRequests = userAuthored || isForwardWithoutRequest(row.subject, fullBodyText)
  const gates = writeGates(decision, suppressRequests)

  let written: HybridWrite | null = null
  let genUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  const canWrite = generative !== null && !budgetBlocks(db, generative)
  if (canWrite && (gates.tasks || gates.summary)) {
    let lastError = ''
    for (let attempt = 0; attempt < 2 && !written; attempt++) {
      const reply = await generative.client.complete({
        model: generative.model,
        messages: [
          { role: 'system', content: buildHybridWritePrompt(gates, decision) },
          {
            role: 'user',
            content:
              attempt === 0
                ? userPrompt
                : `${userPrompt}\n\nYour last answer was invalid (${lastError}). Reply exactly according to the schema.`
          }
        ],
        json: true,
        temperature: 0.1,
        maxTokens: 1200
      })
      genUsage = {
        inputTokens: genUsage.inputTokens + reply.usage.inputTokens,
        outputTokens: genUsage.outputTokens + reply.usage.outputTokens,
        costUsd: genUsage.costUsd + reply.usage.costUsd
      }
      logUsage(
        db,
        generative.model,
        reply.usage.inputTokens,
        reply.usage.outputTokens,
        reply.usage.costUsd
      )
      try {
        written = parseHybridWrite(reply.text)
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 300) : 'parse error'
      }
    }
    // Invalid twice: don't fail – the decision stands, text becomes extractive
  }

  const summary =
    gates.summary && written?.summary?.trim()
      ? written.summary.trim()
      : extractiveSummary(row.subject, bodyText)
  const verdict: TriageVerdict = {
    category: decision.category,
    priority: decision.priority,
    summary,
    action_items: gates.tasks && written ? written.action_items : [],
    needs_reply: decision.needsReply >= NEEDS_REPLY_THRESHOLD,
    addressed_to_me: decision.addressedToMe >= ADDRESSED_TO_ME_THRESHOLD,
    confidence: decision.confidence
  }
  const model = written && generative ? `${cfg.model}+${generative.model}` : cfg.model
  persistVerdict(db, row, messageId, verdict, model, {
    inputTokens: result.usage.inputTokens + genUsage.inputTokens,
    outputTokens: result.usage.outputTokens + genUsage.outputTokens,
    costUsd: genUsage.costUsd
  })
  db.prepare(
    `INSERT OR REPLACE INTO ai_decisions (message_id, model, category, category_confidence,
       priority_score, needs_reply, addressed_to_me, has_request, proposes_meeting, phishing,
       spam, phishing_signals_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    messageId,
    cfg.model,
    decision.category,
    decision.confidence,
    decision.priorityScore,
    decision.needsReply,
    decision.addressedToMe,
    decision.hasRequest,
    decision.proposesMeeting,
    decision.phishing,
    decision.spam,
    JSON.stringify(signals.codes),
    Date.now()
  )
  return 'done'
}

/** Deterministic post-processing + persistence — the same for both providers:
 *  rules beat model subtleties, then annotation upsert and task derivation. */
function persistVerdict(
  db: Database.Database,
  row: TriageRow,
  messageId: number,
  parsed: TriageVerdict,
  model: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number },
  options: { createTasks?: boolean } = {}
): TriageOutcome {
  let priority = parsed.priority
  const stats = db
    .prepare('SELECT sent_count FROM contact_stats WHERE account_id = ? AND addr = ?')
    .get(row.account_id, row.from_addr ?? '') as { sent_count: number } | undefined
  if (stats && stats.sent_count > 0) priority = Math.min(5, priority + 1)
  if (row.list_unsubscribe) priority = Math.max(1, priority - 1)

  const userAuthored = isUserAuthoredMail(db, row.from_addr, row.folder_special_use)
  const fullBodyText = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
  const forwardWithoutRequest = isForwardWithoutRequest(row.subject, fullBodyText)
  const suppressRequests = userAuthored || forwardWithoutRequest
  const actionItems = suppressRequests ? [] : parsed.action_items
  const needsReply = suppressRequests ? false : parsed.needs_reply

  db.prepare(
    `INSERT INTO ai_annotations (message_id, category, priority, summary, action_items_json,
       needs_reply, addressed_to_me, confidence, model, prompt_version, input_tokens,
       output_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       category = excluded.category, priority = excluded.priority, summary = excluded.summary,
       action_items_json = excluded.action_items_json, needs_reply = excluded.needs_reply,
       addressed_to_me = excluded.addressed_to_me,
       confidence = excluded.confidence, model = excluded.model,
       prompt_version = excluded.prompt_version, input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens, cost_usd = excluded.cost_usd,
       created_at = excluded.created_at`
    // user_override_category is left untouched by the upsert.
  ).run(
    messageId,
    parsed.category,
    priority,
    parsed.summary.slice(0, 200),
    JSON.stringify(actionItems),
    needsReply ? 1 : 0,
    parsed.addressed_to_me ? 1 : 0,
    parsed.confidence,
    model,
    PROMPT_VERSION,
    usage.inputTokens,
    usage.outputTokens,
    usage.costUsd,
    Date.now()
  )

  // Historical mails — arrived before the account was set up
  // (initial-sync backfill) — create no tasks. Triage, priorities and
  // display stay unaffected; only the task step is skipped.
  const arrivedAt = row.internal_date ?? row.date
  const historicalMail =
    arrivedAt !== null && row.account_created_at !== null && arrivedAt < row.account_created_at

  if (options.createTasks !== false && !historicalMail) {
    createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: messageId,
      accountId: row.account_id,
      category: parsed.category,
      needsReply,
      subject: row.subject,
      actionItems,
      accountEmail: row.account_email,
      ownerDisplayName: row.account_display_name,
      ownerAccountName: row.account_name,
      toJson: row.to_json,
      ccJson: row.cc_json,
      bodyText: textBeforeForwardedMessage(row.subject, fullBodyText),
      addressedToMe: parsed.addressed_to_me,
      fromAddr: row.from_addr,
      folderSpecialUse: row.folder_special_use,
      forwardWithoutRequest
    })
  }
  return 'done'
}
