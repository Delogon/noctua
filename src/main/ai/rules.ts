import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { requireTask, resolveDecision } from './providers/registry'
import { decide, isDecisionConfigError, MAX_QUESTIONS, type Questions } from './providers/systemone'
import { RULE_AI_CONDITION_THRESHOLD } from '@shared/decision-thresholds'
import { htmlToText } from '../mail/parser'
import {
  UNTRUSTED_SYSTEM_NOTE,
  sanitizeUntrusted,
  sanitizeUntrustedLine,
  wrapUntrusted
} from './untrusted'
import { logUsage } from './budget'

type RuleActionExecutor = (messageIds: number[], action: 'archive' | 'markRead' | 'flag') => void
let executeAction: RuleActionExecutor = () => {}
/** Vom Bootstrap gesetzt (syncEngine.applyAction) — vermeidet Import-Zyklen. */
export function setRuleActionExecutor(fn: RuleActionExecutor): void {
  executeAction = fn
}

export const ruleJsonSchema = z.object({
  match: z
    .object({
      fromContains: z.array(z.string().max(120)).max(8).optional(),
      fromDomain: z.array(z.string().max(120)).max(8).optional(),
      subjectContains: z.array(z.string().max(120)).max(8).optional(),
      listUnsubscribe: z.boolean().optional(),
      category: z
        .array(
          z.enum([
            'personal',
            'work',
            'newsletter',
            'promotions',
            'notifications',
            'transactional',
            'other'
          ])
        )
        .max(7)
        .optional(),
      minPriority: z.number().int().min(1).max(5).optional(),
      maxPriority: z.number().int().min(1).max(5).optional(),
      /**
       * Ja/Nein-Frage in natürlicher Sprache („Ist das eine Rechnung?"), vom
       * Entscheidungsmodell beantwortet. Ohne Entscheidungsmodell trifft die Regel nie zu.
       */
      aiCondition: z.string().trim().min(1).max(200).optional()
    })
    .refine((m) => Object.keys(m).length > 0, 'Regel braucht mindestens ein Match-Kriterium'),
  actions: z
    .object({
      archive: z.boolean().optional(),
      markRead: z.boolean().optional(),
      flag: z.boolean().optional(),
      setCategory: z
        .enum([
          'personal',
          'work',
          'newsletter',
          'promotions',
          'notifications',
          'transactional',
          'other'
        ])
        .optional(),
      createTask: z.boolean().optional()
    })
    .refine((a) => Object.keys(a).length > 0, 'Regel braucht mindestens eine Aktion')
})

export type RuleJson = z.infer<typeof ruleJsonSchema>

/** KI-Bedingung aus gespeichertem rule_json (null bei keiner/kaputtem JSON). */
export function aiConditionOf(ruleJson: string): string | null {
  try {
    const parsed = ruleJsonSchema.safeParse(JSON.parse(ruleJson))
    return parsed.success ? (parsed.data.match.aiCondition ?? null) : null
  } catch {
    return null
  }
}

export function ruleNeedsAi(rule: RuleJson): boolean {
  return (
    rule.match.category !== undefined ||
    rule.match.minPriority !== undefined ||
    rule.match.maxPriority !== undefined ||
    rule.match.aiCondition !== undefined
  )
}

const DRAFT_PROMPT = `Du übersetzt eine natürlichsprachliche E-Mail-Regel in eine deterministische JSON-Regel.
Antworte NUR mit JSON, exakt in dieser Form (nur benötigte Felder angeben):
{
  "name": "kurzer Regelname",
  "description": "Ein Satz, was die Regel tut",
  "rule": {
    "match": {
      "fromContains": ["substring in absender-adresse/name (lowercase)"],
      "fromDomain": ["beispiel.de"],
      "subjectContains": ["substring im betreff (lowercase)"],
      "listUnsubscribe": true,
      "category": ["newsletter"],
      "minPriority": 1, "maxPriority": 5
    },
    "actions": { "archive": true, "markRead": true, "flag": true, "setCategory": "newsletter", "createTask": true }
  }
}
Nutze category/priority NUR, wenn die Regel wirklich auf AI-Einordnung Bezug nimmt —
Absender-/Betreff-Regeln sind robuster. Erfinde keine Kriterien, die der Nutzer nicht nannte.`

const AI_CONDITION_HINT = `
Zusätzliches optionales Match-Feld "aiCondition": eine Ja/Nein-Frage auf Deutsch (max. 200 Zeichen)
zum Inhalt der Mail, z. B. "Ist das eine Rechnung?". NUR verwenden, wenn der Nutzer ein inhaltliches
Kriterium nennt, das sich nicht aus Absender, Betreff oder Kategorie ergibt.`

