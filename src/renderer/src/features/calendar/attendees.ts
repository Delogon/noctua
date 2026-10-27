import type { CalendarAttendee } from '@shared/calendar-types'

// Attendee list of the event editor: add/remove/change role and the before/after
// comparison that determines who gets an invitation or a cancellation
// (mirrors the backend logic in src/main/calendar/organizer.ts).

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

/** Adds; invalid addresses, duplicates (case-insensitive) and own addresses are left out. */
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

/** Required or optional (CHAIR counts as required); everything else (e.g. NON-PARTICIPANT) stays "OTHER". */
export function roleOf(a: Pick<CalendarAttendee, 'role'>): AttendeeRole | 'OTHER' {
  const r = a.role.toUpperCase()
  if (r === 'OPT-PARTICIPANT') return 'OPT-PARTICIPANT'
  if (r === 'REQ-PARTICIPANT' || r === 'CHAIR' || r === '') return 'REQ-PARTICIPANT'
  return 'OTHER'
}

export interface AttendeeDiff {
  /** Newly invited: get an invitation (REQUEST) */
  added: string[]
  /** Removed: get a cancellation (CANCEL) */
  removed: string[]
  /** Remaining: get an update only if time/location changed */
  kept: string[]
}

/** Comparison of two attendee lists by address (lowercased, without duplicates). */
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

/** Are there attendees before or after the change? (Only then does the notify toggle make sense.) */
export function hasAnyAttendees(before: readonly unknown[], after: readonly unknown[]): boolean {
  return before.length > 0 || after.length > 0
}

/** My response (PARTSTAT) in the attendee list, otherwise null. */
export function myPartstat(
  list: readonly CalendarAttendee[],
  mine: ReadonlySet<string>
): string | null {
  const me = list.find((a) => mine.has(normEmail(a.email)))
  return me ? me.partstat.toUpperCase() : null
}
