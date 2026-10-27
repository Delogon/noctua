import { z } from 'zod'

/** Event suggestion from a mail (AI extraction), as seen by the renderer. */
export const eventSuggestionViewSchema = z.object({
  id: z.number().int(),
  messageId: z.number().int(),
  title: z.string(),
  allDay: z.boolean(),
  /** Wall time 'YYYY-MM-DDTHH:mm:ss', or 'YYYY-MM-DD' for all-day */
  startLocal: z.string(),
  /** EXCLUSIVE for all-day (as in the backend) */
  endLocal: z.string(),
  /** Stated IANA zone; null = user's time zone */
  tzid: z.string().nullable(),
  location: z.string().nullable(),
  link: z.string().nullable(),
  kind: z.enum(['proposed', 'confirmed']),
  confidence: z.number(),
  state: z.enum(['new', 'accepted']),
  objectId: z.number().int().nullable(),
  /** Default calendar for creating (null = no writable calendar) */
  calendarId: z.number().int().nullable()
})
export type EventSuggestionView = z.infer<typeof eventSuggestionViewSchema>
