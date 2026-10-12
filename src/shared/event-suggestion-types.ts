import { z } from 'zod'

/** Terminvorschlag aus einer Mail (AI-Extraktion), wie ihn der Renderer sieht. */
export const eventSuggestionViewSchema = z.object({
  id: z.number().int(),
  messageId: z.number().int(),
  title: z.string(),
  allDay: z.boolean(),
  /** Wandzeit 'YYYY-MM-DDTHH:mm:ss' bzw. bei ganztägig 'YYYY-MM-DD' */
  startLocal: z.string(),
  /** Bei ganztägig EXKLUSIV (wie im Backend) */
  endLocal: z.string(),
  /** Genannte IANA-Zone; null = Zeitzone des Nutzers */
  tzid: z.string().nullable(),
  location: z.string().nullable(),
  link: z.string().nullable(),
  kind: z.enum(['proposed', 'confirmed']),
  confidence: z.number(),
  state: z.enum(['new', 'accepted']),
  objectId: z.number().int().nullable(),
  /** Standard-Kalender zum Anlegen (null = kein beschreibbarer Kalender) */
  calendarId: z.number().int().nullable()
})
export type EventSuggestionView = z.infer<typeof eventSuggestionViewSchema>
