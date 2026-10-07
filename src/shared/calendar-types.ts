import { z } from 'zod'

/**
 * Gemeinsame Typen/Schemas des Kalenders (Phase 2.1). Zeiten:
 * - `startUtc`/`endUtc`: Millisekunden seit Epoch (UTC) — für Sortierung/Layout.
 * - Ganztägige Einträge tragen zusätzlich Kalendertage `startDay` (inklusiv) und
 *   `endDay` (EXKLUSIV) als 'YYYY-MM-DD'; die UI rendert sie nach diesen Tagen,
 *   nicht nach den UTC-Zeitstempeln.
 * - `CalendarEventTime` ist die editierbare Form (Wandzeit + TZID).
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
  /** Seit wann der Fehlerzustand besteht (ms) */
  errorSince: z.number().nullable(),
  lastSync: z.number().nullable(),
  /** Server unterstützt calendar-auto-schedule (RFC 6638) */
  autoSchedule: z.boolean(),
  calendarCount: z.number(),
  /** Lokale Änderungen, die noch auf die Übertragung warten */
  pendingOps: z.number(),
  /** Endgültig gescheiterte/verworfene Änderungen */
  deadOps: z.number()
})
export type CalendarAccountSummary = z.infer<typeof calendarAccountSummarySchema>

export const calendarSummarySchema = z.object({
  id: z.number(),
  accountId: z.number(),
  url: z.string(),
  displayName: z.string(),
  /** #RRGGBB (Nutzerfarbe vor Serverfarbe) oder null */
  color: z.string().nullable(),
  components: z.array(z.string()),
  readOnly: z.boolean(),
  visible: z.boolean(),
  order: z.number()
})
export type CalendarSummary = z.infer<typeof calendarSummarySchema>

/** Ergebnis von discover (noch nicht gespeichert). */
export const discoveredCalendarSchema = z.object({
  displayName: z.string(),
  color: z.string().nullable(),
  readOnly: z.boolean(),
  components: z.array(z.string())
})

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const wallDateTimeString = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)

/**
 * Editierbare Zeitangabe.
 * - allDay: `start`/`end` = 'YYYY-MM-DD', `end` exklusiv, `tzid` ignoriert (null).
 * - sonst: `start`/`end` = Wandzeit 'YYYY-MM-DDTHH:mm:ss' in `tzid`
 *   (IANA, z. B. 'Europe/Berlin'; 'UTC' → mit Z gespeichert; null → floating).
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
  /** Sekunden relativ zu START/END; negativ = davor */
  offsetSeconds: z.number().int().min(-31_536_000).max(31_536_000),
  /** Absoluter Alarm (UTC ms) — ersetzt dann offsetSeconds */
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

/** Felder, die beim Anlegen/Ändern gesetzt werden können. */
export const calendarEventFieldsSchema = z.object({
  summary: z.string().max(1000),
  location: z.string().max(1000).nullable(),
  description: z.string().max(50_000).nullable(),
  time: calendarEventTimeSchema,
  /** RRULE-Wert ohne Präfix, z. B. 'FREQ=WEEKLY;BYDAY=MO'; null = nicht wiederkehrend */
  rrule: z.string().max(500).nullable(),
  status: statusSchema.nullable(),
  /** OPAQUE = beschäftigt, TRANSPARENT = frei */
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

/** Teiländerung: nicht gesetzte Felder bleiben unverändert. */
export const calendarEventPatchSchema = calendarEventFieldsSchema.partial()
export type CalendarEventPatch = z.infer<typeof calendarEventPatchSchema>

export const calendarEditScopeSchema = z.enum(['this', 'following', 'all'])
export type CalendarEditScope = z.infer<typeof calendarEditScopeSchema>

/** Ein Vorkommen in einer Zeitspanne (Listenansicht). */
export const calendarInstanceSchema = z.object({
  /** Stabiler Schlüssel: `${objectId}:${recurrenceId ?? ''}` */
  key: z.string(),
  objectId: z.number(),
  calendarId: z.number(),
  /** Ursprünglicher Start dieses Vorkommens (UTC-ISO bzw. Datum); null = nicht wiederkehrend */
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
  /** Abweichendes Einzelvorkommen (RECURRENCE-ID) */
  isOverride: z.boolean(),
  /** Lokale Änderung noch nicht auf dem Server */
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
  /** Vorkommen, für das die Felder gelten (null = nicht wiederkehrend/Serie) */
  recurrenceId: z.string().nullable(),
  recurring: z.boolean(),
  isOverride: z.boolean(),
  startUtc: z.number(),
  endUtc: z.number(),
  startDay: dateString.nullable(),
  endDay: dateString.nullable(),
  fields: calendarEventFieldsSchema,
  /** EXDATE-Einträge (UTC-ISO/Datum) der Serie */
  exdates: z.array(z.string()),
  sequence: z.number()
})
export type CalendarEventDetail = z.infer<typeof calendarEventDetailSchema>
