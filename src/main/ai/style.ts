import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { getSetting, setSetting } from '../db'
import { extractUsage, getDraftModel, getOpenRouter, providerBody } from './openrouter'
import { logUsage } from './budget'

const STYLE_KEY = 'ai.styleProfile'

/**
 * Unzerbrechlich statt streng (M8-Lektion): LLM-Output wird GEKAPPT und
 * gekürzt, nie abgelehnt — Opus liefert gern 8 Anreden statt 6, und das
 * darf kein Fehler sein.
 */
const clippedList = (maxItems: number, maxLen: number) =>
  z
    .array(z.unknown())
    .default([])
    .transform((arr) =>
      arr
        .map((x) =>
          String(x ?? '')
            .trim()
            .slice(0, maxLen)
        )
        .filter(Boolean)
        .slice(0, maxItems)
    )
    .catch([])

const styleProfileSchema = z.object({
  languages: clippedList(4, 20),
  formality: z
    .unknown()
    .transform((x) => String(x ?? '').slice(0, 200))
    .catch(''),
  greetings: clippedList(6, 60),
  closings: clippedList(6, 60),
  style_notes: clippedList(8, 200)
})

export type StyleProfile = z.infer<typeof styleProfileSchema>

function styleKey(accountId?: number | null): string {
  return accountId ? `${STYLE_KEY}.${accountId}` : STYLE_KEY
}

/**
 * Frische-Metadaten je Profil (Design 3e: „132 replies · updated today"):
 * wie viele gesendete Antworten die Eule zu diesem Konto kennt und wann das
 * Profil zuletzt gelernt wurde. Liegt neben dem Profil in den Settings.
 */
export function styleMetaKey(accountId?: number | null): string {
  return accountId ? `ai.styleMeta.${accountId}` : 'ai.styleMeta'
}

export function getStyleProfile(accountId?: number | null): StyleProfile | null {
  // Konto-Profil bevorzugt, globales als Fallback (Bestandsdaten aus M7b)
  const raw = (accountId ? getSetting(styleKey(accountId)) : null) ?? getSetting(STYLE_KEY)
  if (!raw) return null
  try {
    return styleProfileSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Lernt einmalig ein Schreibstil-Profil aus den gesendeten Mails (Sprache,
 * Anrede-/Grußmuster, Ton). Wird von den Drafts zusätzlich zu konkreten
 * Beispielen genutzt; Refresh über die Command-Palette.
 */
export async function refreshStyleProfile(
  db: Database.Database,
  accountId?: number | null
): Promise<StyleProfile | null> {
  const client = getOpenRouter()
  if (!client) return null

  const samples = db
    .prepare(
      `SELECT b.text_plain FROM messages m
       JOIN folders f ON f.id = m.folder_id
       JOIN message_bodies b ON b.message_id = m.id
       WHERE f.special_use = '\\Sent' AND b.text_plain IS NOT NULL AND length(b.text_plain) > 40
         AND (? IS NULL OR m.account_id = ?)
       ORDER BY m.date DESC LIMIT 15`
    )
    .all(accountId ?? null, accountId ?? null) as Array<{ text_plain: string }>
  if (samples.length === 0) return null

  const corpus = samples
    .map((s, i) => `--- Mail ${i + 1} ---\n${s.text_plain.slice(0, 500)}`)
    .join('\n\n')
  const model = getDraftModel()
  const response = await client.chat.completions.create({
    ...providerBody(),
    model,
    messages: [
      {
        role: 'system',
        content: `Analysiere den Schreibstil dieser gesendeten E-Mails. Antworte NUR mit JSON:
{"languages": ["de", …], "formality": "wann duzt/siezt die Person (kurz)", "greetings": ["typische Anreden"], "closings": ["typische Grußformeln"], "style_notes": ["knappe Stil-Merkmale: Satzlänge, Ton, Emojis, Eigenheiten"]}`
      },
      { role: 'user', content: corpus }
    ],
    // KEIN response_format: Anthropic-Modelle via OpenRouter lehnen es ab —
    // JSON kommt per Instruktion, unten wird tolerant extrahiert.
    temperature: 0.2,
    max_tokens: 600,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ usage: { include: true } } as any)
  })
  const { inputTokens, outputTokens, costUsd } = extractUsage(response.usage)
  logUsage(db, model, inputTokens, outputTokens, costUsd)

  const raw = response.choices[0]?.message?.content ?? ''
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    console.warn('[style] unparsebare Antwort:', raw.slice(0, 400))
    throw new Error('Stil-Analyse lieferte kein JSON — bitte nochmal versuchen')
  }
  const profile = styleProfileSchema.parse(parsed)
  setSetting(styleKey(accountId), JSON.stringify(profile))
  setSetting('ai.styleProfile.updatedAt', String(Date.now()))
  // Frische-Zeile der Voice-Card: Umfang des Antwort-Korpus (nicht nur die 15
  // gelesenen Stichproben) + Lernzeitpunkt — die Karte zeigt beides ehrlich an.
  const corpusCount = db
    .prepare(
      `SELECT count(*) n FROM messages m
       JOIN folders f ON f.id = m.folder_id
       JOIN message_bodies b ON b.message_id = m.id
       WHERE f.special_use = '\\Sent' AND b.text_plain IS NOT NULL AND length(b.text_plain) > 40
         AND (? IS NULL OR m.account_id = ?)`
    )
    .get(accountId ?? null, accountId ?? null) as { n: number }
  setSetting(
    styleMetaKey(accountId),
    JSON.stringify({ replies: corpusCount.n, updatedAt: Date.now() })
  )
  return profile
}

