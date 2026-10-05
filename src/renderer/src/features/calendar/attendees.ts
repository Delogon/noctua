import type { CalendarAttendee } from '@shared/calendar-types'

// Teilnehmerliste des Termin-Editors: hinzufügen/entfernen/Rolle ändern und der Vergleich
// vorher/nachher, aus dem sich ergibt, wer eine Einladung oder eine Absage bekommt
// (spiegelt die Logik des Backends in src/main/calendar/organizer.ts).

export type AttendeeRole = 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT'

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/

export function normEmail(raw: string): string {
  return raw
    .trim()
    .replace(/^mailto:/i, '')
    .toLowerCase()
}

export function isValidAttendeeEmail(raw: string): boolean {
  return EMAIL_RE.test(normEmail(raw))
}

export function newAttendee(email: string, name: string | null = null): CalendarAttendee {
  return {
    email: normEmail(email),
    name: name?.trim() || null,
    role: 'REQ-PARTICIPANT',
    partstat: 'NEEDS-ACTION',
    rsvp: true,
    cutype: 'INDIVIDUAL'
  }
}

/** Fügt hinzu; ungültige Adressen, Duplikate (ohne Groß-/Kleinschreibung) und die eigenen Adressen bleiben draußen. */
export function addAttendee(
  list: readonly CalendarAttendee[],
  email: string,
  name: string | null = null,
  mine: ReadonlySet<string> = new Set()
): CalendarAttendee[] {
  const e = normEmail(email)
  if (!EMAIL_RE.test(e) || mine.has(e) || list.some((a) => normEmail(a.email) === e)) {
    return [...list]
  }
  return [...list, newAttendee(e, name)]
}

export function removeAttendee(
  list: readonly CalendarAttendee[],
  email: string
): CalendarAttendee[] {
  const e = normEmail(email)
  return list.filter((a) => normEmail(a.email) !== e)
}

export function setAttendeeRole(
  list: readonly CalendarAttendee[],
  email: string,
  role: AttendeeRole
): CalendarAttendee[] {
  const e = normEmail(email)
  return list.map((a) => (normEmail(a.email) === e ? { ...a, role } : a))
}

/** Pflicht oder optional (CHAIR zählt als Pflicht); alles andere (z. B. NON-PARTICIPANT) bleibt „OTHER". */
export function roleOf(a: Pick<CalendarAttendee, 'role'>): AttendeeRole | 'OTHER' {
  const r = a.role.toUpperCase()
  if (r === 'OPT-PARTICIPANT') return 'OPT-PARTICIPANT'
  if (r === 'REQ-PARTICIPANT' || r === 'CHAIR' || r === '') return 'REQ-PARTICIPANT'
  return 'OTHER'
}

export interface AttendeeDiff {
  /** Neu eingeladen: bekommen eine Einladung (REQUEST) */
  added: string[]
  /** Entfernt: bekommen eine Absage (CANCEL) */
  removed: string[]
  /** Bleiben: bekommen nur bei geänderter Zeit/Ort ein Update */
  kept: string[]
}

/** Vergleich zweier Teilnehmerlisten nach Adresse (kleingeschrieben, ohne Duplikate). */
export function diffAttendees(
  before: readonly Pick<CalendarAttendee, 'email'>[],
  after: readonly Pick<CalendarAttendee, 'email'>[]
): AttendeeDiff {
  const b = new Set(before.map((a) => normEmail(a.email)))
  const a = new Set(after.map((x) => normEmail(x.email)))
  return {
    added: [...a].filter((e) => !b.has(e)),
    removed: [...b].filter((e) => !a.has(e)),
    kept: [...a].filter((e) => b.has(e))
  }
}

/** Gibt es vor oder nach der Änderung Teilnehmer? (Nur dann ist der Benachrichtigungs-Schalter sinnvoll.) */
export function hasAnyAttendees(before: readonly unknown[], after: readonly unknown[]): boolean {
  return before.length > 0 || after.length > 0
}

/** Meine Antwort (PARTSTAT) in der Teilnehmerliste, sonst null. */
export function myPartstat(
  list: readonly CalendarAttendee[],
  mine: ReadonlySet<string>
): string | null {
  const me = list.find((a) => mine.has(normEmail(a.email)))
  return me ? me.partstat.toUpperCase() : null
}
