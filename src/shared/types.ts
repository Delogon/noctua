import { z } from 'zod'

/** DTO-Schemas — Single Source of Truth für IPC-Payloads (zod) und TS-Typen (z.infer). */

export const recipientSchema = z.object({
  name: z.string().nullable(),
  address: z.string()
})

export const accountSummarySchema = z.object({
  id: z.number(),
  email: z.string(),
  accountName: z.string(),
  displayName: z.string().nullable(),
  provider: z.enum(['gmail', 'microsoft', 'proton', 'imap']),
  /** Wie sich das Konto anmeldet — bestimmt „Passwort neu eingeben" vs. „Erneut anmelden". */
  credentialType: z.enum(['password', 'oauth-ms', 'oauth-google', 'bridge']).default('password'),
  color: z.string(),
  syncState: z.enum(['idle', 'connecting', 'syncing', 'error', 'needs-reauth', 'off']),
  lastError: z.string().nullable(),
  /** Seit wann der aktuelle Fehlerzustand besteht (Design 3b: „since 11:42"). */
  errorSince: z.number().nullable().default(null),
  signature: z.string().nullable(),
  threadCount: z.number().default(0),
  /** Anzahl Mails — nutzerfreundlicher als Threads (Onboarding/Einstellungen). */
  messageCount: z.number().default(0),
  /** Sync-Zeitraum in Tagen: 0 = alles, null = Standard (90/183). */
  syncDays: z.number().int().nullable().default(null)
})

export const aiCategorySchema = z.enum([
  'personal',
  'work',
  'newsletter',
  'promotions',
  'notifications',
  'transactional',
  'other'
])

export const threadListItemSchema = z.object({
  threadKey: z.string(),
  accountId: z.number(),
  accountColor: z.string(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  fromNames: z.array(z.string()),
  toNames: z.array(z.string()),
  date: z.number(),
  messageCount: z.number(),
  unread: z.boolean(),
  flagged: z.boolean(),
  hasAttachments: z.boolean(),
  aiCategory: aiCategorySchema.nullable(),
  aiPriority: z.number().nullable(),
  aiSummary: z.string().nullable(),
  needsReply: z.boolean(),
  // Letterpress (M19): Task-Vorschlag der Eule + Zustand des Vorschlags
  suggestedTask: z.object({ label: z.string(), due: z.string().nullable() }).nullable(),
  taskState: z.enum(['suggested', 'accepted', 'dismissed', 'none'])
})

/**
 * Treffer der lokalen Hybrid-Suche. Die Treffer bleiben absichtlich auf
 * Nachrichtenebene: Datum, Absender und Belegstelle gehören so garantiert
 * zur tatsächlich gefundenen Nachricht und nicht nur zu ihrem Thread.
 */
export const semanticSearchSignalSchema = z.enum(['semantic', 'fulltext', 'subject', 'sender'])

export const semanticSearchHitSchema = z.object({
  messageId: z.number(),
  threadKey: z.string(),
  accountId: z.number(),
  accountName: z.string(),
  mailbox: z.enum(['inbox', 'sent', 'archive', 'other']),
  subject: z.string().nullable(),
  fromName: z.string().nullable(),
  fromAddr: z.string().nullable(),
  date: z.number().nullable(),
  excerpt: z.string(),
  signals: z.array(semanticSearchSignalSchema),
  confidence: z.enum(['clear', 'possible'])
})

export const semanticSearchIndexSchema = z.object({
  /** Suchbare Nachrichten ohne Spam, Papierkorb und Entwürfe. */
  totalMessages: z.number().int().nonnegative(),
  /** Nachrichten, deren Inhalt im lokalen Volltextindex liegt. */
  searchableMessages: z.number().int().nonnegative(),
  /** Nachrichten mit lokalem Vektor im semantischen Index. */
  embeddedMessages: z.number().int().nonnegative(),
  /** Anteil semantisch indexierter Nachrichten von 0 bis 1. */
  coverage: z.number().min(0).max(1),
  ready: z.boolean()
})

/**
 * Eulen-Gespräch (Owl-View): der Verlauf wird als JSON in owl_conversations
 * persistiert. Quellen tragen optional Konto/Ordner/Datum aus den Live-Treffern
 * zum Frage-Zeitpunkt — für die SOURCES-Karte nach einem Neustart.
 */
export const owlSourceSchema = z.object({
  index: z.number().int(),
  threadKey: z.string().max(512),
  subject: z.string().nullable(),
  accountName: z.string().optional(),
  mailbox: z.enum(['inbox', 'sent', 'archive', 'other']).optional(),
  date: z.number().nullable().optional()
})

export const owlMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(100_000),
  /** Zeitstempel des Beitrags — optional, für „DU · 14:34“-Zeilen. */
  at: z.number().optional(),
  sources: z.array(owlSourceSchema).optional()
})

