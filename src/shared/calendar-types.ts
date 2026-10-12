import { z } from 'zod'

/**
 * Shared calendar types/schemas (phase 2.1). Times:
 * - `startUtc`/`endUtc`: milliseconds since epoch (UTC) — for sorting/layout.
 * - All-day entries additionally carry calendar days `startDay` (inclusive) and
 *   `endDay` (EXCLUSIVE) as 'YYYY-MM-DD'; the UI renders them by these days,
 *   not by the UTC timestamps.
 * - `CalendarEventTime` is the editable form (wall time + TZID).
 */

export const calendarAccountStateSchema = z.enum([
  'idle',
  'connecting',
  'syncing',
  'error',
  'needs-reauth',
  'off'
])
export type CalendarAccountState = z.infer<typeof calendarAccountStateSchema>

export const calendarAccountSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  serverUrl: z.string(),
  username: z.string(),
  mailAccountId: z.number().nullable(),
  state: calendarAccountStateSchema,
  lastError: z.string().nullable(),
  /** Since when the error state has existed (ms) */
  errorSince: z.number().nullable(),
  lastSync: z.number().nullable(),
  /** Server supports calendar-auto-schedule (RFC 6638) */
  autoSchedule: z.boolean(),
  calendarCount: z.number(),
  /** Local changes still waiting to be uploaded */
  pendingOps: z.number(),
  /** Permanently failed/discarded changes */
  deadOps: z.number()
})
export type CalendarAccountSummary = z.infer<typeof calendarAccountSummarySchema>

export const calendarSummarySchema = z.object({
  id: z.number(),
  accountId: z.number(),
  url: z.string(),
  displayName: z.string(),
  /** #RRGGBB (user color over server color) or null */
  color: z.string().nullable(),
  components: z.array(z.string()),
  readOnly: z.boolean(),
  visible: z.boolean(),
  order: z.number()
})
export type CalendarSummary = z.infer<typeof calendarSummarySchema>

/** Result of discover (not saved yet). */
export const discoveredCalendarSchema = z.object({
  displayName: z.string(),
  color: z.string().nullable(),
  readOnly: z.boolean(),
  components: z.array(z.string())
})

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const wallDateTimeString = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)

/**
 * Editable time specification.
 * - allDay: `start`/`end` = 'YYYY-MM-DD', `end` exclusive, `tzid` ignored (null).
 * - otherwise: `start`/`end` = wall time 'YYYY-MM-DDTHH:mm:ss' in `tzid`
 *   (IANA, e.g. 'Europe/Berlin'; 'UTC' → stored with Z; null → floating).
 */
export const calendarEventTimeSchema = z.object({
  allDay: z.boolean(),
  start: z.string().max(19),
  end: z.string().max(19),
  tzid: z.string().max(100).nullable()
})
export type CalendarEventTime = z.infer<typeof calendarEventTimeSchema>

export const calendarAlarmSchema = z.object({
  action: z.enum(['DISPLAY', 'AUDIO', 'EMAIL']),
  relativeTo: z.enum(['START', 'END']),
  /** Seconds relative to START/END; negative = before */
  offsetSeconds: z.number().int().min(-31_536_000).max(31_536_000),
  /** Absolute alarm (UTC ms) — replaces offsetSeconds in that case */
  absoluteUtc: z.number().nullable(),
  description: z.string().max(1000).nullable()
})
export type CalendarAlarm = z.infer<typeof calendarAlarmSchema>

export const calendarAttendeeSchema = z.object({
  email: z.string().max(320),
  name: z.string().max(200).nullable(),
  role: z.string().max(30),
  partstat: z.string().max(30),
  rsvp: z.boolean(),
  cutype: z.string().max(30)
})
export type CalendarAttendee = z.infer<typeof calendarAttendeeSchema>

export const calendarOrganizerSchema = z.object({
  email: z.string().max(320),
  name: z.string().max(200).nullable()
})

const statusSchema = z.enum(['CONFIRMED', 'TENTATIVE', 'CANCELLED'])

/** Fields that can be set when creating/editing. */
export const calendarEventFieldsSchema = z.object({
  summary: z.string().max(1000),
  location: z.string().max(1000).nullable(),
  description: z.string().max(50_000).nullable(),
  time: calendarEventTimeSchema,
  /** RRULE value without prefix, e.g. 'FREQ=WEEKLY;BYDAY=MO'; null = not recurring */
  rrule: z.string().max(500).nullable(),
  status: statusSchema.nullable(),
  /** OPAQUE = busy, TRANSPARENT = free */
  transparency: z.enum(['OPAQUE', 'TRANSPARENT']).nullable(),
  alarms: z.array(calendarAlarmSchema).max(20),
  attendees: z.array(calendarAttendeeSchema).max(200),
  organizer: calendarOrganizerSchema.nullable()
})
export type CalendarEventFields = z.infer<typeof calendarEventFieldsSchema>

export const calendarEventInputSchema = calendarEventFieldsSchema.extend({
  calendarId: z.number().int()
})
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>

/** Partial update: unset fields stay unchanged. */
export const calendarEventPatchSchema = calendarEventFieldsSchema.partial()
export type CalendarEventPatch = z.infer<typeof calendarEventPatchSchema>

export const calendarEditScopeSchema = z.enum(['this', 'following', 'all'])
export type CalendarEditScope = z.infer<typeof calendarEditScopeSchema>

/** One occurrence within a time range (list view). */
export const calendarInstanceSchema = z.object({
  /** Stable key: `${objectId}:${recurrenceId ?? ''}` */
  key: z.string(),
  objectId: z.number(),
  calendarId: z.number(),
  /** Original start of this occurrence (UTC ISO or date); null = not recurring */
  recurrenceId: z.string().nullable(),
  startUtc: z.number(),
  endUtc: z.number(),
  allDay: z.boolean(),
  startDay: dateString.nullable(),
  endDay: dateString.nullable(),
  summary: z.string(),
  location: z.string().nullable(),
  status: z.string().nullable(),
  recurring: z.boolean(),
  /** Modified single occurrence (RECURRENCE-ID) */
  isOverride: z.boolean(),
  /** Local change not yet on the server */
  pending: z.boolean(),
  readOnly: z.boolean()
})
export type CalendarInstance = z.infer<typeof calendarInstanceSchema>

export const calendarEventDetailSchema = z.object({
  objectId: z.number(),
  calendarId: z.number(),
  uid: z.string(),
  etag: z.string().nullable(),
  readOnly: z.boolean(),
  pending: z.boolean(),
  /** Occurrence the fields apply to (null = not recurring/series) */
  recurrenceId: z.string().nullable(),
  recurring: z.boolean(),
  isOverride: z.boolean(),
  startUtc: z.number(),
  endUtc: z.number(),
  startDay: dateString.nullable(),
  endDay: dateString.nullable(),
  fields: calendarEventFieldsSchema,
  /** EXDATE entries (UTC ISO/date) of the series */
  exdates: z.array(z.string()),
  sequence: z.number()
})
export type CalendarEventDetail = z.infer<typeof calendarEventDetailSchema>
