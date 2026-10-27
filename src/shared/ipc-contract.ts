import { z } from 'zod'
import {
  accountSummarySchema,
  aiCategorySchema,
  draftItemSchema,
  messageActionSchema,
  messageDetailSchema,
  messageHeaderDetailsSchema,
  networkConnectionsSchema,
  owlConversationListItemSchema,
  owlConversationSchema,
  owlMessageSchema,
  semanticSearchHitSchema,
  semanticSearchIndexSchema,
  taskItemSchema,
  threadListItemSchema,
  folderListItemSchema
} from './types'
import {
  calendarAccountStateSchema,
  calendarAccountSummarySchema,
  calendarEditScopeSchema,
  calendarEventDetailSchema,
  calendarEventInputSchema,
  calendarEventPatchSchema,
  calendarInstanceSchema,
  calendarSummarySchema,
  discoveredCalendarSchema
} from './calendar-types'
import { davContactsStatusSchema } from './contacts-types'
import {
  freeBusyInputSchema,
  freeBusyResultSchema,
  freeBusySelfInputSchema,
  schedulingInfoInputSchema,
  schedulingInfoSchema,
  busyIntervalSchema,
  invitationRespondInputSchema,
  invitationRespondOutputSchema,
  invitationViewSchema
} from './invitation-types'
import { eventSuggestionViewSchema } from './event-suggestion-types'
import {
  isRendererSecretKey,
  isRendererSettingReadable,
  isRendererSettingWritable
} from './settings-keys'

/**
 * The central IPC contract between main and renderer.
 *
 * - `invokeContract`: request/response (renderer → main via ipcRenderer.invoke).
 *   Input AND output are validated with zod on the main side — the renderer is
 *   considered less trustworthy, and the main process should never return
 *   unchecked shapes.
 * - `pushContract`: events (main → renderer via webContents.send).
 *
 * Add new channels only here; the preload whitelist, main registrar
 * and renderer types are derived automatically.
 */

// Key allowlists (settings-keys.ts) already apply in the schema; the handlers
// additionally check themselves (defense in depth).
const readableSettingKey = z
  .string()
  .max(200)
  .refine(isRendererSettingReadable, 'Schlüssel nicht erlaubt')
const writableSettingKey = z
  .string()
  .max(200)
  .refine(isRendererSettingWritable, 'Schlüssel nicht erlaubt')
const secretKey = z.string().max(200).refine(isRendererSecretKey, 'Schlüssel nicht erlaubt')

// --- AI provider profiles (phase 1.1) ----------------------------------------
const profileIdSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/)

export const aiProfileSchema = z.object({
  id: profileIdSchema,
  name: z.string().max(60),
  baseUrl: z.string().max(500),
  apiStyle: z.enum(['chat', 'responses']),
  isLocal: z.boolean(),
  preset: z.enum(['openrouter', 'custom']),
  managed: z.boolean(),
  hasKey: z.boolean()
})

const profileFieldsSchema = z.object({
  name: z.string().trim().min(1).max(60),
  baseUrl: z.string().trim().min(1).max(500),
  apiStyle: z.enum(['chat', 'responses']),
  isLocal: z.boolean()
})

export const aiTaskSchema = z.enum(['triage', 'draft', 'stt', 'decision'])

const modelInfoSchema = z.object({
  id: z.string(),
  promptPerM: z.number(),
  completionPerM: z.number(),
  context: z.number(),
  audioIn: z.boolean().default(false)
})

const taskAssignmentSchema = z.object({
  /** Profile ID or 'apple' (on-device, triage only) */
  profileId: z.string().max(40),
  /** chosen model; empty = default (OpenRouter only) */
  model: z.string().max(200),
  /** Why the task isn't running right now — null if it is running */
  blocked: z.enum(['local-only', 'no-key', 'no-profile', 'no-model']).nullable()
})

// --- Calendar (phase 2.1) ------------------------------------------------------------
const calendarCredentialsSchema = z.object({
  /** Server URL, domain or mail address (discovery per RFC 6764) */
  serverInput: z.string().trim().min(1).max(500),
  username: z.string().trim().min(1).max(320),
  /** Empty allowed if the mail account's password is reused */
  password: z.string().max(1000).optional(),
  mailAccountId: z.number().int().optional(),
  reuseMailPassword: z.boolean().optional()
})

/** Sync range in days: 0 = everything, null = default (90 days list / 183 search). */
const syncDaysSchema = z.union([z.literal(0), z.number().int().min(7).max(3650)]).nullable()

