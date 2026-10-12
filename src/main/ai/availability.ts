import type Database from 'better-sqlite3-multiple-ciphers'
import { getSetting } from '../db'
import { selfBusy } from '../calendar/freebusy'
import { systemTimeZone, utcToWallIana, wallToUtcIana, type Wall } from '../calendar/tz'

/**
 * Availability for reply drafts (2.4): when a mail asks for an
 * appointment, the model gets the user's FREE time slots (next
 * workdays, 08–18 local) and suggests 2–3 concrete ones from them.
 * Privacy: only local busy data (`selfBusy`), only free time slots as
 * data — never event titles, locations, attendees or busy intervals.
 */

export interface TimeSlot {
  startUtc: number
  endUtc: number
}

export interface SlotOptions {
  fromUtc: number
  /** Number of workdays (Mon–Fri), default 10 */
  workingDays?: number
  startHour?: number
  endHour?: number
  zone: string
  /** Shortest emitted gap in minutes */
  minMinutes?: number
  /** Lead time from fromUtc in which nothing is suggested (minutes) */
  leadMinutes?: number
}

const QUARTER_MS = 15 * 60_000

interface Ymd {
  y: number
  m: number
  d: number
}

function addDay(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

function weekday(day: Ymd): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay()
}

function wallAt(day: Ymd, hour: number): Wall {
  return { ...day, h: hour, mi: 0, s: 0 }
}

/** The next workdays (Mon–Fri) from the local calendar day of fromUtc. */
export function workingDayList(fromUtc: number, zone: string, count: number): Ymd[] {
  const start = utcToWallIana(fromUtc, zone)
  let day: Ymd = { y: start.y, m: start.m, d: start.d }
  const out: Ymd[] = []
  // Upper bound against endless loops; 10 workdays = at most ~14 calendar days
  for (let i = 0; i < count * 3 + 7 && out.length < count; i++) {
    const wd = weekday(day)
    if (wd >= 1 && wd <= 5) out.push(day)
    day = addDay(day, 1)
  }
  return out
}

/**
 * Free time slots within working hours. The windows are built per day in
 * the zone's wall time (DST-safe via wallToUtcIana), busy intervals
 * (incl. BUSY-TENTATIVE) are subtracted, overlaps merged beforehand.
 */
export function computeFreeSlots(
  busy: ReadonlyArray<{ startUtc: number; endUtc: number }>,
  opts: SlotOptions
): TimeSlot[] {
  const startHour = opts.startHour ?? 8
  const endHour = opts.endHour ?? 18
  const minMs = (opts.minMinutes ?? 30) * 60_000
  const earliest =
    Math.ceil((opts.fromUtc + (opts.leadMinutes ?? 120) * 60_000) / QUARTER_MS) * QUARTER_MS

  const merged: TimeSlot[] = []
  for (const b of [...busy]
    .filter((x) => x.endUtc > x.startUtc)
    .sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc)) {
    const last = merged[merged.length - 1]
    if (last && b.startUtc <= last.endUtc) last.endUtc = Math.max(last.endUtc, b.endUtc)
    else merged.push({ startUtc: b.startUtc, endUtc: b.endUtc })
  }

  const slots: TimeSlot[] = []
  for (const day of workingDayList(opts.fromUtc, opts.zone, opts.workingDays ?? 10)) {
    const dayStart = Math.max(wallToUtcIana(wallAt(day, startHour), opts.zone), earliest)
    const dayEnd = wallToUtcIana(wallAt(day, endHour), opts.zone)
    let cursor = dayStart
    for (const b of merged) {
      if (b.endUtc <= cursor) continue
      if (b.startUtc >= dayEnd) break
      if (b.startUtc - cursor >= minMs) slots.push({ startUtc: cursor, endUtc: b.startUtc })
      cursor = Math.max(cursor, b.endUtc)
      if (cursor >= dayEnd) break
    }
    if (dayEnd - cursor >= minMs) slots.push({ startUtc: cursor, endUtc: dayEnd })
  }
  return slots
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "2026-10-12 (Mon): 09:00-11:30, 14:00-18:00" — language-neutral, one day per line. */
export function formatSlots(slots: TimeSlot[], zone: string, maxPerDay = 4): string[] {
  const byDay = new Map<string, string[]>()
  for (const s of slots) {
    const a = utcToWallIana(s.startUtc, zone)
    const b = utcToWallIana(s.endUtc, zone)
    const key = `${a.y}-${pad(a.m)}-${pad(a.d)} (${new Date(Date.UTC(a.y, a.m - 1, a.d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })})`
    const list = byDay.get(key) ?? []
    if (list.length < maxPerDay) list.push(`${pad(a.h)}:${pad(a.mi)}-${pad(b.h)}:${pad(b.mi)}`)
    byDay.set(key, list)
  }
  return [...byDay].map(([day, ranges]) => `${day}: ${ranges.join(', ')}`)
}

