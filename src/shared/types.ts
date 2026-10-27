import { z } from 'zod'

/** DTO schemas — single source of truth for IPC payloads (zod) and TS types (z.infer). */

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
  /** How the account signs in — decides "Re-enter password" vs. "Sign in again". */
  credentialType: z.enum(['password', 'oauth-ms', 'oauth-google', 'bridge']).default('password'),
  color: z.string(),
  syncState: z.enum(['idle', 'connecting', 'syncing', 'error', 'needs-reauth', 'off']),
  lastError: z.string().nullable(),
  /** Since when the current error state has existed (design 3b: "since 11:42"). */
  errorSince: z.number().nullable().default(null),
  signature: z.string().nullable(),
  threadCount: z.number().default(0),
  /** Number of mails — more user-friendly than threads (onboarding/settings). */
  messageCount: z.number().default(0),
  /** Sync range in days: 0 = everything, null = default (90/183). */
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

/** A folder in the folder view (only fully synced folders). */
export const folderListItemSchema = z.object({
  id: z.number(),
  accountId: z.number(),
  path: z.string(),
  name: z.string(),
  delimiter: z.string().nullable(),
  role: z.enum(['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'other']),
  threadCount: z.number(),
  unreadCount: z.number()
})

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
  // Letterpress (M19): the owl's task suggestion + state of the suggestion
  suggestedTask: z.object({ label: z.string(), due: z.string().nullable() }).nullable(),
  taskState: z.enum(['suggested', 'accepted', 'dismissed', 'none'])
})

/**
 * Hit of the local hybrid search. Hits deliberately stay at message
 * level: date, sender and evidence are thus guaranteed to belong to the
 * message actually found and not just to its thread.
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
  /** Searchable messages excluding spam, trash and drafts. */
  totalMessages: z.number().int().nonnegative(),
  /** Messages whose content is in the local full-text index. */
  searchableMessages: z.number().int().nonnegative(),
  /** Messages with a local vector in the semantic index. */
  embeddedMessages: z.number().int().nonnegative(),
  /** Share of semantically indexed messages from 0 to 1. */
  coverage: z.number().min(0).max(1),
  ready: z.boolean()
})

/**
 * Owl conversation (owl view): the history is persisted as JSON in owl_conversations.
 * Sources optionally carry account/folder/date from the live hits at the time
 * of the question — for the SOURCES card after a restart.
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
  /** Timestamp of the entry — optional, for "YOU · 14:34" lines. */
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
  /** First sentence of the first owl answer — the ↳ line of the conversation list. */
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
  /** Reply-To header (envelope) — replies go here instead of to From. */
  replyTo: z.array(recipientSchema),
  date: z.number().nullable(),
  seen: z.boolean(),
  flagged: z.boolean(),
  hasAttachments: z.boolean(),
  bodyText: z.string().nullable(),
  /** Raw HTML from the DB; sanitizing (DOMPurify) happens in the renderer before rendering. */
  bodyHtml: z.string().nullable(),
  bodyState: z.enum(['none', 'full']),
  attachments: z.array(attachmentInfoSchema),
  /** Remote images allowed for this sender (sender allowlist). */
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
 * Lazily loaded original header data. It stays local and is added neither to the
 * search index nor to AI prompts. Auth results are hints from the
 * header, not Noctua's own security verdict.
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
  // Spam back to the inbox (folder filter M31)
  'notSpam',
  // Report as spam: move to the junk folder (classic command bar)
  'spam'
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
  /** CalDAV sync (phase 3.2); null/missing = not assigned */
  syncState: z.enum(['pending', 'synced', 'conflict']).nullable().optional()
})

/** Saved reply draft (one draft per thread, owl bar). */
export const draftItemSchema = z.object({
  threadKey: z.string(),
  displayName: z.string().nullable(),
  subject: z.string().nullable(),
  text: z.string(),
  html: z.string(),
  updatedAt: z.number()
})

export type Recipient = z.infer<typeof recipientSchema>
/** A network connection of the app (technical page, "Network connections" section). */
export const networkConnectionSchema = z.object({
  kind: z.enum(['mail', 'oauth', 'ai', 'updates', 'embeddings', 'calendar']),
  /** Account/profile/provider; empty for updates and embeddings */
  label: z.string().max(200),
  /** Target host; null if nothing connects (update check off) */
  host: z.string().max(255).nullable(),
  scope: z.enum(['external', 'local']),
  status: z.enum(['active', 'blocked', 'manual-only', 'on-demand', 'cached', 'off']),
  /** only for kind = ai: tasks served */
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
export type FolderListItem = z.infer<typeof folderListItemSchema>
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

/** Pastel palette for the letterpress paper — account badges & picker (M22). */
export const PASTEL_COLORS = [
  '#e8b4b8', // dusty rose
  '#b5c9a8', // sage
  '#c3b8e0', // lilac
  '#e6cf9f', // sand
  '#a8c5d8', // grey-blue
  '#e8c4a8', // peach
  '#a8d8c5', // mint
  '#d8a8c9', // mauve
  '#d9d3a7', // light ochre
  '#b8c4e0' // dove blue
]

/** Readable text color on a badge color (pastel → ink, dark → paper). */
export function contrastOn(hex: string): string {
  const v = hex.replace('#', '')
  if (v.length < 6) return '#17150F'
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum > 150 ? '#17150F' : '#F4F1EA'
}