export async function draftRule(
  db: Database.Database,
  text: string
): Promise<{ name: string; description: string; rule: RuleJson }> {
  const { client, model } = requireTask('draft')
  const result = await client.complete({
    model,
    messages: [
      {
        role: 'system',
        content: resolveDecision() ? `${DRAFT_PROMPT}${AI_CONDITION_HINT}` : DRAFT_PROMPT
      },
      { role: 'user', content: text.slice(0, 1500) }
    ],
    temperature: 0.1,
    maxTokens: 500
  })
  const { inputTokens, outputTokens, costUsd } = result.usage
  logUsage(db, model, inputTokens, outputTokens, costUsd)

  const raw = result.text
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw
  const parsed = z
    .object({
      name: z.string().max(80),
      description: z.string().max(300).default(''),
      rule: ruleJsonSchema
    })
    .parse(JSON.parse(jsonText))
  return parsed
}

export interface MessageFacts {
  id: number
  from_addr: string | null
  from_name: string | null
  subject: string | null
  list_unsubscribe: number
  category: string | null
  priority: number | null
}

/**
 * `aiProbability`: P(true) der KI-Bedingung dieser Regel (Entscheidungsmodell).
 * Fehlt sie (kein Entscheidungsmodell, Fehler), trifft eine Regel mit
 * aiCondition nie zu. `'skip'` ignoriert die KI-Bedingung (Vorfilter).
 */
export function matches(
  rule: RuleJson,
  m: MessageFacts,
  aiProbability: number | null | 'skip' = null
): boolean {
  const from = `${m.from_name ?? ''} ${m.from_addr ?? ''}`.toLowerCase()
  const domain = (m.from_addr ?? '').split('@')[1]?.toLowerCase() ?? ''
  const subject = (m.subject ?? '').toLowerCase()
  const { match } = rule
  if (match.fromContains && !match.fromContains.some((x) => from.includes(x.toLowerCase())))
    return false
  if (
    match.fromDomain &&
    !match.fromDomain.some(
      (x) => domain === x.toLowerCase() || domain.endsWith(`.${x.toLowerCase()}`)
    )
  )
    return false
  if (
    match.subjectContains &&
    !match.subjectContains.some((x) => subject.includes(x.toLowerCase()))
  )
    return false
  if (match.listUnsubscribe !== undefined && Boolean(m.list_unsubscribe) !== match.listUnsubscribe)
    return false
  if (match.category && (m.category === null || !match.category.includes(m.category as never)))
    return false
  if (match.minPriority !== undefined && (m.priority === null || m.priority < match.minPriority))
    return false
  if (match.maxPriority !== undefined && (m.priority === null || m.priority > match.maxPriority))
    return false
  if (match.aiCondition !== undefined && aiProbability !== 'skip') {
    if (aiProbability === null || aiProbability < RULE_AI_CONDITION_THRESHOLD) return false
  }
  return true
}

function loadFacts(db: Database.Database, messageId: number): MessageFacts | undefined {
  return db
    .prepare(
      `SELECT m.id, m.from_addr, m.from_name, m.subject, m.list_unsubscribe,
              coalesce(a.user_override_category, a.category) AS category, a.priority
       FROM messages m LEFT JOIN ai_annotations a ON a.message_id = m.id
       WHERE m.id = ?`
    )
    .get(messageId) as MessageFacts | undefined
}

/** Frage-Name einer Regel im gebündelten System-One-Aufruf. */
export const ruleQuestionName = (ruleId: number): string => `rule_${ruleId}`

/**
 * KI-Bedingungen ALLER aktiven Regeln einer Mail in EINEM System-One-Aufruf
 * (eine noul-Frage je Regel, höchstens 64). Nur Regeln, deren übrige Kriterien
 * schon zutreffen, werden gefragt – das spart Kontext. Liefert P(true) je
 * Regel-ID; ohne Entscheidungsmodell oder bei Fehler leer (= Regeln pausieren).
 * Die Bedingung stammt vom Nutzer (vertrauenswürdig), die Mail steht als
 * unvertrauenswürdige Daten im state.
 */