/** Own calendar data may go into draft prompts: setting not off + calendar account present. */
export function draftCalendarEnabled(db: Database.Database): boolean {
  if (getSetting('ai.draftUseCalendar') === '0') return false
  return !!db.prepare('SELECT 1 FROM cal_accounts LIMIT 1').get()
}

// Cheap detection of "mail asks for an appointment / a time".
const MEETING_ASK =
  /\b(termin|treffen|besprechung|meeting|telefonat|call|videocall|gespräch|kaffee|mittagessen|zeit(?:punkt|fenster)?|verfügbar|passt (?:es|dir|ihnen)|wann (?:hast|haben|passt|könnt|können)|vorschlag|appointment|schedule|reschedule|availability|available|catch up|get together|lunch|coffee|when (?:are|can|could|would|works)|works for you|free (?:on|at|for))\b/i

export function asksForMeeting(text: string, hasEventSuggestion: boolean): boolean {
  return hasEventSuggestion || MEETING_ASK.test(text)
}

export interface AvailabilityBlockInput {
  now: number
  zone?: string
  /** Text of the last message from someone else (without quotes) */
  lastMessageText: string
  /** Is there an appointment suggestion from extraction for the thread? */
  hasEventSuggestion: boolean
  /** Triage-Annotation needs_reply */
  needsReply?: boolean
}

/**
 * Prompt section with the free time slots, or null (setting off, no
 * calendar, mail doesn't ask for an appointment, no free slots).
 */
export function buildAvailabilityBlock(
  db: Database.Database,
  input: AvailabilityBlockInput
): string | null {
  if (!draftCalendarEnabled(db)) return null
  if (!asksForMeeting(input.lastMessageText, input.hasEventSuggestion)) return null
  const zone = input.zone ?? systemTimeZone()
  const days = workingDayList(input.now, zone, 10)
  if (days.length === 0) return null
  const rangeStart = wallToUtcIana(wallAt(days[0], 0), zone)
  const rangeEnd = wallToUtcIana(wallAt(addDay(days[days.length - 1], 1), 0), zone)
  const busy = selfBusy({ rangeStart: Math.min(rangeStart, input.now), rangeEnd }, db)
  const slots = computeFreeSlots(busy, { fromUtc: input.now, zone, workingDays: 10 })
  const lines = formatSlots(slots, zone)
  if (lines.length === 0) {
    return `\n\nUser availability (time zone ${zone}): there are no free time slots in the next 10 working days (08-18). Do not propose concrete times; ask for alternative dates or later periods instead.`
  }
  return `\n\nUser availability: the email asks for an appointment. Below are ONLY the user's free time slots (time zone ${zone}, working days, 08-18), nothing else about the calendar.
Propose 2 to 3 concrete times exclusively from this list (date, weekday, time) and do not invent others. Do not mention other appointments or calendar details.
<<<BEGIN FREE TIME SLOTS>>>
${lines.join('\n')}
<<<END FREE TIME SLOTS>>>`
}
