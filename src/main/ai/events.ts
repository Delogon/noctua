import type Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { htmlToText } from '../mail/parser'
import { textBeforeForwardedMessage } from '../mail/forwarded'
import { isUserAuthoredMail } from '../db/repos/tasks'
import { isValidIana } from '../calendar/tz'
import { storeEventSuggestions, type ResolvedEvent } from '../calendar/event-suggestions'
import { getTriageProvider } from './openrouter'
import { resolveTask } from './providers/registry'
import { logUsage } from './budget'
import {
  UNTRUSTED_SYSTEM_NOTE,
  sanitizeUntrusted,
  sanitizeUntrustedLine,
  wrapUntrusted
} from './untrusted'
import { localStamp } from './prompt-date'

/**
 * Terminvorschläge aus Mails (2.4). Eigener Job-Typ 'events' (nicht Teil der
 * Triage → keine Neu-Triage, kein Einfluss auf PROMPT_VERSION): läuft nur für
 * NEUE Mails mit Triage-Annotation personal/work/other und nur, wenn ein
 * Kalender-Konto existiert. Provider: alles, was resolveTask('triage') liefert
 * (OpenRouter, lokale/eigene Server; Local only wird dort durchgesetzt).
 * Apple Foundation Models: übersprungen — der Helper kennt nur die festen
 * Schemata „triage" und „gate", freie Datums-/Zeitextraktion ist mit dem
 * kleinen On-Device-Modell nicht zuverlässig genug.
 */

export const EVENTS_PROMPT_VERSION = 1

/** Kategorien, die der Termin-Job überhaupt ansieht (Newsletter/Werbung etc. nie). */
export const EVENT_CATEGORIES = ['personal', 'work', 'other'] as const

const MAX_EVENTS = 3
const MIN_CONFIDENCE = 0.5
const DEFAULT_DURATION_MIN = 60
const MAX_DURATION_MIN = 12 * 60
const MAX_FUTURE_DAYS = 800

const dateOnly = /^\d{4}-\d{2}-\d{2}$/
const dateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/
const dateOrDateTime = z.string().refine((v) => dateOnly.test(v) || dateTime.test(v), {
  message: 'Datum/Zeit im Format YYYY-MM-DD oder YYYY-MM-DDTHH:mm erwartet'
})

// Ende darf auch nur eine Uhrzeit sein („14:00-15:30“): gilt dann am Starttag
const endValue = z
  .string()
  .refine((v) => dateOnly.test(v) || dateTime.test(v) || /^\d{2}:\d{2}$/.test(v), {
    message: 'Ende im Format YYYY-MM-DD, YYYY-MM-DDTHH:mm oder HH:mm erwartet'
  })

const rawEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  start: dateOrDateTime,
  end: endValue.nullable().default(null),
  duration_minutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60)
    .nullable()
    .default(null),
  location: z.string().max(300).nullable().default(null),
  online_link: z.string().max(500).nullable().default(null),
  timezone: z.string().max(100).nullable().default(null),
  status: z.enum(['proposed', 'confirmed']).default('proposed'),
  confidence: z.number().min(0).max(1).default(0.5)
})

export const eventExtractionSchema = z.object({
  events: z.array(rawEventSchema).max(10).default([])
})
export type RawEvent = z.infer<typeof rawEventSchema>

// --- Datums-Arithmetik auf Wandzeit-Strings (keine Zeitzone nötig) ----------------------------

const pad = (n: number): string => String(n).padStart(2, '0')

function parseWall(value: string): { date: string; minutes: number | null } {
  const date = value.slice(0, 10)
  if (value.length <= 10) return { date, minutes: null }
  return { date, minutes: Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16)) }
}

function validDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

function addMinutes(
  date: string,
  minutes: number,
  delta: number
): { date: string; minutes: number } {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d, 0, minutes + delta))
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    minutes: t.getUTCHours() * 60 + t.getUTCMinutes()
  }
}

function addDaysTo(date: string, days: number): string {
  return addMinutes(date, 0, days * 24 * 60).date
}

