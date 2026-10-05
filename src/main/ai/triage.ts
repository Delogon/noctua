import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { htmlToText } from '../mail/parser'
import { getTriageProvider } from './openrouter'
import { resolveTask } from './providers/registry'
import { AppleGuardrailError, appleFmStatus, appleGate, appleTriage } from './apple-fm'
import { logUsage } from './budget'
import { createTasksFromTriage, isUserAuthoredMail } from '../db/repos/tasks'
import { isForwardWithoutRequest, textBeforeForwardedMessage } from '../mail/forwarded'
import { recipientPlacement, salutationTarget } from './addressee'
import { localStamp } from './prompt-date'

export const PROMPT_VERSION = 5

export const AI_CATEGORIES = [
  'personal',
  'work',
  'newsletter',
  'promotions',
  'notifications',
  'transactional',
  'other'
] as const

// Action-Items als Objekt mit optionaler Frist; v1-Strings werden toleriert.
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
  // Abwärtskompatibel: Alt-Antworten (Prompt v4) ohne das Feld gelten als adressiert.
  addressed_to_me: z.boolean().default(true),
  confidence: z.number().min(0).max(1).default(0.5)
})

/**
 * Aufgaben-Gate fürs On-Device-Modell (M88): eine einzige enge Frage. Die
 * Formulierung ist eval-getrieben (scripts/apple-triage-eval) — Änderungen
 * dort nachmessen, nicht nach Gefühl umtexten.
 */
export const APPLE_GATE_PROMPT = `Du prüfst für einen E-Mail-Client GENAU EINE Frage:
Bittet in dieser Mail ein einzelner Mensch den im EMPFÄNGER-Block genannten
Kontoinhaber PERSÖNLICH um etwas, existiert eine echte Frist für IHN
(zahlen, Formular abgeben, buchen), oder wartet der Absender erkennbar auf
eine persönliche Antwort des Kontoinhabers (z. B. eine direkte Frage an ihn)?

NEIN bei: Newslettern, Werbung (auch mit Frist „nur bis Sonntag"),
Benachrichtigungen von Diensten, Sicherheitshinweisen und Codes, Reports,
automatischen Erinnerungen, Rundmails mit Gruppenanrede, Mails deren Anrede
eine andere Person nennt, reinen Infos ohne Bitte.
Im Zweifel: NEIN.`

const SYSTEM_PROMPT = `Du bist der Triage-Klassifikator eines persönlichen E-Mail-Clients.
Analysiere die E-Mail und antworte AUSSCHLIESSLICH mit einem JSON-Objekt, exakt in dieser Form:
{
  "category": "personal" | "work" | "newsletter" | "promotions" | "notifications" | "transactional" | "other",
  "priority": 1-5,
  "summary": "Einzeiler auf Deutsch, max. 140 Zeichen, sachlich",
  "action_items": [{"title": "konkrete Aufgabe für den Empfänger", "due": "YYYY-MM-DD oder null"}],
  "needs_reply": true|false,
  "addressed_to_me": true|false,
  "confidence": 0.0-1.0
}

addressed_to_me: true NUR, wenn der im EMPFÄNGER-Block genannte Kontoinhaber
persönlich gemeint ist (namentlich angesprochen, direkt adressiert oder klar
Adressat der Bitte). false, wenn Anrede oder Bitte sich an eine andere Person
richtet (z. B. Anrede mit fremdem Namen, Verteiler-Mail für jemand anderen,
Mail nur zur Kenntnis).
action_items NUR, wenn ein Mensch den genannten Kontoinhaber persönlich um
etwas bittet oder eine echte Frist für IHN existiert (zahlen, antworten,
buchen, kündigen, vorbereiten). Richtet sich die Anrede oder Bitte an eine
andere Person, KEINE action_items und needs_reply=false.
NIEMALS action_items aus: Login-/Anmelde-Benachrichtigungen („neue Anmeldung",
„Sicherheitswarnung", 2FA-/Verifizierungs-Codes), Passwort-Mails,
Systembenachrichtigungen, Newslettern, Werbung oder reinen Infos — auch wenn
der Text Handlungsaufforderungen wie „überprüfe/ändere dein Passwort" enthält;
solche Standard-Sicherheitshinweise sind KEINE Aufgaben des Nutzers.
due nur setzen, wenn eine konkrete Frist erkennbar ist (relativ zum Mail-Datum
in ein absolutes Datum umrechnen), sonst null.

Kategorien:
- personal: echte Menschen, private Kommunikation
- work: berufliche Kommunikation von echten Menschen
- newsletter: redaktionelle Mailings, Digests
- promotions: Werbung, Angebote, Marketing — auch Produktankündigungen und
  Feature-Marketing von Diensten, die der Empfänger bereits nutzt
- notifications: automatische Benachrichtigungen von Diensten (Social, Tools, Kalender)
- transactional: Rechnungen, Bestellungen, Versand, Sicherheitscodes, Verträge
- other: nichts davon

Priorität: 5 = dringend/wichtig für den Empfänger (Mensch wartet auf Antwort, harte Frist,
Sicherheitsvorfall), 4 = Dienst-Warnungen, die bei Ignorieren zu Einschränkungen führen
(Speicher voll, Zahlung fehlgeschlagen, Konto-Sperrung droht), 3 = normal,
1 = ignorierbar (Massenwerbung, Smalltalk-Duplikate).
needs_reply nur bei echten Menschen mit Antworterwartung.
summary nennt den Kern (wer will was), keine Floskeln.`