const timingSummarySchema = z.object({
  name: z.string().max(600),
  count: z.number(),
  totalMs: z.number(),
  meanMs: z.number(),
  maxMs: z.number(),
  p50Ms: z.number(),
  p95Ms: z.number(),
  p99Ms: z.number()
})
const benchmarkResultSchema = z.object({
  startedAt: z.number(),
  durationMs: z.number(),
  cases: z
    .array(
      z.object({
        name: z.string().max(120),
        runs: z.number(),
        minMs: z.number(),
        medianMs: z.number(),
        maxMs: z.number(),
        statements: z.number(),
        error: z.string().max(300).nullable()
      })
    )
    .max(40),
  plans: z
    .array(
      z.object({
        sql: z.string().max(600),
        usedBy: z.array(z.string().max(120)).max(40),
        plan: z.array(z.string().max(400)).max(100),
        fullScans: z.array(z.string().max(120)).max(40),
        indexScans: z.array(z.string().max(120)).max(40),
        tempBtrees: z.number()
      })
    )
    .max(100)
})
/** Values measured by the renderer for the export (channel names and numbers only). */
const rendererDiagnosticsSchema = z.object({
  ipc: z.array(timingSummarySchema.extend({ name: z.string().regex(/^[\w.:-]{1,80}$/) })).max(300),
  longTasks: z.object({
    count: z.number(),
    totalMs: z.number(),
    maxMs: z.number(),
    recent: z.array(z.object({ at: z.number(), ms: z.number() })).max(100)
  }),
  heapUsedMb: z.number().nullable()
})
const diagnosticsStatusSchema = z.object({
  enabled: z.boolean(),
  startedAt: z.number(),
  sampleCount: z.number(),
  storedSessions: z.number(),
  latest: z
    .object({
      t: z.number(),
      mainCpuPct: z.number(),
      rssMb: z.number(),
      heapUsedMb: z.number(),
      loopP99Ms: z.number(),
      loopMaxMs: z.number(),
      appCpuPct: z.number().nullable(),
      appMemMb: z.number().nullable(),
      sqlCalls: z.number(),
      sqlMs: z.number()
    })
    .nullable(),
  topOperations: z.array(timingSummarySchema).max(20),
  topQueries: z.array(timingSummarySchema).max(20),
  slow: z.array(z.object({ name: z.string().max(200), ms: z.number(), at: z.number() })).max(20),
  benchmark: benchmarkResultSchema.nullable()
})

const threatLevelSchema = z.enum(['none', 'suspicious', 'high'])
const threatVerdictSchema = z.object({
  level: threatLevelSchema,
  /** Model score 0 (inconspicuous) … 2, null without a decision model */
  ai: z.number().nullable(),
  /** Sum of the local signal weights */
  heuristic: z.number()
})
const mailSecuritySchema = z.object({
  phishing: threatVerdictSchema,
  spam: threatVerdictSchema,
  /** local signals, e.g. "reply_to_differs", "link_mismatch:2", "homoglyph_sender" */
  signals: z.array(z.string().max(60)).max(30),
  model: z.string().max(200).nullable(),
  canCheck: z.boolean(),
  inJunk: z.boolean()
})