export const owlConversationSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  messages: z.array(owlMessageSchema),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const owlConversationListItemSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  updatedAt: z.number(),
  /** Erster Satz der ersten Eulen-Antwort — die ↳-Zeile der Gesprächsliste. */
  answerGist: z.string().nullable()
})

export const attachmentInfoSchema = z.object({
  id: z.number(),
  filename: z.string().nullable(),
  mimeType: z.string().nullable(),
  size: z.number().nullable()
})

export const messageDetailSchema = z.object({
  id: z.number(),
  accountId: z.number(),
  folderId: z.number(),
  subject: z.string().nullable(),
  fromName: z.string().nullable(),
  fromAddr: z.string().nullable(),
  to: z.array(recipientSchema),
  cc: z.array(recipientSchema),
  /** Reply-To-Header (Envelope) — Antworten gehen hierhin statt an From. */
  replyTo: z.array(recipientSchema),
  date: z.number().nullable(),
  seen: z.boolean(),
  flagged: z.boolean(),
  hasAttachments: z.boolean(),
  bodyText: z.string().nullable(),
  /** Roh-HTML aus der DB; Sanitizing (DOMPurify) passiert im Renderer vor dem Rendern. */
  bodyHtml: z.string().nullable(),
  bodyState: z.enum(['none', 'full']),
  attachments: z.array(attachmentInfoSchema),
  /** Remote-Bilder für diesen Absender freigegeben (Sender-Allowlist). */
  remoteImagesAllowed: z.boolean(),
  listUnsubscribe: z.boolean()
})

export const mailAuthenticationStatusSchema = z.enum([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'temperror',
  'permerror',
  'none',
  'unknown'
])

export const mailHeaderEntrySchema = z.object({
  name: z.string(),
  value: z.string()
})

/**
 * Lazy geladene Original-Kopfdaten. Sie bleiben lokal und werden weder in den
 * Suchindex noch in AI-Prompts aufgenommen. Auth-Resultate sind Hinweise aus
 * dem Header, kein eigenes Sicherheitsurteil von Noctua.
 */
export const messageHeaderDetailsSchema = z.object({
  messageId: z.number(),
  technicalAvailable: z.boolean(),
  from: z.array(recipientSchema),
  sender: z.array(recipientSchema),
  to: z.array(recipientSchema),
  cc: z.array(recipientSchema),
  bcc: z.array(recipientSchema),
  replyTo: z.array(recipientSchema),
  subject: z.string().nullable(),
  sentAt: z.number().nullable(),
  receivedAt: z.number().nullable(),
  size: z.number().nullable(),
  messageIdHeader: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  returnPath: z.string().nullable(),
  deliveredTo: z.array(z.string()),
  authentication: z.object({
    spf: mailAuthenticationStatusSchema,
    dkim: mailAuthenticationStatusSchema,
    dmarc: mailAuthenticationStatusSchema,
    mailedBy: z.string().nullable(),
    signedBy: z.string().nullable(),
    reportedBy: z.string().nullable(),
    headers: z.array(mailHeaderEntrySchema)
  }),
  received: z.array(z.string()),
  spamHeaders: z.array(mailHeaderEntrySchema),
  rawHeaders: z
    .string()
    .max(512 * 1024)
    .nullable(),
  rawHeadersTruncated: z.boolean()
})

export const messageActionSchema = z.enum([
  'markRead',
  'markUnread',
  'flag',
  'unflag',
  'archive',
  'delete',
  // Spam zurück in den Eingang (Ordner-Filter M31)
  'notSpam'
])

