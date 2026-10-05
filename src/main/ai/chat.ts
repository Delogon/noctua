import { foldSharpS } from '../search/fold'
import { fuzzySenderThreadKeys } from '../search/fuzzy-sender'
import { queryTerms } from '../search/semantic'
import { randomUUID } from 'node:crypto'
import { isDev } from '../dev-mode'
import { currentDateLine, localStamp } from './prompt-date'
import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { htmlToText } from '../mail/parser'
import { extractUsage, getDraftModel, getOpenRouter, providerBody } from './openrouter'
import { isBudgetExceeded, logUsage } from './budget'
import { embedQuery } from './embeddings'
import { blendThreadKeys, isTemporalQuestion } from './chat-recency'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

interface ChatInput {
  question: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

// Unkaputtbar: {"keywords":[...]}, nacktes Array, lange Phrasen, Müll dazwischen.
const keywordSchema = z
  .any()
  .transform((input): string[] => {
    const arr: unknown[] = Array.isArray(input)
      ? input
      : ((input as { keywords?: unknown[] })?.keywords ?? [])
    return arr
      .filter((x): x is string => typeof x === 'string')
      .map((sVal) => sVal.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 12)
  })
  .pipe(z.array(z.string()).min(1))

/**
 * Postfach-Q&A: Query-Expansion (Draft-Modell) → Hybrid-Retrieval
 * (lokale Embeddings via sqlite-vec + FTS5, dazu ein Aktualitäts-Kanal
 * mit den neuesten Threads) → Antwort mit Quellen-Verweisen
 * (Draft-Modell, gestreamt).
 */
export function startChat(
  db: Database.Database,
  push: PushFn,
  input: ChatInput
): { chatId: string } {
  const chatId = randomUUID()
  void runChat(db, push, chatId, input).catch((error) => {
    push('ai:chatChunk', {
      chatId,
      chunk: '',
      done: true,
      error: error instanceof Error ? error.message : String(error),
      sources: null
    })
  })
  return { chatId }
}

/**
 * Compact sender inventory for query expansion (M95): the model can only
 * resolve "meine Bank" to N26 if it can see which senders exist in THIS
 * mailbox. Top senders by volume, display name preferred, deduped.
 */
export function senderInventory(db: Database.Database, limit = 60): string {
  const rows = db
    .prepare(
      `SELECT coalesce(nullif(trim(max(m.from_name)), ''), m.from_addr) AS label, count(*) AS n
       FROM messages m
       WHERE m.from_addr IS NOT NULL AND m.from_addr <> ''
       GROUP BY lower(m.from_addr)
       ORDER BY n DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ label: string; n: number }>
  const seen = new Set<string>()
  const labels: string[] = []
  for (const row of rows) {
    const label = row.label.replace(/["<>]/g, '').trim().slice(0, 48)
    const key = label.toLocaleLowerCase('de-DE')
    if (!label || seen.has(key)) continue
    seen.add(key)
    labels.push(label)
  }
  return labels.join(', ')
}

async function expandQuery(db: Database.Database, question: string): Promise<string[]> {
  const client = getOpenRouter()!
  // Draft-Modell: die Assoziation "Beschreibung -> Produktname" (z. B.
  // "künstliche Stimmen" -> ElevenLabs) schafft das kleine Modell nicht
  // zuverlässig; ein Call pro Chat-Frage ist es wert.
  const model = getDraftModel()
  // Kein response_format: Anthropic-Modelle unterstützen json_object über
  // OpenRouter nicht — JSON kommt per Instruktion und wird robust extrahiert.
  const response = await client.chat.completions.create({
    ...providerBody(),
    model,
    messages: [
      {
        role: 'system',
        content: `${currentDateLine()} Erzeuge Suchbegriffe für die Suche über ein E-Mail-Postfach. Namen, Firmen, Fachbegriffe, deutsche UND englische Varianten. Zeitbezüge ("diesen Monat", "letzte Woche") anhand des heutigen Datums auflösen. Beschreibt die Frage einen Dienst/ein Produkt, ohne ihn zu nennen, rate die wahrscheinlichsten Firmen-/Produktnamen dazu (z. B. "künstliche Stimmen" → ElevenLabs).

Absender in diesem Postfach (nutze passende davon als Suchbegriffe — beschreibt die Frage eine Kategorie wie "meine Bank" oder "mein Hoster", wähle die passenden Absender aus dieser Liste): ${senderInventory(db)}

Antworte NUR mit JSON: {"keywords": ["…"]}`
      },
      { role: 'user', content: question }
    ],
    temperature: 0.2,
    max_tokens: 300,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ usage: { include: true } } as any)
  })
  const { inputTokens, outputTokens, costUsd } = extractUsage(response.usage)
  logUsage(db, model, inputTokens, outputTokens, costUsd)
  const raw = response.choices[0]?.message?.content ?? ''
  try {
    const jsonText = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] ?? raw
    const keywords = keywordSchema.parse(JSON.parse(jsonText))
    // Suchbegriffe stammen aus der Nutzerfrage — nur in Dev loggen
    if (isDev) console.log(`[chat] keywords: ${keywords.join(', ')}`)
    return keywords
  } catch (error) {
    console.warn(
      '[chat] Query-Expansion unlesbar, Wort-Fallback:',
      (error as Error).message.slice(0, 120),
      // Modellantwort kann Mail-Inhalt enthalten: im Release nur die Länge
      !isDev ? `| raw: ${raw.length} Zeichen` : `| raw: ${raw.slice(0, 200)}`
    )
    return question.split(/\s+/).filter((w) => w.length > 3)
  }
}

interface RetrievedThread {
  threadKey: string
  subject: string | null
  context: string
}

function ftsThreadKeys(db: Database.Database, keywords: string[], limit: number): string[] {
  const match = keywords
    .map((k) => foldSharpS(k.replace(/["'*()]/g, '').trim()))
    .filter((k) => k.length >= 3)
    .map((k) => `"${k}"`)
    .join(' OR ')
  if (!match) return []
  return (
    db
      .prepare(
        `SELECT DISTINCT m.thread_key FROM messages_fts ft
         JOIN messages m ON m.id = ft.rowid
         WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(match, limit) as Array<{ thread_key: string }>
  ).map((r) => r.thread_key)
}

/** Semantische Nachbarn über den lokalen Vektor-Index (sqlite-vec KNN). */
async function vectorThreadKeys(
  db: Database.Database,
  question: string,
  limit: number
): Promise<string[]> {
  try {
    const [qvec] = await embedQuery(question)
    const rows = db
      .prepare(
        `SELECT m.thread_key, min(knn.distance) AS d
         FROM (
           SELECT rowid, distance FROM message_vecs
           WHERE embedding MATCH ? AND k = 36
         ) knn
         JOIN messages m ON m.id = knn.rowid
         GROUP BY m.thread_key ORDER BY d LIMIT ?`
      )
      .all(Buffer.from(qvec.buffer, qvec.byteOffset, qvec.byteLength), limit) as Array<{
      thread_key: string
    }>
    return rows.map((r) => r.thread_key)
  } catch (error) {
    // Modell noch nicht geladen / Index leer → FTS trägt allein
    console.warn('[chat] Vektor-Retrieval nicht verfügbar:', (error as Error).message)
    return []
  }
}

/**
 * Die zuletzt eingetroffenen Threads (Eingang/Gesendet/Archiv, kein Spam) —
 * der Aktualitäts-Kanal, den thematisches Retrieval nicht liefern kann.
 */
function newestThreadKeys(db: Database.Database, limit: number): string[] {
  return (
    db
      .prepare(
        `SELECT m.thread_key, max(coalesce(m.date, m.internal_date)) AS newest
         FROM messages m
         JOIN folders f ON f.id = m.folder_id
         WHERE f.special_use IN ('\\Inbox', '\\Sent', '\\Archive')
         GROUP BY m.thread_key
         ORDER BY newest DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ thread_key: string }>
  ).map((r) => r.thread_key)
}

function loadThreadContexts(db: Database.Database, threadKeys: string[]): RetrievedThread[] {
  return threadKeys.map((thread_key) => {
    const messages = db
      .prepare(
        `SELECT m.subject, m.from_name, m.from_addr, m.date, b.text_plain, b.html_raw
         FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
         WHERE m.thread_key = ? ORDER BY m.date DESC LIMIT 2`
      )
      .all(thread_key) as Array<{
      subject: string | null
      from_name: string | null
      from_addr: string | null
      date: number | null
      text_plain: string | null
      html_raw: string | null
    }>
    const context = messages
      .map((m) => {
        const body = (m.text_plain?.trim() || htmlToText(m.html_raw ?? '')).slice(0, 700)
        // Mit Uhrzeit in Lokalzeit: „Welche Mails kamen heute an?" braucht
        // mehr als das Datum, und UTC würde abends das Datum verschieben.
        const when = m.date ? localStamp(m.date) : '?'
        return `Von ${m.from_name ?? m.from_addr ?? '?'} am ${when}:\n${body}`
      })
      .join('\n---\n')
    return { threadKey: thread_key, subject: messages[0]?.subject ?? null, context }
  })
}

/**
 * Follow-up questions ("alle Mails von ihm") name their subject only in
 * earlier turns — fold the recent conversation into the retrieval text so
 * pronouns resolve (M93). Answers are capped early: entities lead them.
 */
export function buildRetrievalText(
  question: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): string {
  const tail = history
    .slice(-4)
    .map((turn) => turn.content.slice(0, turn.role === 'user' ? 300 : 240))
    .join('\n')
  return tail ? `${tail}\n${question}` : question
}

async function runChat(
  db: Database.Database,
  push: PushFn,
  chatId: string,
  input: ChatInput
): Promise<void> {
  const client = getOpenRouter()
  if (!client) throw new Error('Kein OpenRouter-Key hinterlegt (⌘, Einstellungen)')
  if (isBudgetExceeded(db)) throw new Error('AI-Budget erschöpft')

  const retrievalText = buildRetrievalText(input.question, input.history)

  const keywords = await expandQuery(db, retrievalText)
  // Typo-tolerant sender channel first: "letzte Mail von jens buetfisch"
  // must surface that sender's threads even when full text misses (M92).
  // "alle Mails von …" widens the channel so the answer can enumerate.
  const wantsAll = /\balle[nm]?\b/i.test(input.question)
  const senderKeys = fuzzySenderThreadKeys(db, queryTerms(retrievalText), wantsAll ? 14 : 6)
  // Hybrid: semantische Treffer zuerst, Volltext füllt auf (dedupliziert).
  const [vecKeys, vecKeywordKeys, ftsKeys] = await Promise.all([
    vectorThreadKeys(db, retrievalText, 8),
    keywords.length > 0
      ? vectorThreadKeys(db, keywords.join(', '), 6)
      : Promise.resolve([] as string[]),
    Promise.resolve(ftsThreadKeys(db, keywords, 8))
  ])
  // Interleaved mergen, damit beide Vektor-Sichten vorne vertreten sind
  const interleaved: string[] = [...senderKeys]
  const maxLen = Math.max(vecKeys.length, vecKeywordKeys.length, ftsKeys.length)
  for (let i = 0; i < maxLen; i++) {
    for (const list of [vecKeys, vecKeywordKeys, ftsKeys]) {
      if (list[i]) interleaved.push(list[i])
    }
  }
  // Aktualitäts-Kanal: bei Zeitbezug in der Frage tragen die neuesten Threads
  // die Antwort und stehen vorn; sonst füllen ein paar hinten auf.
  const temporal = isTemporalQuestion(input.question)
  const newest = newestThreadKeys(db, temporal ? 10 : 4)
  const merged = blendThreadKeys({
    topical: [...new Set(interleaved)],
    newest,
    temporal,
    // "alle Mails von X": give an identified sender room to enumerate
    cap: wantsAll && senderKeys.length > 0 ? 16 : 12
  })
  console.log(
    `[chat] retrieval: ${vecKeys.length} vektor(frage) + ${vecKeywordKeys.length} vektor(keywords) + ${ftsKeys.length} fts + ${newest.length} neueste${temporal ? ' (Zeitbezug!)' : ''} -> ${merged.length} gesamt`
  )
  const threads = loadThreadContexts(db, merged)

  const contextBlock =
    threads.length > 0
      ? threads
          .map((t, i) => `[${i + 1}] Betreff: ${t.subject ?? '(ohne Betreff)'}\n${t.context}`)
          .join('\n\n')
      : '(keine passenden Mails gefunden)'

  const model = getDraftModel()
  const stream = await client.chat.completions.create({
    ...providerBody(),
    model,
    messages: [
      {
        role: 'system',
        content: `${currentDateLine()}
Du beantwortest Fragen über das E-Mail-Postfach des Nutzers.
Zeitbezüge wie „diesen Monat" oder „gestern" beziehen sich auf das heutige Datum.
Der Kontext enthält thematisch passende UND die zuletzt eingetroffenen Mails
(mit Datum und Uhrzeit) — Fragen nach neuen/heutigen Mails beantwortest du aus
diesen Zeitangaben.
Nutze AUSSCHLIESSLICH den bereitgestellten Mail-Kontext. Verweise auf Quellen mit [n].
Wenn die Antwort nicht im Kontext steht, sage das ehrlich statt zu raten.
Antworte knapp und konkret auf Deutsch (Beträge, Daten, Namen nennen).`
      },
      ...input.history.slice(-6),
      {
        role: 'user' as const,
        content: `Mail-Kontext:\n\n${contextBlock}\n\nFrage: ${input.question}`
      }
    ],
    temperature: 0.2,
    max_tokens: 900,
    stream: true,
    stream_options: { include_usage: true }
  })

  let usageLogged = false
  let charCount = 0
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content ?? ''
    if (delta) {
      charCount += delta.length
      push('ai:chatChunk', { chatId, chunk: delta, done: false, error: null, sources: null })
    }
    if (part.usage) {
      const { inputTokens, outputTokens, costUsd } = extractUsage(part.usage)
      logUsage(db, model, inputTokens, outputTokens, costUsd)
      usageLogged = true
    }
  }
  if (!usageLogged) {
    logUsage(db, model, 0, Math.ceil(charCount / 4), (Math.ceil(charCount / 4) * 25) / 1_000_000)
  }
  push('ai:chatChunk', {
    chatId,
    chunk: '',
    done: true,
    error: null,
    sources: threads.map((t, i) => ({ index: i + 1, threadKey: t.threadKey, subject: t.subject }))
  })
}