function wallString(date: string, minutes: number): string {
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`
}

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Lokales Kalenderdatum 'YYYY-MM-DD' eines Zeitstempels. */
export function localDayOf(ms: number): string {
  return localStamp(ms).slice(0, 10)
}

const WEEKDAYS_DE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag'
]

/**
 * Referenz-Kalender ab dem Mail-Datum („Montag 2026-10-05, Dienstag 2026-10-06 …"):
 * Modelle verrechnen sich bei „nächsten Dienstag" oft um eine Woche, wenn sie
 * Wochentage selbst ausrechnen müssen. Die Tabelle macht daraus ein Nachschlagen.
 */
export function referenceCalendar(mailMs: number, days = 21): string {
  const start = localDayOf(mailMs)
  const lines: string[] = []
  for (let i = 0; i < days; i++) {
    const date = addDaysTo(start, i)
    const [y, m, d] = date.split('-').map(Number)
    const name = WEEKDAYS_DE[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    lines.push(`${name} ${date}${i === 0 ? ' (Datum der Mail)' : ''}`)
  }
  return lines.join('\n')
}

// --- Auflösung / Validierung -----------------------------------------------------------------

/**
 * Wandelt ein validiertes Roh-Ereignis in ein speicherbares um: Ende aus
 * `end` oder Dauer (Standard 60 min), ganztägig bei reinem Datum (Ende
 * exklusiv), Zeitzone nur bei gültiger IANA-ID. Verwirft Ereignisse vor dem
 * Mail-Tag, zu weit in der Zukunft oder mit zu geringer Zuversicht (null).
 */
export function resolveEvent(raw: RawEvent, mailMs: number): ResolvedEvent | null {
  if (raw.confidence < MIN_CONFIDENCE) return null
  const start = parseWall(raw.start.replace(' ', 'T'))
  if (!validDate(start.date)) return null
  const mailDay = localDayOf(mailMs)
  // Termine vor dem Mail-Tag sind meist Rückblicke/Fehlauflösungen; zu ferne ebenso
  if (start.date < mailDay || dayDiff(mailDay, start.date) > MAX_FUTURE_DAYS) return null

  const link = /^https?:\/\/\S+$/i.test(raw.online_link?.trim() ?? '')
    ? raw.online_link!.trim()
    : null
  const tzid = raw.timezone && isValidIana(raw.timezone.trim()) ? raw.timezone.trim() : null
  const rawEnd =
    raw.end && /^\d{2}:\d{2}$/.test(raw.end) ? `${start.date}T${raw.end}` : (raw.end ?? null)
  const base = {
    title: sanitizeUntrustedLine(raw.title, 200),
    location: raw.location ? sanitizeUntrustedLine(raw.location, 300) || null : null,
    link,
    kind: raw.status,
    confidence: raw.confidence
  }
  if (!base.title) return null

  if (start.minutes === null) {
    // Ganztägig: `end` (inklusiv, wie genannt) → exklusives Ende
    let endDate = addDaysTo(start.date, 1)
    if (rawEnd) {
      const end = parseWall(rawEnd.replace(' ', 'T'))
      if (validDate(end.date) && end.date >= start.date) endDate = addDaysTo(end.date, 1)
    }
    return { ...base, allDay: true, startLocal: start.date, endLocal: endDate, tzid: null }
  }

  let end: { date: string; minutes: number }
  const parsedEnd = rawEnd ? parseWall(rawEnd.replace(' ', 'T')) : null
  if (parsedEnd && validDate(parsedEnd.date) && parsedEnd.minutes !== null) {
    // Nur Uhrzeit-Ende am selben Tag („14:00-15:30") kommt als Datum+Zeit an
    const candidate = { date: parsedEnd.date, minutes: parsedEnd.minutes }
    const startKey = start.date + String(start.minutes).padStart(4, '0')
    const endKey = candidate.date + String(candidate.minutes).padStart(4, '0')
    end =
      endKey > startKey
        ? candidate
        : addMinutes(start.date, start.minutes, raw.duration_minutes ?? DEFAULT_DURATION_MIN)
  } else {
    const duration = Math.min(raw.duration_minutes ?? DEFAULT_DURATION_MIN, MAX_DURATION_MIN)
    end = addMinutes(start.date, start.minutes, duration)
  }
  return {
    ...base,
    allDay: false,
    startLocal: wallString(start.date, start.minutes),
    endLocal: wallString(end.date, end.minutes),
    tzid
  }
}

/** JSON (ggf. in ```-Zaun) → validierte, aufgelöste Ereignisse. Wirft bei ungültigem JSON/Schema. */
export function parseEventExtraction(raw: string, mailMs: number): ResolvedEvent[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = eventExtractionSchema.parse(JSON.parse(text))
  const out: ResolvedEvent[] = []
  for (const item of parsed.events) {
    const event = resolveEvent(item, mailMs)
    if (!event) continue
    // gleicher Start innerhalb derselben Antwort nur einmal
    if (out.some((o) => o.startLocal === event.startLocal && o.allDay === event.allDay)) continue
    out.push(event)
    if (out.length >= MAX_EVENTS) break
  }
  return out
}

