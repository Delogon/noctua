import { z } from 'zod'
import { calendarAttendeeSchema, dateString } from './calendar-types'

/**
 * Invitations (iMIP/iTIP, phase 2.3): card data for the mail view, RSVP
 * and free/busy. The content comes from mails (untrusted) —
 * the description is plain text and truncated.
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
  /** Plain text, truncated */
  description: z.string().nullable(),
  organizer: z.object({ email: z.string(), name: z.string().nullable() }).nullable(),
  /** Mail sender is not the organizer (hint in the card) */
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
  /** The first attendees (max. 20) */
  attendees: z.array(calendarAttendeeSchema).max(20),
  myAddress: z.string().nullable(),
  myPartstat: z.string().nullable(),
  state: invitationStateSchema,
  respondedPartstat: z.string().nullable(),
  /** A newer invitation/cancellation for the same event exists, or calendar has higher SEQUENCE */
  outdated: z.boolean(),
  /** Event in the user's calendar (by UID) */
  localEvent: z
    .object({
      objectId: z.number(),
      calendarId: z.number(),
      calendarName: z.string(),
      myPartstat: z.string().nullable(),
      recurrenceId: z.string().nullable()
    })
    .nullable(),
  /** Suggested target calendar for "Accept" */
  suggestedCalendarId: z.number().nullable(),
  /** Server handles the reply itself (auto-schedule, event is already there) */
  serverHandlesReply: z.boolean(),
  /** REPLY: who replied and how */
  reply: z
    .object({ email: z.string(), name: z.string().nullable(), partstat: z.string() })
    .nullable()
})
export type InvitationView = z.infer<typeof invitationViewSchema>

export const invitationRespondInputSchema = z.object({
  invitationId: z.number().int(),
  partstat: rsvpPartstatSchema,
  comment: z.string().max(2000).optional(),
  /** Target calendar (only needed without an existing event) */
  calendarId: z.number().int().optional()
})
export type InvitationRespondInput = z.infer<typeof invitationRespondInputSchema>

export const invitationRespondOutputSchema = z.object({
  /** server = only PARTSTAT updated on the server (server sends), imip = reply mail sent, local = local only */
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
  /** server = via scheduling outbox, local = own calendars, unavailable = no information */
  source: z.enum(['server', 'local', 'unavailable']),
  busy: z.array(busyIntervalSchema),
  error: z.string().nullable()
})
export type FreeBusyResult = z.infer<typeof freeBusyResultSchema>

export const freeBusySelfInputSchema = z.object({
  rangeStart: z.number(),
  rangeEnd: z.number(),
  calendarIds: z.array(z.number().int()).max(200).optional(),
  /** Event that doesn't count as busy (the one being edited) */
  excludeObjectId: z.number().int().optional()
})

/** Scheduling context of the event editor: who am I, am I the organizer, is there an invitation. */
export const schedulingInfoInputSchema = z.object({
  calendarId: z.number().int(),
  objectId: z.number().int().optional()
})

export const schedulingInfoSchema = z.object({
  accountId: z.number().int(),
  /** Server sends invitations itself (calendar-auto-schedule) */
  autoSchedule: z.boolean(),
  /** Primary address of the calendar account (organizer of new events) */
  ownAddress: z.string().nullable(),
  /** All own addresses (lowercase) */
  myAddresses: z.array(z.string()),
  /** New event, no organizer, or organizer = me */
  organizerIsMe: z.boolean(),
  /** Invitation (iMIP) the event came from — for the RSVP buttons */
  invitation: z.object({ id: z.number().int(), myPartstat: z.string().nullable() }).nullable()
})
export type SchedulingInfo = z.infer<typeof schedulingInfoSchema>