export const invokeContract = {
  'app:version': {
    input: z.void(),
    output: z.object({ app: z.string(), electron: z.string(), node: z.string() })
  },
  'settings:get': {
    input: z.object({ key: readableSettingKey }),
    output: z.object({ value: z.string().nullable() })
  },
  'settings:set': {
    input: z.object({ key: writableSettingKey, value: z.string().max(100_000) }),
    output: z.object({ ok: z.literal(true) })
  },
  // Secrets are write-only for the renderer: set and check — never read.
  // Decrypted values stay strictly in the main process.
  'secrets:set': {
    input: z.object({ key: secretKey, value: z.string().max(100_000) }),
    output: z.object({ ok: z.literal(true) })
  },
  'secrets:exists': {
    input: z.object({ key: secretKey }),
    output: z.object({ exists: z.boolean() })
  },
  'app:openExternal': {
    input: z.object({ url: z.string().max(4000) }),
    output: z.object({ ok: z.boolean() })
  },
  // Adapt the macOS traffic lights to the header of the chosen layout (classic is lower)
  'app:setWindowChrome': {
    input: z.object({ layout: z.enum(['letterpress', 'classic']) }),
    output: z.object({ ok: z.literal(true) })
  },
  'accounts:add': {
    input: z.object({
      provider: z.enum(['gmail', 'imap']),
      accountName: z.string().trim().min(1).max(40),
      email: z.string().email().max(320),
      displayName: z.string().max(200).optional(),
      password: z.string().min(1).max(1000),
      imapHost: z.string().max(500).optional(),
      imapPort: z.number().int().min(1).max(65535).optional(),
      smtpHost: z.string().max(500).optional(),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      syncDays: syncDaysSchema.optional()
    }),
    output: z.object({ accountId: z.number() })
  },
  'accounts:addMicrosoft': {
    input: z.object({
      accountName: z.string().trim().min(1).max(40),
      syncDays: syncDaysSchema.optional()
    }),
    output: z.object({ accountId: z.number(), email: z.string() })
  },
  'accounts:addGoogle': {
    input: z.object({
      accountName: z.string().trim().min(1).max(40),
      syncDays: syncDaysSchema.optional()
    }),
    output: z.object({ accountId: z.number(), email: z.string() })
  },
  'accounts:list': {
    input: z.void(),
    output: z.object({ accounts: z.array(accountSummarySchema) })
  },
  'accounts:update': {
    input: z.object({
      accountId: z.number().int(),
      accountName: z.string().trim().min(1).max(40).optional(),
      signature: z.string().max(5000).nullable().optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      syncDays: syncDaysSchema.optional()
    }),
    output: z.object({ ok: z.literal(true), accountName: z.string().optional() })
  },
  // New password for a password/bridge account (needs-reauth): the login is
  // checked before the vault secret is overwritten and the syncer restarted.
  'accounts:updatePassword': {
    input: z.object({ accountId: z.number().int(), password: z.string().min(1).max(1000) }),
    output: z.object({ ok: z.literal(true) })
  },
  // Browser sign-in again for Google/Microsoft accounts (same address required).
  'accounts:reauthorize': {
    input: z.object({ accountId: z.number().int() }),
    output: z.object({ ok: z.literal(true), email: z.string() })
  },
  'accounts:remove': {
    input: z.object({ accountId: z.number() }),
    output: z.object({ ok: z.literal(true) })
  },
  // Cancels a pending browser login (design 3b: CANCEL really ends the
  // OAuth round trip — loopback server closed, invoke promise discarded).
  'accounts:cancelOAuth': {
    input: z.object({ provider: z.enum(['gmail', 'microsoft']) }),
    output: z.object({ canceled: z.boolean() })
  },
  // --- Calendar (CalDAV, phase 2.1) -----------------------------------------------
  'calendar:accounts:list': {
    input: z.void(),
    output: z.object({ accounts: z.array(calendarAccountSummarySchema) })
  },
  // Prefill from a mail account (username = address, server from the domain)
  'calendar:accounts:suggest': {
    input: z.object({ mailAccountId: z.number().int() }),
    output: z.object({
      username: z.string(),
      serverInput: z.string(),
      canReusePassword: z.boolean()
    })
  },
  // Check the connection and list calendars without saving anything
  'calendar:accounts:discover': {
    input: calendarCredentialsSchema,
    output: z.object({
      serverUrl: z.string(),
      autoSchedule: z.boolean(),
      calendars: z.array(discoveredCalendarSchema)
    })
  },
  'calendar:accounts:add': {
    input: calendarCredentialsSchema.extend({ name: z.string().trim().max(60) }),
    output: z.object({
      accountId: z.number(),
      calendarCount: z.number(),
      autoSchedule: z.boolean()
    })
  },
  'calendar:accounts:update': {
    input: z.object({ accountId: z.number().int(), name: z.string().trim().min(1).max(60) }),
    output: z.object({ ok: z.literal(true) })
  },
  // New password for a calendar account (needs-reauth): check first, then save
  'calendar:accounts:updatePassword': {
    input: z.object({ accountId: z.number().int(), password: z.string().min(1).max(1000) }),
    output: z.object({ ok: z.literal(true) })
  },
  'calendar:accounts:remove': {
    input: z.object({ accountId: z.number().int() }),
    output: z.object({ ok: z.literal(true) })
  },
  'calendar:accounts:test': {
    input: z.object({ accountId: z.number().int() }),
    output: z.object({ calendarCount: z.number(), autoSchedule: z.boolean() })
  },
  'calendar:list': {
    input: z.object({ accountId: z.number().int().optional() }),
    output: z.object({ calendars: z.array(calendarSummarySchema) })
  },
  'calendar:setVisible': {
    input: z.object({ calendarId: z.number().int(), visible: z.boolean() }),
    output: z.object({ ok: z.literal(true) })
  },
  'calendar:setColor': {
    input: z.object({
      calendarId: z.number().int(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
    }),
    output: z.object({ ok: z.literal(true) })
  },
  'calendar:events:list': {
    input: z.object({
      rangeStart: z.number(),
      rangeEnd: z.number(),
      calendarIds: z.array(z.number().int()).max(200).optional(),
      /** IANA zone for all-day entries (default: system zone) */
      tz: z.string().max(100).optional()
    }),
    output: z.object({ events: z.array(calendarInstanceSchema) })
  },
  'calendar:events:get': {
    input: z.object({
      objectId: z.number().int(),
      recurrenceId: z.string().max(40).nullable().default(null)
    }),
    output: z.object({ event: calendarEventDetailSchema })
  },
  'calendar:events:create': {
    input: z.object({
      event: calendarEventInputSchema,
      /** Notify attendees (default: yes, if there are attendees and the user is the organizer) */
      notifyAttendees: z.boolean().optional()
    }),
    output: z.object({ objectId: z.number() })
  },
  'calendar:events:update': {
    input: z.object({
      objectId: z.number().int(),
      scope: calendarEditScopeSchema,
      recurrenceId: z.string().max(40).nullable(),
      patch: calendarEventPatchSchema,
      notifyAttendees: z.boolean().optional()
    }),
    output: z.object({ objectId: z.number(), createdObjectId: z.number().nullable() })
  },
  'calendar:events:delete': {
    input: z.object({
      objectId: z.number().int(),
      scope: calendarEditScopeSchema,
      recurrenceId: z.string().max(40).nullable(),
      notifyAttendees: z.boolean().optional()
    }),
    output: z.object({ ok: z.literal(true) })
  },
  // Invitation cards (iMIP) of a mail
  'calendar:invitations:get': {
    input: z.object({ messageId: z.number().int() }),
    output: z.object({ invitations: z.array(invitationViewSchema) })
  },
  // Event suggestions from mails (AI, 2.4): never created automatically
  'calendar:eventSuggestions:get': {
    input: z.object({ messageId: z.number().int() }),
    output: z.object({ suggestions: z.array(eventSuggestionViewSchema) })
  },
  'calendar:eventSuggestions:accept': {
    input: z.object({ id: z.number().int() }),
    output: z.object({ objectId: z.number().int() })
  },
  'calendar:eventSuggestions:dismiss': {
    input: z.object({ id: z.number().int() }),
    output: z.object({ ok: z.literal(true) })
  },
  // Editor takes over the suggestion (Edit…): counts as done
  'calendar:eventSuggestions:edit': {
    input: z.object({ id: z.number().int() }),
    output: z.object({ ok: z.literal(true) })
  },
  // RSVP: server scheduling (PARTSTAT PUT only) or iMIP REPLY via outbox
  'calendar:invitations:respond': {
    input: invitationRespondInputSchema,
    output: invitationRespondOutputSchema
  },
  // Apply cancellation: remove the event from the calendar
  'calendar:invitations:removeCancelled': {
    input: z.object({ invitationId: z.number().int() }),
    output: z.object({ ok: z.literal(true) })
  },
  // Free/busy of other attendees (scheduling outbox), "me" from own calendars
  'calendar:freebusy': {
    input: freeBusyInputSchema,
    output: z.object({ results: z.array(freeBusyResultSchema) })
  },
  // Own busy times from the local DB (e.g. for AI drafts)
  'calendar:freebusy:self': {
    input: freeBusySelfInputSchema,
    output: z.object({ busy: z.array(busyIntervalSchema) })
  },
  // Scheduling context for the editor (organizer?, own addresses, invitation for the event)
  'calendar:scheduling:info': {
    input: schedulingInfoInputSchema,
    output: schedulingInfoSchema
  },
  // Immediate sync (one account or all); lifts needs-reauth waiting times
  'calendar:refresh': {
    input: z.object({ accountId: z.number().int().optional() }),
    output: z.object({ ok: z.literal(true) })
  },
  'threads:list': {
    input: z.object({
      limit: z.number().int().min(1).max(500).default(200),
      accountId: z.number().int().optional(),
      mbox: z.enum(['inbox', 'sent', 'spam']).default('inbox'),
      // Folder view: a specific folder instead of the unified view
      folderId: z.number().int().positive().optional()
    }),
    output: z.object({ threads: z.array(threadListItemSchema) })
  },
  'folders:list': {
    input: z.void(),
    output: z.object({ folders: z.array(folderListItemSchema) })
  },
  'threads:mboxCounts': {
    input: z.object({ accountId: z.number().int().optional() }),
    output: z.object({ inbox: z.number(), sent: z.number(), spam: z.number() })
  },
  'threads:get': {
    input: z.object({ threadKey: z.string().max(512) }),
    output: z.object({ messages: z.array(messageDetailSchema) })
  },
  'messages:details': {
    input: z.object({ messageId: z.number().int().positive() }),
    output: messageHeaderDetailsSchema
  },
  // Performance diagnostics (local): status, on/off, benchmark, ZIP export, delete
  'diagnostics:status': {
    input: z.void(),
    output: diagnosticsStatusSchema
  },
  'diagnostics:setEnabled': {
    input: z.object({ enabled: z.boolean() }),
    output: z.object({ ok: z.literal(true) })
  },
  'diagnostics:benchmark': {
    input: z.void(),
    output: benchmarkResultSchema
  },
  // Main shows the save dialog; only the file name comes back
  'diagnostics:export': {
    input: z.object({
      renderer: rendererDiagnosticsSchema.nullable(),
      withBenchmark: z.boolean()
    }),
    output: z.object({
      saved: z.boolean(),
      fileName: z.string().max(255).nullable(),
      bytes: z.number()
    })
  },
  'diagnostics:clear': {
    input: z.void(),
    output: z.object({ ok: z.literal(true) })
  },
  'messages:action': {
    input: z.object({
      messageIds: z.array(z.number()).min(1).max(1000),
      action: messageActionSchema
    }),
    output: z.object({ ok: z.literal(true) })
  },
  'search:semantic': {
    input: z.object({
      q: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(100).default(20),
      accountId: z.number().int().optional()
    }),
    output: z.object({
      hits: z.array(semanticSearchHitSchema),
      index: semanticSearchIndexSchema,
      mode: z.enum(['hybrid', 'fulltext'])
    })
  },
  'sync:trigger': {
    // Without accountId: all accounts; with: just one (RETRY in error state, 3b)
    input: z.object({ accountId: z.number().int().optional() }).optional(),
    output: z.object({ ok: z.literal(true) })
  },
  // Manual triage of an account's existing Inbox mail (back to its sync range),
  // e.g. after adding an account — automatic discovery only covers 30 days.
  'ai:scanAccount': {
    input: z.object({ accountId: z.number().int() }),
    output: z.object({
      queued: z.number().int(),
      aiEnabled: z.boolean(),
      triageBlocked: z.boolean()
    })
  },
  'ai:overrideCategory': {
    input: z.object({ threadKey: z.string().max(512), category: aiCategorySchema.nullable() }),
    output: z.object({ ok: z.literal(true) })
  },
  'ai:testModel': {
    input: z.object({
      profileId: profileIdSchema,
      /** The profile's model ID, e.g. moonshotai/kimi-k2 or llama3.2:latest */
      model: z.string().trim().min(1).max(200)
    }),
    output: z.object({
      ok: z.boolean(),
      latencyMs: z.number(),
      costUsd: z.number().nullable(),
      detail: z.string().nullable()
    })
  },
  // A profile's model list (OpenRouter: live catalog, otherwise GET /models).
  // Under Local only an external profile fetches it only on explicit request
  // (`manual`) — otherwise `skipped: true` and no network connection.
  'ai:profileModels': {
    // kind: 'chat' (default) excludes pure decision models (they answer chat with
    // errors); 'decision' returns only models with capability `decision` (Ollama /api/tags, /api/show)
    input: z.object({
      profileId: profileIdSchema,
      manual: z.boolean().default(false),
      kind: z.enum(['chat', 'decision']).default('chat')
    }),
    output: z.object({ models: z.array(modelInfoSchema), skipped: z.boolean() })
  },
  // Function test of a decision model: two mini questions, answers + latency
  'ai:decisions:test': {
    input: z.object({ profileId: profileIdSchema, model: z.string().trim().min(1).max(200) }),
    output: z.object({
      ok: z.boolean(),
      latencyMs: z.number(),
      detail: z.string().nullable(),
      answers: z.array(z.object({ name: z.string(), text: z.string() })).max(8)
    })
  },
  // Spam/phishing assessment of a mail: local rules (always) + decision model (if present)
  'security:get': {
    input: z.object({ messageId: z.number().int() }),
    output: z.object({ security: mailSecuritySchema.nullable() })
  },
  // Standalone check with the decision model (local only, decision model only)
  'security:check': {
    input: z.object({ messageId: z.number().int() }),
    output: z.object({ security: mailSecuritySchema.nullable() })
  },
  // Detect local AI servers (onboarding): main probes only hard-wired
  // loopback addresses (Ollama, LM Studio, llama.cpp, LocalAI/vLLM) — allowed even
  // under Local only, since a non-loopback host is never queried.
  'ai:detectLocal': {
    input: z.void(),
    output: z.object({
      found: z
        .array(
          z.object({
            kind: z.enum(['ollama', 'lmstudio', 'llamacpp', 'localai']),
            baseUrl: z.string().max(200),
            models: z.array(z.string().max(200)).max(200),
            /** Ollama only: models with capability `decision` (not included in `models`) */
            decisionModels: z.array(z.string().max(200)).max(50).default([])
          })
        )
        .max(8)
    })
  },
  'ai:profiles:list': {
    input: z.void(),
    output: z.object({ profiles: z.array(aiProfileSchema) })
  },
  'ai:profiles:create': {
    input: profileFieldsSchema,
    output: z.object({ profile: aiProfileSchema })
  },
  'ai:profiles:update': {
    input: profileFieldsSchema.partial().extend({ id: profileIdSchema }),
    output: z.object({ profile: aiProfileSchema })
  },
  'ai:profiles:delete': {
    input: z.object({ id: profileIdSchema }),
    output: z.object({ ok: z.literal(true) })
  },
  // Profile keys: write-only via a dedicated channel (not via secrets:set)
  'ai:profiles:setKey': {
    input: z.object({ id: profileIdSchema, key: z.string().trim().min(1).max(500) }),
    output: z.object({ ok: z.literal(true) })
  },
  'ai:profiles:clearKey': {
    input: z.object({ id: profileIdSchema }),
    output: z.object({ ok: z.literal(true) })
  },
  'ai:profiles:test': {
    input: z.object({ id: profileIdSchema }),
    output: z.object({
      ok: z.boolean(),
      latencyMs: z.number(),
      modelCount: z.number(),
      detail: z.string().nullable()
    })
  },
  'ai:tasks:get': {
    input: z.void(),
    output: z.object({
      triage: taskAssignmentSchema,
      draft: taskAssignmentSchema,
      stt: taskAssignmentSchema,
      decision: taskAssignmentSchema
    })
  },
  'ai:tasks:set': {
    input: z.object({
      task: aiTaskSchema,
      profileId: z.string().max(40),
      model: z.string().trim().max(200)
    }),
    output: z.object({ ok: z.literal(true) })
  },
  // Local only (privacy.localOnly): soft switch, see src/main/privacy.ts
  'privacy:getLocalOnly': {
    input: z.void(),
    output: z.object({ localOnly: z.boolean() })
  },
  'privacy:setLocalOnly': {
    input: z.object({ localOnly: z.boolean() }),
    output: z.object({ localOnly: z.boolean() })
  },
  // All network connections of the app (technical page), live from accounts/profiles/config
  'privacy:networkConnections': {
    input: z.void(),
    output: networkConnectionsSchema
  },
  // Branding/onboarding hints from the org config (upstream: defaults)
  'org:info': {
    input: z.void(),
    output: z.object({
      productName: z.string().max(60),
      /** true: onboarding offers the organization's profiles instead of OpenRouter */
      hideOpenRouterOnboarding: z.boolean(),
      edition: z.enum(['upstream', 'organisation'])
    })
  },
  // Update check on demand (the only way under Local only)
  'updates:checkNow': {
    input: z.void(),
    output: z.object({
      updateAvailable: z.boolean(),
      latest: z.string().nullable(),
      url: z.string(),
      note: z.string().nullable()
    })
  },
  // Local search model (embeddings): status + explicit download
  'embeddings:status': {
    input: z.void(),
    output: z.object({
      state: z.enum(['not_loaded', 'loading', 'ready', 'error']),
      cached: z.boolean(),
      error: z.string().nullable(),
      eligible: z.number(),
      indexed: z.number()
    })
  },
  'embeddings:downloadModel': {
    input: z.void(),
    output: z.object({ ok: z.literal(true) })
  },
  // Availability of the on-device model (Apple Intelligence) for triage
  'ai:appleFm': {
    input: z.object({ force: z.boolean().default(false) }).optional(),
    output: z.object({
      state: z.enum([
        'available',
        'apple-intelligence-off',
        'model-not-ready',
        'device-unsupported',
        'helper-missing',
        'error'
      ]),
      detail: z.string().nullable()
    })
  },
  'ai:stylePreview': {
    input: z.object({ accountId: z.number().int() }),
    output: z.object({ text: z.string() })
  },
  'ai:transcribe': {
    input: z.object({
      // WAV (PCM16 mono), base64 — the renderer records and encodes
      audioBase64: z.string().max(20_000_000),
      format: z.enum(['wav', 'mp3'])
    }),
    output: z.object({ text: z.string() })
  },
  // Deliberately lean: the renderer only needs key status and active models
  // (no UI shows costs/job counters anymore).
  'ai:usage': {
    input: z.void(),
    output: z.object({
      hasApiKey: z.boolean(),
      draftBlock: z.enum(['local-only', 'no-key', 'no-profile', 'no-model']).nullable(),
      openrouterKey: z.boolean(),
      triageModel: z.string(),
      draftModel: z.string()
    })
  },
  'compose:send': {
    input: z.object({
      accountId: z.number(),
      to: z.array(z.string().email().max(320)).min(1).max(50),
      cc: z.array(z.string().email().max(320)).max(50).default([]),
      bcc: z.array(z.string().email().max(320)).max(50).default([]),
      subject: z.string().max(500),
      textBody: z.string().max(500_000),
      htmlBody: z.string().max(1_000_000).optional(),
      replyToMessageId: z.number().optional()
    }),
    output: z.object({ outboxId: z.number(), sendAt: z.number() })
  },
  'drafts:list': {
    input: z.void(),
    output: z.object({ drafts: z.array(draftItemSchema) })
  },
  'drafts:save': {
    input: z.object({
      threadKey: z.string().min(1).max(512),
      text: z.string().min(1).max(500_000),
      html: z.string().max(1_000_000).default('')
    }),
    output: z.object({ ok: z.literal(true) })
  },
  'drafts:delete': {
    input: z.object({ threadKey: z.string().min(1).max(512) }),
    output: z.object({ ok: z.boolean() })
  },
  'outbox:cancel': {
    input: z.object({ outboxId: z.number() }),
    output: z.object({
      ok: z.boolean(),
      accountId: z.number().nullable(),
      draft: z
        .object({
          to: z.array(z.string()),
          cc: z.array(z.string()),
          bcc: z.array(z.string()),
          subject: z.string(),
          textBody: z.string(),
          htmlBody: z.string().optional(),
          replyToMessageId: z.number().optional()
        })
        .nullable()
    })
  },
  'rules:draft': {
    input: z.object({ text: z.string().min(3).max(1500) }),
    output: z.object({ name: z.string(), description: z.string(), ruleJson: z.string() })
  },
  'rules:save': {
    input: z.object({
      name: z.string().max(80),
      description: z.string().max(300),
      sourceText: z.string().max(1500),
      ruleJson: z.string().max(4000)
    }),
    output: z.object({ id: z.number() })
  },
  'rules:list': {
    input: z.void(),
    output: z.object({
      rules: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          description: z.string().nullable(),
          enabled: z.boolean(),
          hits: z.number(),
          /** AI condition of the rule (decision model), otherwise null */
          aiCondition: z.string().nullable()
        })
      )
    })
  },
  'rules:toggle': {
    input: z.object({ id: z.number(), enabled: z.boolean() }),
    output: z.object({ ok: z.literal(true) })
  },
  'rules:delete': {
    input: z.object({ id: z.number() }),
    output: z.object({ ok: z.literal(true) })
  },
  'contacts:suggest': {
    input: z.object({
      q: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(20).default(8)
    }),
    output: z.object({
      contacts: z.array(z.object({ addr: z.string(), name: z.string().nullable() }))
    })
  },
  // CardDAV contacts (phase 3.1, read-only) per calendar account
  'contacts:dav:status': {
    input: z.object({ accountId: z.number().int() }),
    output: davContactsStatusSchema
  },
  // "Sync contacts" on/off; on = discovery against the account's server
  'contacts:dav:setSync': {
    input: z.object({ accountId: z.number().int(), enabled: z.boolean() }),
    output: z.object({ addressBookCount: z.number() })
  },
  'contacts:dav:setAddressBook': {
    input: z.object({ addressBookId: z.number().int(), enabled: z.boolean() }),
    output: z.object({ ok: z.literal(true) })
  },
  'contacts:preferredAccount': {
    input: z.object({ addr: z.string().email().max(320) }),
    output: z.object({ accountId: z.number().int().nullable() })
  },
  'ai:draftReply': {
    input: z.object({
      threadKey: z.string().max(512),
      instruction: z.string().max(2000).optional(),
      idea: z.string().max(20_000).optional(),
      reviseText: z.string().max(20_000).optional()
    }),
    output: z.object({ draftId: z.string() })
  },
  'ai:draftNew': {
    input: z.object({
      accountId: z.number().int(),
      to: z.array(z.string().max(320)).max(50).default([]),
      subject: z.string().max(500).default(''),
      idea: z.string().min(1).max(20_000),
      instruction: z.string().max(2000).optional()
    }),
    output: z.object({ draftId: z.string() })
  },
  'attachments:save': {
    input: z.object({ attachmentId: z.number() }),
    output: z.object({ savedPath: z.string().nullable() })
  },
  'messages:inlineImages': {
    input: z.object({ messageId: z.number() }),
    output: z.object({ images: z.record(z.string(), z.string()) })
  },
  'images:allowSender': {
    input: z.object({ addr: z.string().max(500), allow: z.boolean() }),
    output: z.object({ ok: z.literal(true) })
  },
  'tasks:list': {
    input: z.object({ status: z.enum(['open', 'done']) }),
    output: z.object({ tasks: z.array(taskItemSchema), openCount: z.number() })
  },
  'tasks:decideSuggestion': {
    input: z.object({ threadKey: z.string().max(512), accept: z.boolean() }),
    output: z.object({ ok: z.literal(true) })
  },
  'tasks:update': {
    input: z.object({ id: z.number(), status: z.enum(['open', 'done', 'dismissed']) }),
    output: z.object({ ok: z.literal(true) })
  },
  'tasks:sync:get': {
    input: z.void(),
    output: z.object({
      calendarId: z.number().nullable(),
      lists: z.array(
        z.object({
          calendarId: z.number(),
          accountId: z.number(),
          accountName: z.string(),
          name: z.string()
        })
      )
    })
  },
  'tasks:sync:set': {
    input: z.object({ calendarId: z.number().int().positive().nullable() }),
    output: z.object({ ok: z.literal(true) })
  },
  'followups:list': {
    input: z.void(),
    output: z.object({
      items: z.array(
        z.object({
          messageId: z.number(),
          threadKey: z.string(),
          accountId: z.number(),
          subject: z.string().nullable(),
          toAddrs: z.array(z.string()),
          sentAt: z.number(),
          daysWaiting: z.number(),
          nudgeDraft: z.string().nullable(),
          nudgedAt: z.number().nullable()
        })
      )
    })
  },
  'followups:markNudged': {
    input: z.object({ messageId: z.number().int() }),
    output: z.object({ ok: z.literal(true) })
  },
  'followups:saveNudge': {
    input: z.object({ messageId: z.number().int(), draft: z.string().max(10_000) }),
    output: z.object({ ok: z.literal(true) })
  },
  'followups:draftNudge': {
    // idea: edited text/dictation from the nudge composer — the owl reworks
    // the follow-up from it (⌘J) without losing the meaning.
    input: z.object({ messageId: z.number().int(), idea: z.string().max(10_000).optional() }),
    output: z.object({ draftId: z.string() })
  },
  'followups:dismiss': {
    input: z.object({ messageId: z.number() }),
    output: z.object({ ok: z.literal(true) })
  },
  'ai:chat': {
    input: z.object({
      question: z.string().min(1).max(2000),
      history: z
        .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) }))
        .max(12)
        .default([])
    }),
    output: z.object({ chatId: z.string() })
  },
  // Owl conversations (owl view): histories survive a restart.
  // Saved only after a complete answer — never empty questions.
  'owl:list': {
    input: z.void(),
    output: z.object({ conversations: z.array(owlConversationListItemSchema) })
  },
  'owl:get': {
    input: z.object({ id: z.number().int().positive() }),
    output: z.object({ conversation: owlConversationSchema.nullable() })
  },
  'owl:save': {
    input: z.object({
      id: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(500),
      messages: z.array(owlMessageSchema).min(1).max(60)
    }),
    output: z.object({ id: z.number() })
  },
  'owl:delete': {
    input: z.object({ id: z.number().int().positive() }),
    output: z.object({ ok: z.boolean() })
  },
  'ai:refreshStyle': {
    input: z.object({ accountId: z.number().int().optional() }).optional(),
    output: z.object({ ok: z.boolean() })
  },
  // Spell checking (Hunspell DE+EN in the main process): batch check plus
  // suggestions for a single word — the renderer caches both.
  'spell:check': {
    input: z.object({ words: z.array(z.string().min(1).max(120)).max(2000) }),
    output: z.object({ misspelled: z.array(z.string().max(120)) })
  },
  'spell:suggest': {
    input: z.object({ word: z.string().min(1).max(120) }),
    output: z.object({ suggestions: z.array(z.string().max(120)).max(5) })
  }
} as const