export async function evaluateAiConditions(
  db: Database.Database,
  messageId: number
): Promise<Record<number, number>> {
  const rows = db
    .prepare(`SELECT id, rule_json FROM rules WHERE enabled = 1 AND needs_ai = 1 ORDER BY id`)
    .all() as Array<{ id: number; rule_json: string }>
  if (rows.length === 0) return {}
  const m = loadFacts(db, messageId)
  if (!m) return {}

  const questions: Questions = {}
  for (const row of rows) {
    if (Object.keys(questions).length >= MAX_QUESTIONS) break
    let rule: RuleJson
    try {
      rule = ruleJsonSchema.parse(JSON.parse(row.rule_json))
    } catch {
      continue
    }
    const condition = rule.match.aiCondition
    if (!condition || !matches(rule, m, 'skip')) continue
    questions[ruleQuestionName(row.id)] = {
      type: 'noul',
      instructions: condition,
      criteria: { false: 'Nein, trifft nicht zu', true: 'Ja, trifft zu' }
    }
  }
  if (Object.keys(questions).length === 0) return {}

  const cfg = resolveDecision()
  if (!cfg) return {}
  const body = db
    .prepare(
      `SELECT m.subject, m.from_name, m.from_addr, b.text_plain, b.html_raw
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id WHERE m.id = ?`
    )
    .get(messageId) as
    | {
        subject: string | null
        from_name: string | null
        from_addr: string | null
        text_plain: string | null
        html_raw: string | null
      }
    | undefined
  if (!body) return {}
  const text = body.text_plain?.trim() || htmlToText(body.html_raw ?? '')
  const state = [
    UNTRUSTED_SYSTEM_NOTE,
    '',
    `Von: ${sanitizeUntrustedLine(body.from_name, 120)} <${sanitizeUntrustedLine(body.from_addr ?? 'unbekannt', 200)}>`,
    `Betreff: ${sanitizeUntrustedLine(body.subject, 300) || '(kein Betreff)'}`,
    '',
    wrapUntrusted('MAIL', sanitizeUntrusted(text, 6000) || '(kein Textinhalt)')
  ].join('\n')

  try {
    const result = await decide({
      baseUrl: cfg.profile.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      state,
      questions
    })
    logUsage(db, cfg.model, result.usage.inputTokens, result.usage.outputTokens, 0)
    const out: Record<number, number> = {}
    for (const name of Object.keys(questions)) {
      const answer = result.answers[name]
      if (answer?.type === 'noul') out[Number(name.slice('rule_'.length))] = answer.noul
    }
    return out
  } catch (error) {
    if (!isDecisionConfigError(error)) console.warn('[rules] KI-Bedingungen:', error)
    return {}
  }
}

/** Post-Triage-Regeln inkl. KI-Bedingungen (asynchron, ein Entscheidungs-Aufruf je Mail). */
export async function applyRulesPostTriage(
  db: Database.Database,
  messageId: number
): Promise<void> {
  const probabilities = await evaluateAiConditions(db, messageId)
  applyRules(db, messageId, 'post-triage', probabilities)
}

/**
 * Wendet aktive Regeln auf eine Nachricht an. Phase 'ingest' läuft nach dem
 * Body-Ingest (nur deterministische Kriterien), 'post-triage' nach der
 * AI-Annotation (auch Kategorie/Priorität). Einmal ausgeführte Aktionen sind
 * durch die Optimistik der Engine idempotent genug (archive löscht die Zeile).
 */
export function applyRules(
  db: Database.Database,
  messageId: number,
  phase: 'ingest' | 'post-triage',
  aiProbabilities: Record<number, number> = {}
): void {
  const rules = db
    .prepare(`SELECT id, rule_json, needs_ai FROM rules WHERE enabled = 1`)
    .all() as Array<{ id: number; rule_json: string; needs_ai: number }>
  if (rules.length === 0) return

  const m = loadFacts(db, messageId)
  if (!m) return

  for (const row of rules) {
    const wantsAiPhase = row.needs_ai === 1
    if ((phase === 'ingest') === wantsAiPhase) continue
    let rule: RuleJson
    try {
      rule = ruleJsonSchema.parse(JSON.parse(row.rule_json))
    } catch {
      continue
    }
    if (!matches(rule, m, aiProbabilities[row.id] ?? null)) continue

    db.prepare('UPDATE rules SET hits = hits + 1 WHERE id = ?').run(row.id)
    const { actions } = rule
    if (actions.setCategory) {
      db.prepare(
        `INSERT INTO ai_annotations (message_id, category, priority, prompt_version, needs_reply, created_at, user_override_category)
         VALUES (?, ?, 3, 0, 0, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET user_override_category = excluded.user_override_category`
      ).run(messageId, actions.setCategory, Date.now(), actions.setCategory)
    }
    if (actions.createTask) {
      db.prepare(
        `INSERT OR IGNORE INTO tasks (source_kind, source_id, account_id, title, notes, status, created_at)
         SELECT 'mail', id, account_id, ?, ?, 'open', ? FROM messages WHERE id = ?`
      ).run(
        `Regel: ${(m.subject ?? '(ohne Betreff)').slice(0, 160)}`,
        `Automatisch durch Regel #${row.id}`,
        Date.now(),
        messageId
      )
    }
    if (actions.flag) executeAction([messageId], 'flag')
    if (actions.markRead) executeAction([messageId], 'markRead')
    if (actions.archive) {
      executeAction([messageId], 'archive')
      return // Zeile ist weg — weitere Regeln/Aktionen sind gegenstandslos
    }
  }
}