export const taskItemSchema = z.object({
  id: z.number(),
  sourceKind: z.enum(['mail', 'signal', 'manual']),
  threadKey: z.string().nullable(),
  accountColor: z.string().nullable(),
  title: z.string(),
  notes: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(['open', 'done', 'dismissed']),
  createdAt: z.number(),
  sourceSubject: z.string().nullable(),
  sourceMessageId: z.number().nullable(),
  /** CalDAV-Abgleich (Phase 3.2); null/fehlend = nicht zugeordnet */
  syncState: z.enum(['pending', 'synced', 'conflict']).nullable().optional()
})

/** Gespeicherter Antwort-Entwurf (ein Entwurf je Thread, Eulen-Leiste). */
export const draftItemSchema = z.object({
  threadKey: z.string(),
  displayName: z.string().nullable(),
  subject: z.string().nullable(),
  text: z.string(),
  html: z.string(),
  updatedAt: z.number()
})

export type Recipient = z.infer<typeof recipientSchema>
/** Eine Netzwerkverbindung der App (Technik-Seite, Abschnitt „Netzwerkverbindungen"). */
export const networkConnectionSchema = z.object({
  kind: z.enum(['mail', 'oauth', 'ai', 'updates', 'embeddings', 'calendar']),
  /** Konto/Profil/Anbieter; leer bei updates und embeddings */
  label: z.string().max(200),
  /** Zielhost; null, wenn nichts verbunden wird (Update-Check aus) */
  host: z.string().max(255).nullable(),
  scope: z.enum(['external', 'local']),
  status: z.enum(['active', 'blocked', 'manual-only', 'on-demand', 'cached', 'off']),
  /** nur bei kind = ai: bediente Aufgaben */
  tasks: z.array(z.enum(['triage', 'draft', 'stt', 'decision'])).max(4)
})
export const networkConnectionsSchema = z.object({
  localOnly: z.boolean(),
  connections: z.array(networkConnectionSchema).max(200)
})

export type NetworkConnection = z.infer<typeof networkConnectionSchema>
export type AccountSummary = z.infer<typeof accountSummarySchema>
export type DraftItem = z.infer<typeof draftItemSchema>
export type ThreadListItem = z.infer<typeof threadListItemSchema>
export type SemanticSearchSignal = z.infer<typeof semanticSearchSignalSchema>
export type SemanticSearchHit = z.infer<typeof semanticSearchHitSchema>
export type SemanticSearchIndex = z.infer<typeof semanticSearchIndexSchema>
export type OwlSource = z.infer<typeof owlSourceSchema>
export type OwlMessage = z.infer<typeof owlMessageSchema>
export type OwlConversation = z.infer<typeof owlConversationSchema>
export type OwlConversationListItem = z.infer<typeof owlConversationListItemSchema>
export type AttachmentInfo = z.infer<typeof attachmentInfoSchema>
export type MessageDetail = z.infer<typeof messageDetailSchema>
export type MailAuthenticationStatus = z.infer<typeof mailAuthenticationStatusSchema>
export type MessageHeaderDetails = z.infer<typeof messageHeaderDetailsSchema>
export type MessageAction = z.infer<typeof messageActionSchema>
export type AiCategory = z.infer<typeof aiCategorySchema>
export type TaskItem = z.infer<typeof taskItemSchema>

export const ACCOUNT_COLORS = ['#7c7ff2', '#5ecf8a', '#f2b16d', '#6dc7f2', '#f26d7c', '#c98df2']

/** Pastell-Palette fürs Letterpress-Papier — Konto-Badges & Picker (M22). */
export const PASTEL_COLORS = [
  '#e8b4b8', // staubiges Rosa
  '#b5c9a8', // Salbei
  '#c3b8e0', // Flieder
  '#e6cf9f', // Sand
  '#a8c5d8', // Graublau
  '#e8c4a8', // Pfirsich
  '#a8d8c5', // Mint
  '#d8a8c9', // Mauve
  '#d9d3a7', // heller Ocker
  '#b8c4e0' // Taubenblau
]

/** Lesbare Textfarbe auf einer Badge-Farbe (Pastell → Tinte, dunkel → Papier). */
export function contrastOn(hex: string): string {
  const v = hex.replace('#', '')
  if (v.length < 6) return '#17150F'
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum > 150 ? '#17150F' : '#F4F1EA'
}