export const pushContract = {
  'messages:changed': z.object({
    accountId: z.number(),
    folderId: z.number().nullable(),
    threadKeys: z.array(z.string())
  }),
  'ai:annotated': z.object({ messageIds: z.array(z.number()) }),
  'ai:draftChunk': z.object({
    draftId: z.string(),
    chunk: z.string(),
    done: z.boolean(),
    error: z.string().nullable().default(null),
    // Subject suggestion for new mails (SUBJECT protocol in drafts.ts)
    subject: z.string().nullable().default(null),
    compositionMode: z.enum(['dictation', 'idea']).nullable().optional()
  }),
  'sync:state': z.object({
    accountId: z.number(),
    state: z.enum(['idle', 'connecting', 'syncing', 'error', 'needs-reauth', 'off']),
    detail: z.string().nullable()
  }),
  // Op queue: IMAP actions that permanently could not be executed
  // (dead letter) — the renderer shows a toast instead of silent loss.
  'sync:opsDead': z.object({
    accountId: z.number(),
    count: z.number(),
    reason: z.enum(['attempts', 'uidvalidity', 'no-target-folder', 'no-trash', 'folder-gone'])
  }),
  // Calendar: data has changed (calendarIds empty = calendar list/visibility)
  'calendar:changed': z.object({ accountId: z.number(), calendarIds: z.array(z.number()) }),
  'calendar:accountState': z.object({
    accountId: z.number(),
    state: calendarAccountStateSchema,
    detail: z.string().nullable()
  }),
  // Local change was not applied (conflict: server version wins, never silent overwrite)
  'calendar:conflict': z.object({
    accountId: z.number(),
    calendarId: z.number(),
    uid: z.string(),
    summary: z.string().nullable(),
    kind: z.enum(['create', 'update', 'delete']),
    reason: z.enum(['conflict', 'deleted-on-server', 'forbidden', 'attempts'])
  }),
  // CardDAV contacts (phase 3.1): an account's address books/cards were synced
  'contacts:changed': z.object({ accountId: z.number() }),
  // Click on a reminder
  'calendar:openEvent': z.object({
    objectId: z.number(),
    recurrenceId: z.string().nullable()
  }),
  'app:openThread': z.object({ threadKey: z.string() }),
  'updates:available': z.object({ latest: z.string(), url: z.string() }),
  'app:menuAction': z.object({
    action: z.enum([
      'settings',
      'compose',
      'shortcuts',
      'addAccount',
      'search',
      'chat',
      'inbox',
      'tasks',
      'calendar',
      'waiting'
    ])
  }),
  'followups:changed': z.object({}),
  'tasks:changed': z.object({}),
  'outbox:changed': z.object({
    outboxId: z.number(),
    state: z.enum(['pending', 'sending', 'sent', 'canceled', 'error', 'unknown'])
  }),
  'ai:chatChunk': z.object({
    chatId: z.string(),
    chunk: z.string(),
    done: z.boolean(),
    error: z.string().nullable().default(null),
    sources: z
      .array(z.object({ index: z.number(), threadKey: z.string(), subject: z.string().nullable() }))
      .nullable()
      .default(null)
  })
} as const

export type InvokeChannel = keyof typeof invokeContract
export type InvokeInput<C extends InvokeChannel> = z.infer<(typeof invokeContract)[C]['input']>
export type InvokeOutput<C extends InvokeChannel> = z.infer<(typeof invokeContract)[C]['output']>

export type PushChannel = keyof typeof pushContract
export type PushPayload<C extends PushChannel> = z.infer<(typeof pushContract)[C]>

export type IpcHandlers = {
  [C in InvokeChannel]: (input: InvokeInput<C>) => InvokeOutput<C> | Promise<InvokeOutput<C>>
}

export const INVOKE_CHANNELS = Object.keys(invokeContract) as InvokeChannel[]
export const PUSH_CHANNELS = Object.keys(pushContract) as PushChannel[]

/** Public API that the preload exposes under window.noctua. */
export interface NoctuaApi {
  invoke<C extends InvokeChannel>(channel: C, input: InvokeInput<C>): Promise<InvokeOutput<C>>
  /** Subscribes to a push event; the return value is the unsubscribe function. */
  on<C extends PushChannel>(channel: C, callback: (payload: PushPayload<C>) => void): () => void
}
