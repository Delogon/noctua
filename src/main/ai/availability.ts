import type Database from 'better-sqlite3-multiple-ciphers'
import { getSetting } from '../db'
import { selfBusy } from '../calendar/freebusy'
import { systemTimeZone, utcToWallIana, wallToUtcIana, type Wall } from '../calendar/tz'

/**
 * Verfügbarkeit für Antwortentwürfe (2.4): Wenn eine Mail um einen Termin
 * bittet, bekommt das Modell die FREIEN Zeitfenster des Nutzers (nächste
 * Arbeitstage, 08–18 Uhr lokal) und schlägt daraus 2–3 konkrete vor.
 * Datenschutz: nur lokale Belegung (`selfBusy`), nur freie Zeitfenster als
 * Daten — nie Termintitel, Orte, Teilnehmer oder belegte Intervalle.
 */

export interface TimeSlot {
  startUtc: number
  endUtc: number
}

export interface SlotOptions {
  fromUtc: number
  /** Anzahl Arbeitstage (Mo–Fr), Standard 10 */
  workingDays?: number
  startHour?: number
  endHour?: number
  zone: string
  /** Kürzeste ausgegebene Lücke in Minuten */
  minMinutes?: number
  /** Vorlauf ab fromUtc, in dem nichts vorgeschlagen wird (Minuten) */
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

/** Die nächsten Arbeitstage (Mo–Fr) ab dem lokalen Kalendertag von fromUtc. */
export function workingDayList(fromUtc: number, zone: string, count: number): Ymd[] {
  const start = utcToWallIana(fromUtc, zone)
  let day: Ymd = { y: start.y, m: start.m, d: start.d }
  const out: Ymd[] = []
  // Obergrenze gegen Endlosschleifen; 10 Arbeitstage = höchstens ~14 Kalendertage
  for (let i = 0; i < count * 3 + 7 && out.length < count; i++) {
    const wd = weekday(day)
    if (wd >= 1 && wd <= 5) out.push(day)
    day = addDay(day, 1)
  }
  return out
}

/**
 * Freie Zeitfenster innerhalb der Arbeitszeit. Die Fenster werden je Tag in
 * Wandzeit der Zone gebildet (DST-fest über wallToUtcIana), belegte Intervalle
 * (auch BUSY-TENTATIVE) werden abgezogen, Überlappungen vorab verschmolzen.
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

/** „2026-10-12 (Mon): 09:00-11:30, 14:00-18:00" — sprachneutral, ein Tag je Zeile. */
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

/** Eigene Kalender-Daten dürfen in Entwurfs-Prompts: Setting nicht aus + Kalender-Konto da. */
export function draftCalendarEnabled(db: Database.Database): boolean {
  if (getSetting('ai.draftUseCalendar') === '0') return false
  return !!db.prepare('SELECT 1 FROM cal_accounts LIMIT 1').get()
}

// Billige Erkennung „Mail fragt nach einem Termin / einer Uhrzeit".
const MEETING_ASK =
  /\b(termin|treffen|besprechung|meeting|telefonat|call|videocall|gespräch|kaffee|mittagessen|zeit(?:punkt|fenster)?|verfügbar|passt (?:es|dir|ihnen)|wann (?:hast|haben|passt|könnt|können)|vorschlag|appointment|schedule|reschedule|availability|available|catch up|get together|lunch|coffee|when (?:are|can|could|would|works)|works for you|free (?:on|at|for))\b/i

export function asksForMeeting(text: string, hasEventSuggestion: boolean): boolean {
  return hasEventSuggestion || MEETING_ASK.test(text)
}

export interface AvailabilityBlockInput {
  now: number
  zone?: string
  /** Text der letzten fremden Nachricht (ohne Zitate) */
  lastMessageText: string
  /** Gibt es für den Thread einen Terminvorschlag aus der Extraktion? */
  hasEventSuggestion: boolean
  /** Triage-Annotation needs_reply */
  needsReply?: boolean
}

/**
 * Prompt-Abschnitt mit den freien Zeitfenstern, oder null (Setting aus, kein
 * Kalender, Mail fragt nicht nach einem Termin, keine freien Fenster).
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
    return `\n\nVerfügbarkeit des Nutzers (Zeitzone ${zone}): In den nächsten 10 Arbeitstagen (08-18 Uhr) sind keine freien Zeitfenster vorhanden. Schlage keine konkreten Zeiten vor, sondern bitte um alternative Termine oder spätere Zeiträume.`
  }
  return `\n\nVerfügbarkeit des Nutzers: Die Mail fragt nach einem Termin. Unten stehen NUR die freien Zeitfenster des Nutzers (Zeitzone ${zone}, Arbeitstage, 08-18 Uhr), sonst nichts über den Kalender.
Schlage 2 bis 3 konkrete Zeiten ausschließlich aus dieser Liste vor (Datum, Wochentag, Uhrzeit) und erfinde keine anderen. Erwähne keine anderen Termine und keine Kalenderdetails.
<<<BEGIN FREIE ZEITFENSTER>>>
${lines.join('\n')}
<<<END FREIE ZEITFENSTER>>>`
}
