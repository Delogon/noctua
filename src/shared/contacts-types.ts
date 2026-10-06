import { z } from 'zod'

/** CardDAV-Kontakte eines Kalender-Kontos (Phase 3.1, nur lesend). */
export const davAddressBookSchema = z.object({
  id: z.number(),
  displayName: z.string().max(500),
  enabled: z.boolean(),
  contactCount: z.number(),
  lastSync: z.number().nullable()
})

export const davContactsStatusSchema = z.object({
  enabled: z.boolean(),
  lastSync: z.number().nullable(),
  error: z.string().max(1000).nullable(),
  addressBooks: z.array(davAddressBookSchema)
})
export type DavContactsStatus = z.infer<typeof davContactsStatusSchema>
