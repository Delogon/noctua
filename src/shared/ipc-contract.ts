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
  threadListItemSchema
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
  busyIntervalSchema,
  invitationRespondInputSchema,
  invitationRespondOutputSchema,
  invitationViewSchema
} from './invitation-types'
import {
  isRendererSecretKey,
  isRendererSettingReadable,
  isRendererSettingWritable
} from './settings-keys'

/**
 * Der zentrale IPC-Vertrag zwischen Main und Renderer.
 *
 * - `invokeContract`: Request/Response (Renderer → Main via ipcRenderer.invoke).
 *   Input UND Output werden main-seitig mit zod validiert — der Renderer gilt
 *   als weniger vertrauenswürdig, und der Main-Prozess soll nie ungeprüfte
 *   Formen zurückgeben.
 * - `pushContract`: Events (Main → Renderer via webContents.send).
 *
 * Neue Kanäle ausschließlich hier ergänzen; Preload-Whitelist, Main-Registrar
 * und Renderer-Typen leiten sich automatisch ab.
 */

// Schlüssel-Allowlists (settings-keys.ts) greifen schon im Schema; die Handler
// prüfen zusätzlich selbst (Defense in Depth).
const readableSettingKey = z
  .string()
  .max(200)
  .refine(isRendererSettingReadable, 'Schlüssel nicht erlaubt')
const writableSettingKey = z
  .string()
  .max(200)
  .refine(isRendererSettingWritable, 'Schlüssel nicht erlaubt')
const secretKey = z.string().max(200).refine(isRendererSecretKey, 'Schlüssel nicht erlaubt')

// --- AI-Provider-Profile (Phase 1.1) -----------------------------------------
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

export const aiTaskSchema = z.enum(['triage', 'draft', 'stt'])

const modelInfoSchema = z.object({
  id: z.string(),
  promptPerM: z.number(),
  completionPerM: z.number(),
  context: z.number(),
  audioIn: z.boolean().default(false)
})

const taskAssignmentSchema = z.object({
  /** Profil-ID oder 'apple' (On-Device, nur Triage) */
  profileId: z.string().max(40),
  /** gewähltes Modell; leer = Default (nur OpenRouter) */
  model: z.string().max(200),
  /** Warum die Aufgabe gerade nicht läuft — null, wenn sie läuft */
  blocked: z.enum(['local-only', 'no-key', 'no-profile', 'no-model']).nullable()
})

// --- Kalender (Phase 2.1) ------------------------------------------------------------
const calendarCredentialsSchema = z.object({
  /** Server-URL, Domain oder Mail-Adresse (Discovery nach RFC 6764) */
  serverInput: z.string().trim().min(1).max(500),
  username: z.string().trim().min(1).max(320),
  /** Leer erlaubt, wenn das Passwort des Mail-Kontos übernommen wird */
  password: z.string().max(1000).optional(),
  mailAccountId: z.number().int().optional(),
  reuseMailPassword: z.boolean().optional()
})