// --- Prompt ---------------------------------------------------------------------------------

export const EVENTS_SYSTEM_PROMPT = `Du extrahierst Termine aus einer E-Mail für den Kalender des Empfängers.
${UNTRUSTED_SYSTEM_NOTE}
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, exakt in dieser Form:
{
  "events": [
    {
      "title": "kurzer Titel des Termins",
      "start": "YYYY-MM-DDTHH:mm" (mit Uhrzeit) oder "YYYY-MM-DD" (nur Datum, ganztägig),
      "end": "YYYY-MM-DDTHH:mm" oder "YYYY-MM-DD" oder null,
      "duration_minutes": Ganzzahl oder null,
      "location": "Ort/Adresse oder null",
      "online_link": "https-Link zum Online-Meeting oder null",
      "timezone": "IANA-Zeitzone wie Europe/Berlin, NUR wenn in der Mail ausdrücklich genannt, sonst null",
      "status": "confirmed" | "proposed",
      "confidence": 0.0-1.0
    }
  ]
}

Regeln:
- Nur konkrete Termine mit erkennbarem Datum (Treffen, Besprechungen, Anrufe, Verabredungen,
  Veranstaltungen, Arzt-/Handwerkertermine), an denen der Empfänger teilnehmen soll.
- status "confirmed": der Termin steht fest („Wir sehen uns am Dienstag um 10 Uhr"). "proposed":
  Vorschlag oder Anfrage, auf die der Empfänger noch antworten muss („Passt dir Donnerstag 15 Uhr?").
  Bietet die Mail mehrere Alternativen an, liste jede als eigenen "proposed"-Termin.
- Relative Angaben („morgen", „nächsten Dienstag", „in zwei Wochen") rechne anhand der
  REFERENZ-KALENDER-Tabelle in absolute Daten um; das Mail-Datum ist der Bezugspunkt.
- Ohne Uhrzeit nur das Datum angeben (ganztägig). Uhrzeiten nie erfinden.
- end/duration_minutes nur setzen, wenn in der Mail genannt.
- Keine Termine aus: Newslettern, Werbung, Rechnungsfristen/Zahlungszielen, Lieferterminen,
  Login-/Sicherheitsmeldungen, vergangenen Ereignissen, Signaturen oder reinen Zitaten alter Mails.
- Gibt es keinen Termin: {"events": []}. Im Zweifel keinen Termin ausgeben.`

export interface EventsPromptInput {
  fromName: string | null
  fromAddr: string | null
  subject: string | null
  dateMs: number | null
  body: string
}