/** Zitat-Historie entfernen, damit fremde Mails nicht mit eigenem Text zählen. */
export function stripQuoted(text: string): string {
  const cut = text.search(/^(Am|On) .{5,120}(schrieb|wrote)/m)
  const head = cut >= 0 ? text.slice(0, cut) : text
  return head
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
}

/**
 * Deterministische Du/Sie-Erkennung aus Mail-Texten. Satzinitiales „Sie" ist
 * ambig (sie/Sie) und zählt nicht; bei Gleichstand gewinnt das förmliche Sie
 * (der harmlosere Fehler). null = kein Signal.
 */
export function detectAddressForm(texts: string[]): 'sie' | 'du' | null {
  let sie = 0
  let du = 0
  for (const raw of texts) {
    const text = raw ?? ''
    sie += (text.match(/\b(Ihnen|Ihrem|Ihren|Ihrer)\b/g) ?? []).length
    sie += (text.match(/sehr geehrte/gi) ?? []).length * 2
    sie += (text.match(/(?<=[a-zäöüß,;:]\s)Sie\b/g) ?? []).length
    du += (
      text.match(
        /\b(dich|dir|dein|deine|deinem|deinen|deiner|Dich|Dir|Dein|Deine|Deinem|Deinen|Deiner)\b/g
      ) ?? []
    ).length
    du += (text.match(/(?<=[a-zäöüß,;:]\s)[Dd]u\b/g) ?? []).length
  }
  if (sie === 0 && du === 0) return null
  return sie >= du ? 'sie' : 'du'
}

/** Deterministisch: wie redet der Nutzer DIESEN Kontakt üblicherweise an? */
export function extractContactStyle(
  db: Database.Database,
  accountId: number,
  addr: string | null
): { salutation: string | null; closing: string | null } {
  if (!addr) return { salutation: null, closing: null }
  const rows = db
    .prepare(
      `SELECT b.text_plain FROM messages m
       JOIN folders f ON f.id = m.folder_id
       JOIN message_bodies b ON b.message_id = m.id
       WHERE m.account_id = ? AND f.special_use = '\\Sent'
         AND m.to_json LIKE ? AND b.text_plain IS NOT NULL
       ORDER BY m.date DESC LIMIT 3`
    )
    .all(accountId, `%${addr.toLowerCase()}%`) as Array<{ text_plain: string }>

  for (const row of rows) {
    const lines = row.text_plain
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) continue
    const salutation = lines[0].length <= 60 ? lines[0] : null
    // Grußformel: letzte kurze Zeile vor evtl. Namen/Signatur
    const shortTail = lines.slice(-3).filter((l) => l.length <= 40)
    const closing = shortTail.length > 0 ? shortTail.join(' ') : null
    if (salutation) return { salutation, closing }
  }
  return { salutation: null, closing: null }
}