/** Sync-Zeitraum in Tagen: 0 = alles, null = Standard (90 Tage Liste / 183 Suche). */
const syncDaysSchema = z.union([z.literal(0), z.number().int().min(7).max(3650)]).nullable()

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
  // Secrets sind write-only für den Renderer: setzen und prüfen — nie lesen.
  // Entschlüsselte Werte bleiben ausschließlich im Main-Prozess.
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
  // Neues Passwort für ein Passwort-/Bridge-Konto (needs-reauth): Login wird
  // geprüft, bevor das Vault-Geheimnis überschrieben und der Syncer neu gestartet wird.
  'accounts:updatePassword': {
    input: z.object({ accountId: z.number().int(), password: z.string().min(1).max(1000) }),
    output: z.object({ ok: z.literal(true) })
  },
  // Erneute Browser-Anmeldung für Google-/Microsoft-Konten (gleiche Adresse Pflicht).
  'accounts:reauthorize': {
    input: z.object({ accountId: z.number().int() }),
    output: z.object({ ok: z.literal(true), email: z.string() })
  },
  'accounts:remove': {
    input: z.object({ accountId: z.number() }),
    output: z.object({ ok: z.literal(true) })
  },
  // Bricht einen wartenden Browser-Login ab (Design 3b: CANCEL beendet den
  // OAuth-Roundtrip wirklich — Loopback-Server zu, invoke-Promise verworfen).
  'accounts:cancelOAuth': {
    input: z.object({ provider: z.enum(['gmail', 'microsoft']) }),
    output: z.object({ canceled: z.boolean() })
  },
  // --- Kalender (CalDAV, Phase 2.1) -----------------------------------------------
  'calendar:accounts:list': {
    input: z.void(),
    output: z.object({ accounts: z.array(calendarAccountSummarySchema) })
  },
  // Vorbelegung aus einem Mail-Konto (Benutzername = Adresse, Server aus der Domain)
  'calendar:accounts:suggest': {
    input: z.object({ mailAccountId: z.number().int() }),
    output: z.object({
      username: z.string(),
      serverInput: z.string(),
      canReusePassword: z.boolean()
    })
  },
  // Verbindung prüfen und Kalender auflisten, ohne etwas zu speichern
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
  // Neues Passwort für ein Kalender-Konto (needs-reauth): erst prüfen, dann speichern
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
      /** IANA-Zone für ganztägige Einträge (Default: Systemzone) */
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
      /** Teilnehmer benachrichtigen (Standard: ja, wenn Teilnehmer vorhanden und der Nutzer Organisator ist) */
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
  // Einladungskarten (iMIP) einer Mail
  'calendar:invitations:get': {
    input: z.object({ messageId: z.number().int() }),
    output: z.object({ invitations: z.array(invitationViewSchema) })
  },
  // RSVP: Server-Scheduling (nur PARTSTAT-PUT) oder iMIP-REPLY per Outbox
  'calendar:invitations:respond': {
    input: invitationRespondInputSchema,
    output: invitationRespondOutputSchema
  },
  // Absage übernehmen: Termin aus dem Kalender entfernen
  'calendar:invitations:removeCancelled': {
    input: z.object({ invitationId: z.number().int() }),
    output: z.object({ ok: z.literal(true) })
  },
  // Free/Busy anderer Teilnehmer (Scheduling-Outbox), „ich" aus den eigenen Kalendern
  'calendar:freebusy': {
    input: freeBusyInputSchema,
    output: z.object({ results: z.array(freeBusyResultSchema) })
  },
  // Eigene Belegung aus der lokalen DB (z. B. für KI-Entwürfe)
  'calendar:freebusy:self': {
    input: freeBusySelfInputSchema,
    output: z.object({ busy: z.array(busyIntervalSchema) })
  },
  // Sofortiger Abgleich (ein Konto oder alle); hebt needs-reauth-Wartezeiten auf
  'calendar:refresh': {
    input: z.object({ accountId: z.number().int().optional() }),
    output: z.object({ ok: z.literal(true) })
  },
  'threads:list': {
    input: z.object({
      limit: z.number().int().min(1).max(500).default(200),
      accountId: z.number().int().optional(),
      mbox: z.enum(['inbox', 'sent', 'spam']).default('inbox')
    }),
    output: z.object({ threads: z.array(threadListItemSchema) })
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
    // Ohne accountId: alle Konten; mit: nur eines (RETRY im Fehlerzustand, 3b)
    input: z.object({ accountId: z.number().int().optional() }).optional(),
    output: z.object({ ok: z.literal(true) })
  },
  'ai:overrideCategory': {
    input: z.object({ threadKey: z.string().max(512), category: aiCategorySchema.nullable() }),
    output: z.object({ ok: z.literal(true) })
  },
  'ai:testModel': {
    input: z.object({
      profileId: profileIdSchema,
      /** Modell-ID des Profils, z. B. moonshotai/kimi-k2 oder llama3.2:latest */
      model: z.string().trim().min(1).max(200)
    }),
    output: z.object({
      ok: z.boolean(),
      latencyMs: z.number(),
      costUsd: z.number().nullable(),
      detail: z.string().nullable()
    })
  },
  // Modellliste eines Profils (OpenRouter: Live-Katalog, sonst GET /models).
  // Bei Local only holt ein externes Profil sie nur auf ausdrückliche Anfrage
  // (`manual`) — sonst `skipped: true` und keine Netzverbindung.
  'ai:profileModels': {
    input: z.object({ profileId: profileIdSchema, manual: z.boolean().default(false) }),
    output: z.object({ models: z.array(modelInfoSchema), skipped: z.boolean() })
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
  // Profil-Keys: write-only über einen eigenen Kanal (nicht über secrets:set)
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
      stt: taskAssignmentSchema
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
  // Local only (privacy.localOnly): weicher Schalter, siehe src/main/privacy.ts
  'privacy:getLocalOnly': {
    input: z.void(),
    output: z.object({ localOnly: z.boolean() })
  },
  'privacy:setLocalOnly': {
    input: z.object({ localOnly: z.boolean() }),
    output: z.object({ localOnly: z.boolean() })
  },
  // Alle Netzwerkverbindungen der App (Technik-Seite), live aus Konten/Profilen/Konfiguration
  'privacy:networkConnections': {
    input: z.void(),
    output: networkConnectionsSchema
  },
  // Branding/Onboarding-Hinweise aus der Org-Konfiguration (Upstream: Defaults)
  'org:info': {
    input: z.void(),
    output: z.object({
      productName: z.string().max(60),
      /** true: Onboarding bietet statt OpenRouter die Profile der Organisation an */
      hideOpenRouterOnboarding: z.boolean(),
      edition: z.enum(['upstream', 'organisation'])
    })
  },
  // Update-Check auf Anforderung (bei Local only der einzige Weg)
  'updates:checkNow': {
    input: z.void(),
    output: z.object({
      updateAvailable: z.boolean(),
      latest: z.string().nullable(),
      url: z.string(),
      note: z.string().nullable()
    })
  },
  // Lokales Suchmodell (Embeddings): Status + ausdrücklicher Download
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
  // Verfügbarkeit des On-Device-Modells (Apple Intelligence) für die Triage
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
      // WAV (PCM16 mono), base64 — der Renderer nimmt auf und kodiert
      audioBase64: z.string().max(20_000_000),
      format: z.enum(['wav', 'mp3'])
    }),
    output: z.object({ text: z.string() })
  },
  // Bewusst schlank: der Renderer braucht nur Key-Status und aktive Modelle
  // (Kosten/Job-Zähler zeigt keine Oberfläche mehr an).
  'ai:usage': {
    input: z.void(),
    output: z.object({
      hasApiKey: z.boolean(),
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
          hits: z.number()
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
  // CardDAV-Kontakte (Phase 3.1, nur lesend) je Kalender-Konto
  'contacts:dav:status': {
    input: z.object({ accountId: z.number().int() }),
    output: davContactsStatusSchema
  },
  // „Kontakte synchronisieren" ein/aus; ein = Discovery gegen den Server des Kontos
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
    // idea: bearbeiteter Text/Diktat aus dem Stups-Composer — die Eule formt
    // daraus den Nachfass neu (⌘J), ohne den Wortsinn zu verlieren.
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
  // Eulen-Gespräche (Owl-View): Verläufe überleben den Neustart.
  // Gespeichert wird nur nach einer vollständigen Antwort — nie leere Fragen.
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
  // Rechtschreibprüfung (Hunspell DE+EN im Main-Prozess): batch-Check plus
  // Vorschläge für ein einzelnes Wort — der Renderer cached beides.
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
    // Betreff-Vorschlag bei neuen Mails (BETREFF-Protokoll in drafts.ts)
    subject: z.string().nullable().default(null),
    compositionMode: z.enum(['dictation', 'idea']).nullable().optional()
  }),
  'sync:state': z.object({
    accountId: z.number(),
    state: z.enum(['idle', 'connecting', 'syncing', 'error', 'needs-reauth', 'off']),
    detail: z.string().nullable()
  }),
  // Op-Queue: IMAP-Aktionen, die endgültig nicht ausgeführt werden konnten
  // (Dead-Letter) — der Renderer zeigt eine Toast statt stillem Verlust.
  'sync:opsDead': z.object({
    accountId: z.number(),
    count: z.number(),
    reason: z.enum(['attempts', 'uidvalidity', 'no-target-folder', 'no-trash', 'folder-gone'])
  }),
  // Kalender: Daten haben sich geändert (calendarIds leer = Kalenderliste/Sichtbarkeit)
  'calendar:changed': z.object({ accountId: z.number(), calendarIds: z.array(z.number()) }),
  'calendar:accountState': z.object({
    accountId: z.number(),
    state: calendarAccountStateSchema,
    detail: z.string().nullable()
  }),
  // Lokale Änderung wurde nicht übernommen (Konflikt: Server-Version gewinnt, nie stilles Überschreiben)
  'calendar:conflict': z.object({
    accountId: z.number(),
    calendarId: z.number(),
    uid: z.string(),
    summary: z.string().nullable(),
    kind: z.enum(['create', 'update', 'delete']),
    reason: z.enum(['conflict', 'deleted-on-server', 'forbidden', 'attempts'])
  }),
  // CardDAV-Kontakte (Phase 3.1): Adressbücher/Karten eines Kontos wurden abgeglichen
  'contacts:changed': z.object({ accountId: z.number() }),
  // Klick auf eine Erinnerung
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

/** Öffentliche API, die der Preload unter window.noctua bereitstellt. */
export interface NoctuaApi {
  invoke<C extends InvokeChannel>(channel: C, input: InvokeInput<C>): Promise<InvokeOutput<C>>
  /** Abonniert ein Push-Event; Rückgabewert ist die Unsubscribe-Funktion. */
  on<C extends PushChannel>(channel: C, callback: (payload: PushPayload<C>) => void): () => void
}