interface TriageRow {
  id: number
  account_id: number
  subject: string | null
  from_name: string | null
  from_addr: string | null
  to_json: string | null
  cc_json: string | null
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

function buildUserPrompt(db: Database.Database, row: TriageRow): string {
  const fullBodyText = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
  const bodyText = textBeforeForwardedMessage(row.subject, fullBodyText).slice(0, 6000)
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
    row.list_unsubscribe ? 'List-Unsubscribe-Header vorhanden (Massenmail-Signal)' : null,
    stats && stats.sent_count > 0
      ? `Der Empfänger hat diesem Absender schon ${stats.sent_count}× geschrieben (bekannter Kontakt)`
      : null,
    previous ? `Frühere Mails dieses Absenders wurden als "${previous.cat}" eingeordnet` : null
  ].filter(Boolean)

  // EMPFÄNGER-Block: Wer ist der Kontoinhaber, wo steht er im Envelope,
  // wen spricht die Anrede an? Grundlage für addressed_to_me.
  const ownerName = row.account_display_name?.trim() || row.account_name?.trim() || null
  const placement = recipientPlacement(row.account_email, row.to_json, row.cc_json)
  const placementLabel = {
    to: 'steht im An',
    cc: 'steht nur im CC',
    absent: 'ist weder in An noch CC (Verteiler-/Bcc-Zustellung)'
  }[placement]
  const salutation = salutationTarget(bodyText)
  const salutationLabel =
    salutation.kind === 'named'
      ? `nennt namentlich: ${salutation.names.join(', ')}`
      : salutation.kind === 'group'
        ? 'Gruppenanrede (z. B. „Hallo zusammen")'
        : 'keine erkennbare Anrede'

  return [
    `Von: ${row.from_name ?? ''} <${row.from_addr ?? 'unbekannt'}>`,
    `Betreff: ${row.subject ?? '(kein Betreff)'}`,
    `Datum: ${row.date ? localStamp(row.date) : 'unbekannt'}`,
    `EMPFÄNGER (Kontoinhaber): ${ownerName ? `${ownerName} ` : ''}<${row.account_email ?? 'unbekannt'}>; ${placementLabel}; Anrede der Mail: ${salutationLabel}`,
    signals.length > 0 ? `Signale: ${signals.join('; ')}` : null,
    '',
    'Inhalt:',
    bodyText || '(kein Textinhalt)'
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export type TriageOutcome = 'done' | 'skipped-no-client' | 'skipped-missing'

type TriageVerdict = z.infer<typeof triageResultSchema>

/**
 * Rohes Ergebnis des On-Device-Modells in die Schema-Form bringen: Guided
 * Generation garantiert die Struktur, aber Wertebereiche (Kategorie-Enum,
 * Prioritätsklemme, Datums-Format) klemmen wir hier deterministisch.
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

/** Neutrales Urteil, wenn Apples Guardrails den Mail-Inhalt ablehnen —
 *  die Mail bleibt nutzbar (Kategorie other, keine Aufgaben, Zuversicht 0). */
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

/** Klassifiziert eine Nachricht und schreibt die Annotation. Wirft bei API-Fehlern. */
export async function runTriage(db: Database.Database, messageId: number): Promise<TriageOutcome> {
  const provider = getTriageProvider()
  // Aufgabe → Profil: bei Local only oder ohne Key/Modell pausiert die Triage
  // wie bei „kein Key" (Job bleibt liegen, kein verbrannter Versuch)
  const resolved = provider === 'openrouter' ? resolveTask('triage') : null
  if (provider === 'openrouter' && !resolved) return 'skipped-no-client'

  const row = db
    .prepare(
      `SELECT m.id, m.account_id, m.subject, m.from_name, m.from_addr, m.to_json, m.cc_json,
              m.date, m.internal_date, m.list_unsubscribe, b.text_plain, b.html_raw,
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

  const userPrompt = buildUserPrompt(db, row)

  if (provider === 'apple') {
    const status = await appleFmStatus()
    // Modell lädt/It's off: Job ohne verbrannten Versuch zurücklegen (wie „kein Key")
    if (status.state !== 'available') return 'skipped-no-client'
    // Zweistufig (M88): Erst die enge Gate-Frage („bittet ein Mensch den
    // Kontoinhaber persönlich?"), dann das Gesamturteil. Das 3B-Modell
    // beantwortet die isolierte Frage deutlich zuverlässiger, als es
    // Aufgaben im Gesamturteil extrahiert — nur bei Gate=ja dürfen
    // action_items und needs_reply Aufgaben erzeugen.
    const gateOpen = await appleGate(APPLE_GATE_PROMPT, userPrompt)
    let parsed: TriageVerdict
    try {
      parsed = sanitizeAppleVerdict(await appleTriage(SYSTEM_PROMPT, userPrompt))
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
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            attempt === 0
              ? userPrompt
              : `${userPrompt}\n\nDeine letzte Antwort war ungültig (${lastError}). Antworte exakt nach Schema.`
        }
      ],
      json: true,
      temperature: 0.1,
      // Reasoning-Modelle (z. B. DeepSeek v4 Flash) verbrauchen max_tokens
      // auch für Denk-Tokens — 500 schnitt Antworten ab (finish=length)
      // und verbrannte Retries. Der Output selbst bleibt ~150 Tokens.
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

  throw new Error(`Triage-Output ungültig nach Retry: ${lastError}`)
}

/** Deterministische Nachverarbeitung + Persistenz — für beide Provider gleich:
 *  Regeln schlagen Modell-Feinheiten, dann Annotation-Upsert und Task-Ableitung. */
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
    // user_override_category bleibt beim Upsert unangetastet erhalten.
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

  // Historische Mails — angekommen, bevor das Konto eingerichtet wurde
  // (Erst-Sync-Backfill) — erzeugen keine Aufgaben. Triage, Prioritäten und
  // Anzeige bleiben unberührt; nur der Aufgaben-Schritt wird übersprungen.
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
