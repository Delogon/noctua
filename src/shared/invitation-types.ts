import { z } from 'zod'
import { calendarAttendeeSchema, dateString } from './calendar-types'

/**
 * Einladungen (iMIP/iTIP, Phase 2.3): Kartendaten für die Mail-Ansicht, RSVP
 * und Free/Busy. Der Inhalt stammt aus Mails (nicht vertrauenswürdig) —
 * Beschreibung ist Klartext und gekürzt.
 */

export const invitationMethodSchema = z.enum([
  'REQUEST',
  'CANCEL',
  'REPLY',
  'COUNTER',
  'DECLINECOUNTER',
  'ADD',
  'REFRESH',
  'PUBLISH'
])
export type InvitationMethod = z.infer<typeof invitationMethodSchema>

export const rsvpPartstatSchema = z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED'])
export type RsvpPartstat = z.infer<typeof rsvpPartstatSchema>

export const invitationStateSchema = z.enum([
  'new',
  'responded',
  'removed',
  'reply-applied',
  'reply-ignored',
  'ignored'
])

export const invitationViewSchema = z.object({
  id: z.number(),
  messageId: z.number(),
  method: invitationMethodSchema,
  uid: z.string(),
  sequence: z.number(),
  summary: z.string().nullable(),
  location: z.string().nullable(),
  /** Klartext, gekürzt */
  description: z.string().nullable(),
  organizer: z.object({ email: z.string(), name: z.string().nullable() }).nullable(),
  /** Absender der Mail ist nicht der Organisator (Hinweis in der Karte) */
  senderMismatch: z.boolean(),
  startUtc: z.number().nullable(),
  endUtc: z.number().nullable(),
  allDay: z.boolean(),
  startDay: dateString.nullable(),
  endDay: dateString.nullable(),
  tzid: z.string().nullable(),
  rrule: z.string().nullable(),
  recurrenceId: z.string().nullable(),
  attendeeCount: z.number(),
  /** Die ersten Teilnehmer (max. 20) */
  attendees: z.array(calendarAttendeeSchema).max(20),
  myAddress: z.string().nullable(),
  myPartstat: z.string().nullable(),
  state: invitationStateSchema,
  respondedPartstat: z.string().nullable(),
  /** Neuere Einladung/Absage zum selben Termin liegt vor bzw. Kalender hat höhere SEQUENCE */
  outdated: z.boolean(),
  /** Termin im Kalender des Nutzers (per UID) */
  localEvent: z
    .object({
      objectId: z.number(),
      calendarId: z.number(),
      calendarName: z.string(),
      myPartstat: z.string().nullable(),
      recurrenceId: z.string().nullable()
    })
    .nullable(),
  /** Vorgeschlagener Zielkalender für „Annehmen" */
  suggestedCalendarId: z.number().nullable(),
  /** Server erledigt die Antwort selbst (auto-schedule, Termin liegt schon dort) */
  serverHandlesReply: z.boolean(),
  /** REPLY: wer hat wie geantwortet */
  reply: z
    .object({ email: z.string(), name: z.string().nullable(), partstat: z.string() })
    .nullable()
})
export type InvitationView = z.infer<typeof invitationViewSchema>

export const invitationRespondInputSchema = z.object({
  invitationId: z.number().int(),
  partstat: rsvpPartstatSchema,
  comment: z.string().max(2000).optional(),
  /** Zielkalender (nur ohne vorhandenen Termin nötig) */
  calendarId: z.number().int().optional()
})
export type InvitationRespondInput = z.infer<typeof invitationRespondInputSchema>

export const invitationRespondOutputSchema = z.object({
  /** server = nur PARTSTAT auf dem Server aktualisiert (Server sendet), imip = Antwortmail verschickt, local = nur lokal */
  path: z.enum(['server', 'imip', 'local']),
  objectId: z.number().nullable(),
  mailQueued: z.boolean()
})

export const busyIntervalSchema = z.object({
  startUtc: z.number(),
  endUtc: z.number(),
  type: z.enum(['BUSY', 'BUSY-TENTATIVE', 'BUSY-UNAVAILABLE'])
})
export type BusyIntervalDto = z.infer<typeof busyIntervalSchema>

export const freeBusyInputSchema = z.object({
  accountId: z.number().int(),
  attendees: z.array(z.string().max(320)).min(1).max(50),
  rangeStart: z.number(),
  rangeEnd: z.number()
})

export const freeBusyResultSchema = z.object({
  email: z.string(),
  /** server = per Scheduling-Outbox, local = eigene Kalender, unavailable = keine Auskunft */
  source: z.enum(['server', 'local', 'unavailable']),
  busy: z.array(busyIntervalSchema),
  error: z.string().nullable()
})
export type FreeBusyResult = z.infer<typeof freeBusyResultSchema>

export const freeBusySelfInputSchema = z.object({
  rangeStart: z.number(),
  rangeEnd: z.number(),
  calendarIds: z.array(z.number().int()).max(200).optional(),
  /** Termin, der nicht als belegt zählt (der gerade bearbeitete) */
  excludeObjectId: z.number().int().optional()
})

/** Scheduling-Kontext des Termin-Editors: wer bin ich, bin ich Organisator, gibt es eine Einladung. */
export const schedulingInfoInputSchema = z.object({
  calendarId: z.number().int(),
  objectId: z.number().int().optional()
})

export const schedulingInfoSchema = z.object({
  accountId: z.number().int(),
  /** Server verschickt Einladungen selbst (calendar-auto-schedule) */
  autoSchedule: z.boolean(),
  /** Hauptadresse des Kalender-Kontos (Organisator neuer Termine) */
  ownAddress: z.string().nullable(),
  /** Alle eigenen Adressen (kleingeschrieben) */
  myAddresses: z.array(z.string()),
  /** Neuer Termin, kein Organisator oder Organisator = ich */
  organizerIsMe: z.boolean(),
  /** Einladung (iMIP), aus der der Termin stammt — für die RSVP-Knöpfe */
  invitation: z.object({ id: z.number().int(), myPartstat: z.string().nullable() }).nullable()
})
export type SchedulingInfo = z.infer<typeof schedulingInfoSchema>
