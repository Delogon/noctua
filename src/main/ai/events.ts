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
import { PROPOSES_MEETING_THRESHOLD } from '@shared/decision-thresholds'
import { outputLanguage, outputLanguageName, type OutputLanguage } from './output-language'

/**
 * Appointment suggestions from mails (2.4). Separate job type 'events' (not part of
 * triage → no re-triage, no effect on PROMPT_VERSION): runs only for
 * NEW mails with triage annotation personal/work/other and only if a
 * calendar account exists. Provider: whatever resolveTask('triage') returns
 * (OpenRouter, local/custom servers; Local only is enforced there).
 * Apple Foundation Models: skipped — the helper only knows the fixed
 * schemas "triage" and "gate"; free date/time extraction is not reliable
 * enough with the small on-device model.
 */

export const EVENTS_PROMPT_VERSION = 1

/** Categories the appointment job looks at at all (never newsletters/ads etc.). */
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

// End may also be just a time ("14:00-15:30"): then it applies on the start day
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

// --- Date arithmetic on wall-time strings (no time zone needed) -------------------------------

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

/** Local calendar date 'YYYY-MM-DD' of a timestamp. */
export function localDayOf(ms: number): string {
  return localStamp(ms).slice(0, 10)
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Reference calendar from the mail date ("Montag 2026-10-05, Dienstag 2026-10-06 …"):
 * models are often off by a week for "next Tuesday" when they have to
 * compute weekdays themselves. The table turns that into a lookup.
 */
export function referenceCalendar(mailMs: number, days = 21): string {
  const start = localDayOf(mailMs)
  const lines: string[] = []
  for (let i = 0; i < days; i++) {
    const date = addDaysTo(start, i)
    const [y, m, d] = date.split('-').map(Number)
    const name = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
    lines.push(`${name} ${date}${i === 0 ? ' (date of the email)' : ''}`)
  }
  return lines.join('\n')
}

// --- Resolution / validation ------------------------------------------------------------------

/**
 * Converts a validated raw event into a storable one: end from
 * `end` or duration (default 60 min), all-day for a bare date (end
 * exclusive), time zone only for a valid IANA ID. Discards events before the
 * mail day, too far in the future or with too little confidence (null).
 */
export function resolveEvent(raw: RawEvent, mailMs: number): ResolvedEvent | null {
  if (raw.confidence < MIN_CONFIDENCE) return null
  const start = parseWall(raw.start.replace(' ', 'T'))
  if (!validDate(start.date)) return null
  const mailDay = localDayOf(mailMs)
  // Appointments before the mail day are mostly retrospectives/misresolutions; likewise too distant ones
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
    // All-day: `end` (inclusive, as stated) → exclusive end
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
    // A time-only end on the same day ("14:00-15:30") arrives as date+time
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

/** JSON (possibly in a ``` fence) → validated, resolved events. Throws on invalid JSON/schema. */
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
    // same start only once within the same answer
    if (out.some((o) => o.startLocal === event.startLocal && o.allDay === event.allDay)) continue
    out.push(event)
    if (out.length >= MAX_EVENTS) break
  }
  return out
}

// --- Prompt ---------------------------------------------------------------------------------

export function eventsSystemPrompt(language: OutputLanguage = outputLanguage()): string {
  return `You extract appointments from an email for the recipient's calendar.
${UNTRUSTED_SYSTEM_NOTE}
Reply ONLY with a JSON object, exactly in this form:
{
  "events": [
    {
      "title": "short title of the appointment, in ${outputLanguageName(language)}",
      "start": "YYYY-MM-DDTHH:mm" (with time) or "YYYY-MM-DD" (date only, all-day),
      "end": "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD" or null,
      "duration_minutes": integer or null,
      "location": "place/address or null",
      "online_link": "https link to the online meeting or null",
      "timezone": "IANA time zone such as Europe/Berlin, ONLY if explicitly stated in the email, otherwise null",
      "status": "confirmed" | "proposed",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- Only concrete appointments with a recognisable date (meetings, calls, appointments, events,
  doctor's or tradesperson appointments) that the recipient is meant to attend.
- status "confirmed": the appointment is fixed ("See you on Tuesday at 10"). "proposed": a
  suggestion or request the recipient still has to answer ("Does Thursday 3 pm work for you?").
  If the email offers several alternatives, list each as its own "proposed" appointment.
- Convert relative dates ("tomorrow", "next Tuesday", "in two weeks") into absolute dates using the
  REFERENCE CALENDAR table; the email's date is the reference point.
- Without a time, give only the date (all-day). Never invent times.
- Set end/duration_minutes only if stated in the email.
- No appointments from: newsletters, advertising, invoice or payment deadlines, delivery dates,
  sign-in or security messages, past events, signatures or mere quotes of older emails.
- If there is no appointment: {"events": []}. When in doubt, output no appointment.`
}

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
    `From: ${sanitizeUntrustedLine(input.fromName, 120)} <${sanitizeUntrustedLine(input.fromAddr ?? 'unknown', 200)}>`,
    `Subject: ${sanitizeUntrustedLine(input.subject, 300) || '(no subject)'}`,
    `Date of the email: ${localStamp(ref)}`,
    '',
    'REFERENCE CALENDAR (from the email date):',
    referenceCalendar(ref),
    '',
    'Content:',
    wrapUntrusted('MAIL', sanitizeUntrusted(input.body, 6000) || '(no text content)')
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

/** Does the mail already carry a text/calendar invitation? Then the invitation card exists. */
export function hasInvitation(db: Database.Database, messageId: number): boolean {
  return !!db.prepare('SELECT 1 FROM invitations WHERE message_id = ? LIMIT 1').get(messageId)
}

/**
 * Extracts appointment suggestions from a mail and stores them. Throws on API errors
 * (the queue classifies transient/permanent as with triage).
 */
export async function runEventExtraction(
  db: Database.Database,
  messageId: number
): Promise<EventsOutcome> {
  // Apple FM: not supported (see file header) — job counts as done, no retry
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

  // No calendar, invitation present or own mail: nothing to do
  if (!hasCalendarAccount(db)) return 'skipped-unsupported'
  if (hasInvitation(db, messageId)) return 'skipped-unsupported'
  if (isUserAuthoredMail(db, row.from_addr, row.folder_special_use)) return 'skipped-unsupported'

  const full = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
  const body = textBeforeForwardedMessage(row.subject, full)
  if (body.trim().length < 15) return 'skipped-unsupported'

  // Gate: if triage said "no appointment" via the decision model, the job skips extraction.
  // Without a stored decision (classic triage, older mails) it runs as before.
  const decision = db
    .prepare('SELECT proposes_meeting FROM ai_decisions WHERE message_id = ?')
    .get(messageId) as { proposes_meeting: number | null } | undefined
  if (
    decision &&
    decision.proposes_meeting !== null &&
    decision.proposes_meeting < PROPOSES_MEETING_THRESHOLD
  ) {
    return 'skipped-unsupported'
  }

  // Local only / missing key / no model → like triage: pause, don't burn
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
        { role: 'system', content: eventsSystemPrompt() },
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