export function buildEventsPrompt(input: EventsPromptInput): string {
  const ref = input.dateMs ?? Date.now()
  return [
    `Von: ${sanitizeUntrustedLine(input.fromName, 120)} <${sanitizeUntrustedLine(input.fromAddr ?? 'unbekannt', 200)}>`,
    `Betreff: ${sanitizeUntrustedLine(input.subject, 300) || '(kein Betreff)'}`,
    `Datum der Mail: ${localStamp(ref)}`,
    '',
    'REFERENZ-KALENDER (ab Mail-Datum):',
    referenceCalendar(ref),
    '',
    'Inhalt:',
    wrapUntrusted('MAIL', sanitizeUntrusted(input.body, 6000) || '(kein Textinhalt)')
  ].join('\n')
}

// --- Job ------------------------------------------------------------------------------------

export type EventsOutcome = 'done' | 'skipped-no-client' | 'skipped-missing' | 'skipped-unsupported'

interface EventsRow {
  id: number
  account_id: number
  thread_key: string
  subject: string | null
  from_name: string | null
  from_addr: string | null
  date: number | null
  internal_date: number | null
  text_plain: string | null
  html_raw: string | null
  folder_special_use: string | null
}

export function hasCalendarAccount(db: Database.Database): boolean {
  return !!db.prepare('SELECT 1 FROM cal_accounts LIMIT 1').get()
}

/** Trägt die Mail bereits eine text/calendar-Einladung? Dann gibt es die Einladungskarte. */
export function hasInvitation(db: Database.Database, messageId: number): boolean {
  return !!db.prepare('SELECT 1 FROM invitations WHERE message_id = ? LIMIT 1').get(messageId)
}

/**
 * Extrahiert Terminvorschläge einer Mail und speichert sie. Wirft bei API-Fehlern
 * (die Queue klassifiziert transient/permanent wie bei der Triage).
 */
export async function runEventExtraction(
  db: Database.Database,
  messageId: number
): Promise<EventsOutcome> {
  // Apple FM: nicht unterstützt (siehe Dateikopf) — Job gilt als erledigt, kein Retry
  if (getTriageProvider() === 'apple') return 'skipped-unsupported'

  const row = db
    .prepare(
      `SELECT m.id, m.account_id, m.thread_key, m.subject, m.from_name, m.from_addr, m.date,
              m.internal_date, b.text_plain, b.html_raw, f.special_use folder_special_use
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
       LEFT JOIN folders f ON f.id = m.folder_id
       WHERE m.id = ?`
    )
    .get(messageId) as EventsRow | undefined
  if (!row) return 'skipped-missing'

  // Kein Kalender, Einladung vorhanden oder eigene Mail: nichts zu tun
  if (!hasCalendarAccount(db)) return 'skipped-unsupported'
  if (hasInvitation(db, messageId)) return 'skipped-unsupported'
  if (isUserAuthoredMail(db, row.from_addr, row.folder_special_use)) return 'skipped-unsupported'

  const full = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
  const body = textBeforeForwardedMessage(row.subject, full)
  if (body.trim().length < 15) return 'skipped-unsupported'

  // Local only / fehlender Key / kein Modell → wie die Triage: pausieren, nicht verbrennen
  const resolved = resolveTask('triage')
  if (!resolved) return 'skipped-no-client'
  const { client, model } = resolved

  const mailMs = row.date ?? row.internal_date ?? Date.now()
  const userPrompt = buildEventsPrompt({
    fromName: row.from_name,
    fromAddr: row.from_addr,
    subject: row.subject,
    dateMs: mailMs,
    body
  })

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.complete({
      model,
      messages: [
        { role: 'system', content: EVENTS_SYSTEM_PROMPT },
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
      maxTokens: 1200
    })
    const { inputTokens, outputTokens, costUsd } = result.usage
    logUsage(db, model, inputTokens, outputTokens, costUsd)

    let events: ResolvedEvent[]
    try {
      events = parseEventExtraction(result.text, mailMs)
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 300) : 'parse error'
      continue
    }
    if (events.length > 0) {
      storeEventSuggestions(
        db,
        { messageId, accountId: row.account_id, threadKey: row.thread_key, model },
        events
      )
    }
    return 'done'
  }
  throw new Error(`Ungültige Antwort des Modells (Termine) nach erneutem Versuch: ${lastError}`)
}
