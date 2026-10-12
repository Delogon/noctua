import { isDev } from '../dev-mode'
import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { getSetting, setSetting } from '../db'
import { resolveTask } from './providers/registry'
import { logUsage } from './budget'
import { outputLanguageName } from './output-language'

const STYLE_KEY = 'ai.styleProfile'

/**
 * Unbreakable rather than strict (M8 lesson): LLM output is CAPPED and
 * truncated, never rejected — Opus likes to return 8 salutations instead of 6, and
 * that must not be an error.
 */
const clippedList = (
  maxItems: number,
  maxLen: number
): z.ZodCatch<
  z.ZodPipe<z.ZodDefault<z.ZodArray<z.ZodUnknown>>, z.ZodTransform<string[], unknown[]>>
> =>
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
 * Freshness metadata per profile (design 3e: "132 replies · updated today"):
 * how many sent replies the owl knows for this account and when the
 * profile was last learned. Stored next to the profile in the settings.
 */
export function styleMetaKey(accountId?: number | null): string {
  return accountId ? `ai.styleMeta.${accountId}` : 'ai.styleMeta'
}

export function getStyleProfile(accountId?: number | null): StyleProfile | null {
  // Account profile preferred, global one as fallback (existing data from M7b)
  const raw = (accountId ? getSetting(styleKey(accountId)) : null) ?? getSetting(STYLE_KEY)
  if (!raw) return null
  try {
    return styleProfileSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Learns a writing-style profile once from the sent mails (language,
 * salutation/closing patterns, tone). Used by drafts in addition to concrete
 * examples; refresh via the command palette.
 */
export async function refreshStyleProfile(
  db: Database.Database,
  accountId?: number | null
): Promise<StyleProfile | null> {
  const resolved = resolveTask('draft')
  if (!resolved) return null

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
  const { client, model } = resolved
  const result = await client.complete({
    model,
    messages: [
      {
        role: 'system',
        content: `Analyse the writing style of these sent emails. Reply ONLY with JSON:
{"languages": ["de", …], "formality": "when the person uses informal vs. formal address, e.g. du/Sie (short)", "greetings": ["typical salutations, verbatim"], "closings": ["typical sign-offs, verbatim"], "style_notes": ["short style traits: sentence length, tone, emojis, quirks"]}
Write formality and style_notes in ${outputLanguageName()}; copy greetings and closings verbatim from the emails.`
      },
      { role: 'user', content: corpus }
    ],
    // NO response_format: Anthropic models via OpenRouter reject it —
    // JSON comes via instruction, extracted tolerantly below.
    temperature: 0.2,
    maxTokens: 600
  })
  const { inputTokens, outputTokens, costUsd } = result.usage
  logUsage(db, model, inputTokens, outputTokens, costUsd)

  const raw = result.text
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    // Answer contains excerpts from sent mails — in release only the length
    console.warn(
      '[style] unparsebare Antwort:',
      !isDev ? `${raw.length} Zeichen` : raw.slice(0, 400)
    )
    throw new Error('Die Stil-Analyse hat kein JSON geliefert – bitte versuche es noch einmal')
  }
  const profile = styleProfileSchema.parse(parsed)
  setSetting(styleKey(accountId), JSON.stringify(profile))
  setSetting('ai.styleProfile.updatedAt', String(Date.now()))
  // Freshness line of the voice card: size of the reply corpus (not just the 15
  // sampled reads) + learning time — the card shows both honestly.
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

/** Remove quote history so other people's mails don't count as own text. */
export function stripQuoted(text: string): string {
  const cut = text.search(/^(Am|On) .{5,120}(schrieb|wrote)/m)
  const head = cut >= 0 ? text.slice(0, cut) : text
  return head
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
}

/**
 * Deterministic du/Sie detection from mail texts. Sentence-initial "Sie" is
 * ambiguous (sie/Sie) and doesn't count; on a tie the formal Sie wins
 * (the more harmless mistake). null = no signal.
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

/** Deterministic: how does the user usually address THIS contact? */
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
    // Closing: last short line before a possible name/signature
    const shortTail = lines.slice(-3).filter((l) => l.length <= 40)
    const closing = shortTail.length > 0 ? shortTail.join(' ') : null
    if (salutation) return { salutation, closing }
  }
  return { salutation: null, closing: null }
}
