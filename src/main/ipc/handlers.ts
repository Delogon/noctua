import { app, BrowserWindow, dialog } from 'electron'
import { basename, join } from 'node:path'
import { trafficLightPosition } from '../window-chrome'
import { ImapFlow } from 'imapflow'
import type { InvokeOutput, IpcHandlers } from '@shared/ipc-contract'
import type { AccountSummary } from '@shared/types'
import { ACCOUNT_COLORS, PASTEL_COLORS } from '@shared/types'
import { getDb, getSetting, setSetting } from '../db'
import {
  getThreadMessages,
  imagesAllowKey,
  listFolders,
  listThreads,
  mboxCounts
} from '../db/repos/threads'
import { getInlineImages, saveAttachment } from '../mail/attachments'
import { listTaskLists, setTasksSyncCalendar, targetCalendar } from '../tasks/caldav-sync'
import { countOpenTasks, decideSuggestion, listTasks, updateTaskStatus } from '../db/repos/tasks'
import { preferredAccountForContact, suggestContacts } from '../db/repos/contacts'
import { deleteDraft, listDrafts, saveDraft } from '../db/repos/drafts'
import {
  deleteOwlConversation,
  getOwlConversation,
  listOwlConversations,
  saveOwlConversation
} from '../db/repos/owl'
import { deleteSecret, hasSecret, setSecret } from '../auth/secrets'
import { clearTlsPins } from '../auth/loopback-tls'
import {
  accountSecretKey,
  imapConnectOptions,
  PROVIDER_DEFAULTS,
  type AccountRow
} from '../auth/providers'
import { syncEngine } from '../sync/engine'
import {
  addAccount as addCalendarAccount,
  discover as discoverCalendarAccount,
  removeAccount as removeCalendarAccount,
  suggestFromMailAccount,
  testAccount as testCalendarAccount,
  updateAccountName as renameCalendarAccount,
  updateAccountPassword as updateCalendarPassword
} from '../calendar/accounts'
import {
  createEvent as createCalendarEvent,
  deleteEvent as deleteCalendarEvent,
  getEvent as getCalendarEvent,
  listAccounts as listCalendarAccounts,
  listCalendars,
  listEvents as listCalendarEvents,
  setCalendarColor,
  setCalendarVisible,
  updateEvent as updateCalendarEvent
} from '../calendar/service'
import { calendarSync } from '../calendar/sync'
import {
  getInvitationsForMessage,
  removeCancelledEvent,
  respondToInvitation,
  schedulingInfo
} from '../calendar/invitations'
import { queryFreeBusy, selfBusy } from '../calendar/freebusy'
import {
  acceptEventSuggestion,
  dismissEventSuggestion,
  listEventSuggestions,
  markEventSuggestionEditing
} from '../calendar/event-suggestions'
import { defaultEditContext } from '../calendar/edit'
import { contactsStatus, setAddressBookEnabled, setContactsSync } from '../contacts/accounts'
import { getDraftModel, getTriageModel } from '../ai/openrouter'
import { appleFmStatus } from '../ai/apple-fm'
import { detectLocalServers } from '../ai/detect-local'
import { startDraftNew, startDraftNudge, startDraftReply, stylePreview } from '../ai/drafts'
import { aiConditionOf, draftRule, ruleJsonSchema, ruleNeedsAi } from '../ai/rules'
import { outboxWorker } from '../smtp/outbox'
import { cancelMsLogin, msForgetAccount, msInteractiveLogin } from '../auth/msal'
import { cancelGoogleLogin, googleInteractiveLogin } from '../auth/google'
import { startChat } from '../ai/chat'
import { refreshStyleProfile } from '../ai/style'
import { runModelTest, testProfileConnection } from '../ai/model-test'
import { listProfileModels, runDecisionTest } from '../ai/decision-service'
import { getMailSecurity, runThreatCheck } from '../ai/threat-check'
import { diagnostics } from '../diagnostics/service'
import {
  clearProfileKey,
  createProfile,
  deleteProfile,
  getProfile,
  getTaskModel,
  getTaskProfileId,
  listProfiles,
  setProfileKey,
  setTaskAssignment,
  taskBlockReason,
  updateProfile
} from '../ai/providers/registry'
import type { AiTask } from '../ai/providers/types'
import { embeddingIndexer, isEmbeddingModelCached } from '../ai/embeddings'
import { aiQueue } from '../ai/queue'
import { checkForUpdates } from '../updates'
import { buildNetworkConnections } from '../network-connections'
import { getOrgConfig, productName, resolveUpdateFeed } from '../org-config'
import { defaultAiEnabledForNewAccounts } from '../org-defaults'
import { isLocalOnly, setLocalOnly } from '../privacy'
import { transcribeAudio } from '../ai/transcribe'
import { followupRadar } from '../ai/followups'
import { openExternalSafe } from '../util/links'
import { searchSemantic } from '../search'
import { getMessageHeaderDetails, storeMessageHeaderDetails } from '../db/repos/message-headers'
import { getSpellEngine } from '../spell'
import {
  assertSecretKey,
  assertSettingReadable,
  assertSettingWritable
} from '@shared/settings-keys'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void
let pushFn: PushFn = () => {}

/** Set by bootstrap — handlers that stream push through it. */
export function setHandlerPush(fn: PushFn): void {
  pushFn = fn
}

async function testImapLogin(
  email: string,
  password: string,
  host: string,
  port: number
): Promise<void> {
  // imapConnectOptions knows the special cases (STARTTLS ports, loopback Bridge)
  const client = new ImapFlow(
    await imapConnectOptions(
      { email, provider: 'imap', imap_host: host, imap_port: port },
      { user: email, pass: password }
    )
  )
  await client.connect()
  await client.logout()
}

function getAccountRow(accountId: number): AccountRow {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
    AccountRow | undefined
  if (!row) throw new Error('Konto nicht gefunden')
  return row
}

/** (Re)start the syncer with new credentials — even if it was not running (e.g. no password). */
async function restartSyncer(row: AccountRow, secretKey: string): Promise<void> {
  await syncEngine.credentialsChanged(secretKey)
  syncEngine.startAccount(row) // no-op if credentialsChanged has already started it
}

function toSummary(row: AccountRow): AccountSummary {
  const { state, detail, errorSince } = syncEngine.getState(row.id)
  return {
    id: row.id,
    email: row.email,
    accountName: row.account_name,
    displayName: row.display_name,
    provider: row.provider,
    credentialType: row.credential_type,
    color: row.color ?? ACCOUNT_COLORS[0],
    syncState: state,
    lastError: detail,
    errorSince,
    signature: row.signature ?? null,
    threadCount: countThreads(row.id),
    messageCount: countMessages(row.id),
    syncDays: row.sync_days ?? null
  }
}

function assertAccountNameAvailable(accountName: string, exceptAccountId?: number): void {
  const conflict = getDb()
    .prepare(
      `SELECT id FROM accounts
       WHERE lower(account_name) = lower(?) AND (? IS NULL OR id <> ?)`
    )
    .get(accountName.trim(), exceptAccountId ?? null, exceptAccountId ?? null) as
    { id: number } | undefined
  if (conflict) throw new Error(`Der Kontoname „${accountName.trim()}“ ist bereits verwendet`)
}

function countThreads(accountId: number): number {
  try {
    const row = getDb()
      .prepare(
        `SELECT count(DISTINCT m.thread_key) n FROM folders f
         CROSS JOIN messages m ON m.folder_id = f.id
         WHERE f.account_id = ?`
      )
      .get(accountId) as { n: number }
    return row.n
  } catch {
    return 0
  }
}

function countMessages(accountId: number): number {
  try {
    const row = getDb()
      .prepare('SELECT count(*) n FROM messages WHERE account_id = ?')
      .get(accountId) as { n: number }
    return row.n
  } catch {
    return 0
  }
}

export const handlers: IpcHandlers = {
  'app:version': () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node
  }),

  'app:openExternal': ({ url }) => ({ ok: openExternalSafe(url) }),

  'app:setWindowChrome': ({ layout }) => {
    if (process.platform === 'darwin') {
      for (const win of BrowserWindow.getAllWindows()) {
        win.setWindowButtonPosition(trafficLightPosition(layout))
      }
    }
    return { ok: true }
  },

  // Allowlist enforced again here (not only in the zod schema): OAuth client
  // configuration and other secrets stay out of the renderer's reach.
  'settings:get': ({ key }) => {
    assertSettingReadable(key)
    return { value: getSetting(key) }
  },

  'settings:set': ({ key, value }) => {
    assertSettingWritable(key)
    setSetting(key, value)
    return { ok: true }
  },

  'secrets:set': ({ key, value }) => {
    assertSecretKey(key)
    setSecret(key, value)
    // Changed account credentials end needs-reauth (syncer re-reads)
    void syncEngine
      .credentialsChanged(key)
      .catch((error) => console.warn('[sync] credentialsChanged:', error))
    return { ok: true }
  },

  'secrets:exists': ({ key }) => {
    assertSecretKey(key)
    return { exists: hasSecret(key) }
  },

  'accounts:add': async (input) => {
    const db = getDb()
    assertAccountNameAvailable(input.accountName)
    const gmail = input.provider === 'gmail' ? PROVIDER_DEFAULTS.gmail : null
    const imapHost = input.imapHost ?? gmail?.imapHost
    const imapPort = input.imapPort ?? gmail?.imapPort ?? 993
    const smtpHost = input.smtpHost ?? gmail?.smtpHost
    const smtpPort = input.smtpPort ?? gmail?.smtpPort ?? 465
    if (!imapHost || !smtpHost) throw new Error('IMAP- oder SMTP-Host fehlt')

    // App passwords often come formatted with spaces
    const password = input.password.replace(/\s+/g, '')
    await testImapLogin(input.email, password, imapHost, imapPort)

    const result = db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at, sync_days)
         VALUES (?, ?, ?, ?, 'password', ?, ?, ?, ?, ${defaultAiEnabledForNewAccounts()}, ?, ?, ?)`
      )
      .run(
        input.email.toLowerCase(),
        input.accountName.trim(),
        input.displayName ?? null,
        input.provider,
        imapHost,
        imapPort,
        smtpHost,
        smtpPort,
        PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)],
        Date.now(),
        input.syncDays ?? null
      )
    const accountId = Number(result.lastInsertRowid)
    setSecret(accountSecretKey(accountId), password)

    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    syncEngine.startAccount(row)
    return { accountId }
  },

  'accounts:addMicrosoft': async ({ accountName, syncDays }) => {
    assertAccountNameAvailable(accountName)
    // Browser login first — the address comes from the Microsoft account itself
    const { email } = await msInteractiveLogin()
    const db = getDb()
    const existing = db
      .prepare('SELECT id, account_name FROM accounts WHERE email = ?')
      .get(email) as { id: number; account_name: string } | undefined
    if (existing) {
      // Connecting twice is practically always a mistake — block clearly
      throw new Error(`${email} ist bereits als „${existing.account_name}“ verbunden`)
    }

    const ms = PROVIDER_DEFAULTS.microsoft
    const result = db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at, sync_days)
         VALUES (?, ?, NULL, 'microsoft', 'oauth-ms', ?, ?, ?, ?, ${defaultAiEnabledForNewAccounts()}, ?, ?, ?)`
      )
      .run(
        email,
        accountName.trim(),
        ms.imapHost,
        ms.imapPort,
        ms.smtpHost,
        ms.smtpPort,
        PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)],
        Date.now(),
        syncDays ?? null
      )
    const accountId = Number(result.lastInsertRowid)
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    syncEngine.startAccount(row)
    return { accountId, email }
  },

  'accounts:addGoogle': async ({ accountName, syncDays }) => {
    assertAccountNameAvailable(accountName)
    // Browser login first — the address comes from the Google account itself
    const { email } = await googleInteractiveLogin()
    const db = getDb()
    const existing = db
      .prepare('SELECT id, account_name, credential_type FROM accounts WHERE email = ?')
      .get(email) as
      | { id: number; account_name: string; credential_type: AccountRow['credential_type'] }
      | undefined
    if (existing) {
      // Adding an already connected address again is practically always a
      // mistake — block clearly instead of silently reporting "success". The
      // just-stored refresh token is only kept if the account runs via Google
      // OAuth anyway (then it is simply the freshest one).
      if (existing.credential_type !== 'oauth-google') {
        deleteSecret(`google:refresh:${email}`)
      }
      throw new Error(
        `${email} ist bereits als „${existing.account_name}“ verbunden – trenne das Konto zuerst, um auf die Google-Anmeldung umzustellen`
      )
    }

    const g = PROVIDER_DEFAULTS.gmail
    const result = db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at, sync_days)
         VALUES (?, ?, NULL, 'gmail', 'oauth-google', ?, ?, ?, ?, ${defaultAiEnabledForNewAccounts()}, ?, ?, ?)`
      )
      .run(
        email,
        accountName.trim(),
        g.imapHost,
        g.imapPort,
        g.smtpHost,
        g.smtpPort,
        PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)],
        Date.now(),
        syncDays ?? null
      )
    const accountId = Number(result.lastInsertRowid)
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow
    syncEngine.startAccount(row)
    return { accountId, email }
  },

  'accounts:list': () => {
    const rows = getDb().prepare('SELECT * FROM accounts ORDER BY id').all() as AccountRow[]
    return { accounts: rows.map(toSummary) }
  },

  'accounts:update': async ({ accountId, accountName, signature, color, syncDays }) => {
    const db = getDb()
    let savedAccountName: string | undefined
    if (accountName !== undefined) {
      const cleanName = accountName.trim()
      assertAccountNameAvailable(cleanName, accountId)
      db.prepare('UPDATE accounts SET account_name = ? WHERE id = ?').run(cleanName, accountId)
      savedAccountName = cleanName
    }
    if (signature !== undefined) {
      db.prepare('UPDATE accounts SET signature = ? WHERE id = ?').run(
        signature && signature.trim() ? signature : null,
        accountId
      )
    }
    if (color !== undefined) {
      db.prepare('UPDATE accounts SET color = ? WHERE id = ?').run(color, accountId)
    }
    if (syncDays !== undefined) {
      const before = db.prepare('SELECT sync_days FROM accounts WHERE id = ?').get(accountId) as
        { sync_days: number | null } | undefined
      db.prepare('UPDATE accounts SET sync_days = ? WHERE id = ?').run(syncDays, accountId)
      // Restart the syncer so the new window applies immediately — a larger one
      // loads on reconnect (the backfill guard compares the boundary).
      if (before && before.sync_days !== syncDays) {
        await syncEngine.stopAccount(accountId)
        const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
          AccountRow | undefined
        if (row) syncEngine.startAccount(row)
      }
    }
    return { ok: true, accountName: savedAccountName }
  },

  'accounts:updatePassword': async ({ accountId, password: rawPassword }) => {
    const row = getAccountRow(accountId)
    if (row.credential_type !== 'password' && row.credential_type !== 'bridge') {
      throw new Error(
        'Dieses Konto meldet sich über den Browser an – bitte „Erneut anmelden“ verwenden'
      )
    }
    // App passwords often come formatted with spaces (as with accounts:add)
    const password = rawPassword.replace(/\s+/g, '')
    // Verify first, then store: a wrong password overwrites nothing
    await testImapLogin(row.email, password, row.imap_host, row.imap_port)
    // Newly entered credentials = consent to the current Bridge certificate
    // (e.g. after reinstalling); the syncer pins it on the next connection.
    clearTlsPins(accountId)
    const key = accountSecretKey(accountId)
    setSecret(key, password)
    await restartSyncer(row, key)
    return { ok: true }
  },

  'accounts:reauthorize': async ({ accountId }) => {
    const row = getAccountRow(accountId)
    if (row.credential_type !== 'oauth-google' && row.credential_type !== 'oauth-ms') {
      throw new Error('Dieses Konto nutzt ein Passwort – bitte „Passwort neu eingeben“ verwenden')
    }
    const google = row.credential_type === 'oauth-google'
    const { email } = google ? await googleInteractiveLogin() : await msInteractiveLogin()
    if (email.toLowerCase() !== row.email.toLowerCase()) {
      // Wrong account chosen in the browser: do not keep its token unless
      // it belongs to another connected mailbox anyway.
      const other = getDb()
        .prepare('SELECT 1 FROM accounts WHERE lower(email) = lower(?)')
        .get(email)
      if (!other) {
        if (google) deleteSecret(`google:refresh:${email.toLowerCase()}`)
        else await msForgetAccount(email).catch(() => {})
      }
      throw new Error(
        `Angemeldet als ${email}, erwartet war ${row.email} — bitte mit dem richtigen Konto anmelden`
      )
    }
    // The login already replaced token/cache; syncer leaves needs-reauth
    await restartSyncer(row, accountSecretKey(accountId))
    return { ok: true, email: row.email }
  },

  'accounts:remove': async ({ accountId }) => {
    const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
      AccountRow | undefined
    await syncEngine.stopAccount(accountId)
    getDb().prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
    deleteSecret(accountSecretKey(accountId))
    // Google refresh token is tied to the address, not the account ID
    if (row?.credential_type === 'oauth-google') {
      deleteSecret(`google:refresh:${row.email.toLowerCase()}`)
    } else if (row?.credential_type === 'oauth-ms') {
      // MSAL serializes all accounts into one cache blob (ms.tokenCache) —
      // otherwise the refresh token survives the account deletion in the vault.
      await msForgetAccount(row.email).catch(() => {})
    }
    return { ok: true }
  },

  'accounts:cancelOAuth': ({ provider }) => ({
    // Aborts the waiting browser login — the matching addGoogle/
    // addMicrosoft invoke thereby rejects, the renderer cleans up silently.
    canceled: provider === 'gmail' ? cancelGoogleLogin() : cancelMsLogin()
  }),

  // --- Calendar (CalDAV) ------------------------------------------------------------
  'calendar:accounts:list': () => ({ accounts: listCalendarAccounts() }),

  'calendar:accounts:suggest': ({ mailAccountId }) =>
    suggestFromMailAccount(getDb(), mailAccountId),

  'calendar:accounts:discover': async (input) => {
    const found = await discoverCalendarAccount(getDb(), input)
    return {
      serverUrl: found.serverUrl,
      autoSchedule: found.autoSchedule,
      calendars: found.calendars.map((c) => ({
        displayName: c.displayName ?? 'Kalender',
        color: c.color,
        readOnly: c.readOnly,
        components: c.components
      }))
    }
  },

  'calendar:accounts:add': async (input) => addCalendarAccount(getDb(), input),

  'calendar:accounts:update': ({ accountId, name }) => {
    renameCalendarAccount(getDb(), accountId, name)
    return { ok: true }
  },

  'calendar:accounts:updatePassword': async ({ accountId, password }) => {
    await updateCalendarPassword(getDb(), accountId, password)
    return { ok: true }
  },

  'calendar:accounts:remove': ({ accountId }) => {
    removeCalendarAccount(getDb(), accountId)
    return { ok: true }
  },

  'calendar:accounts:test': async ({ accountId }) => testCalendarAccount(getDb(), accountId),

  'calendar:list': ({ accountId }) => ({ calendars: listCalendars(accountId) }),

  'calendar:setVisible': ({ calendarId, visible }) => {
    setCalendarVisible(calendarId, visible)
    return { ok: true }
  },

  'calendar:setColor': ({ calendarId, color }) => {
    setCalendarColor(calendarId, color)
    return { ok: true }
  },

  'calendar:events:list': (input) => ({ events: listCalendarEvents(input) }),

  'calendar:events:get': ({ objectId, recurrenceId }) => ({
    event: getCalendarEvent(objectId, recurrenceId)
  }),

  'calendar:events:create': ({ event, notifyAttendees }) =>
    createCalendarEvent(event, getDb(), undefined, { notifyAttendees }),

  'calendar:events:update': ({ objectId, scope, recurrenceId, patch, notifyAttendees }) =>
    updateCalendarEvent(objectId, scope, recurrenceId, patch, getDb(), undefined, {
      notifyAttendees
    }),

  'calendar:events:delete': ({ objectId, scope, recurrenceId, notifyAttendees }) => {
    deleteCalendarEvent(objectId, scope, recurrenceId, getDb(), undefined, { notifyAttendees })
    return { ok: true }
  },

  'calendar:invitations:get': ({ messageId }) => ({
    invitations: getInvitationsForMessage(getDb(), messageId)
  }),

  'calendar:eventSuggestions:get': ({ messageId }) => ({
    suggestions: listEventSuggestions(getDb(), messageId)
  }),

  'calendar:eventSuggestions:accept': ({ id }) => acceptEventSuggestion(getDb(), id),

  'calendar:eventSuggestions:dismiss': ({ id }) => {
    dismissEventSuggestion(getDb(), id)
    return { ok: true }
  },

  'calendar:eventSuggestions:edit': ({ id }) => {
    markEventSuggestionEditing(getDb(), id)
    return { ok: true }
  },

  'calendar:invitations:respond': (input) => respondToInvitation(getDb(), input),

  'calendar:invitations:removeCancelled': ({ invitationId }) => {
    removeCancelledEvent(getDb(), invitationId, defaultEditContext())
    return { ok: true }
  },

  'calendar:freebusy': async (input) => ({ results: await queryFreeBusy(input) }),

  'calendar:freebusy:self': (input) => ({ busy: selfBusy(input) }),

  'calendar:scheduling:info': (input) => schedulingInfo(getDb(), input),

  'calendar:refresh': ({ accountId }) => {
    calendarSync.refresh(accountId)
    return { ok: true }
  },

  'threads:list': ({ limit, accountId, mbox, folderId }) => ({
    threads: listThreads(getDb(), limit, accountId, mbox, folderId)
  }),

  'folders:list': () => ({ folders: listFolders(getDb()) }),

  'threads:mboxCounts': ({ accountId }) => mboxCounts(getDb(), accountId),

  'threads:get': async ({ threadKey }) => {
    const db = getDb()
    let messages = getThreadMessages(db, threadKey)
    const missing = messages.filter((m) => m.bodyState === 'none')
    if (missing.length > 0) {
      await Promise.allSettled(missing.map((m) => syncEngine.fetchBody(m.id)))
      messages = getThreadMessages(db, threadKey)
    }
    return { messages }
  },

  'messages:details': async ({ messageId }) => {
    const db = getDb()
    let details = getMessageHeaderDetails(db, messageId)
    if (!details) throw new Error('Nachricht nicht gefunden')
    if (!details.technicalAvailable) {
      try {
        const fetched = await syncEngine.fetchMessageHeaders(messageId)
        if (fetched) {
          storeMessageHeaderDetails(db, messageId, fetched)
          details = getMessageHeaderDetails(db, messageId) ?? details
        }
      } catch (error) {
        console.warn(
          `[headers] Details für Nachricht ${messageId} derzeit nicht verfügbar:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    return details
  },

  'messages:action': ({ messageIds, action }) => {
    syncEngine.applyAction(messageIds, action)
    return { ok: true }
  },

  'search:semantic': ({ q, limit, accountId }) => searchSemantic(getDb(), { q, limit, accountId }),

  'sync:trigger': (input) => {
    // Wakes disconnected connections AND immediately syncs connected accounts —
    // important for folders without IDLE (esp. spam), which otherwise wait for
    // the 10-minute poll. With accountId only one account (RETRY on error state, Design 3b).
    syncEngine.syncNow(input?.accountId)
    return { ok: true }
  },

  'ai:overrideCategory': ({ threadKey, category }) => {
    getDb()
      .prepare(
        `UPDATE ai_annotations SET user_override_category = ?
         WHERE message_id IN (SELECT id FROM messages WHERE thread_key = ?)`
      )
      .run(category, threadKey)
    return { ok: true }
  },

  'ai:profileModels': async ({ profileId, manual, kind }) => {
    const profile = getProfile(profileId)
    if (!profile) throw new Error('Anbieter nicht gefunden')
    // Local only: never fetch external catalogs automatically
    if (isLocalOnly() && !profile.isLocal && !manual) return { models: [], skipped: true }
    return { models: await listProfileModels(profile, kind), skipped: false }
  },
  'ai:decisions:test': ({ profileId, model }) => runDecisionTest(profileId, model),
  'diagnostics:status': () => diagnostics.status(),
  'diagnostics:setEnabled': ({ enabled }) => {
    diagnostics.setEnabled(enabled)
    return { ok: true as const }
  },
  'diagnostics:benchmark': () => diagnostics.benchmark(),
  'diagnostics:export': async ({ renderer, withBenchmark }) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), `noctua-diagnostics-${stamp}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      securityScopedBookmarks: false
    })
    if (canceled || !filePath) return { saved: false, fileName: null, bytes: 0 }
    const bytes = await diagnostics.exportZip(filePath, renderer, withBenchmark)
    return { saved: true, fileName: basename(filePath), bytes }
  },
  'diagnostics:clear': () => {
    diagnostics.clear()
    return { ok: true as const }
  },
  'security:get': ({ messageId }) => ({ security: getMailSecurity(getDb(), messageId) }),
  'security:check': async ({ messageId }) => {
    await runThreatCheck(getDb(), messageId)
    return { security: getMailSecurity(getDb(), messageId) }
  },

  'ai:detectLocal': () => detectLocalServers(),
  'ai:profiles:list': () => ({ profiles: listProfiles() }),
  'ai:profiles:create': (input) => ({ profile: createProfile(input) }),
  'ai:profiles:update': ({ id, ...patch }) => ({ profile: updateProfile(id, patch) }),
  'ai:profiles:delete': ({ id }) => {
    deleteProfile(id)
    return { ok: true }
  },
  'ai:profiles:setKey': ({ id, key }) => {
    setProfileKey(id, key)
    return { ok: true }
  },
  'ai:profiles:clearKey': ({ id }) => {
    clearProfileKey(id)
    return { ok: true }
  },
  'ai:profiles:test': ({ id }) => testProfileConnection(id),

  'ai:tasks:get': () => {
    const assignment = (task: AiTask): InvokeOutput<'ai:tasks:get'>['triage'] => {
      const profileId = getTaskProfileId(task)
      const profile = getProfile(profileId)
      return {
        profileId,
        model: profile ? (getTaskModel(task, profile) ?? '') : '',
        // Apple on-device (pseudo profile) counts as local and is never blocked
        blocked: profileId === 'apple' ? null : taskBlockReason(task)
      }
    }
    return {
      triage: assignment('triage'),
      draft: assignment('draft'),
      stt: assignment('stt'),
      decision: assignment('decision')
    }
  },
  'ai:tasks:set': ({ task, profileId, model }) => {
    setTaskAssignment(task, profileId, model)
    // A new assignment can release paused triage
    aiQueue.kick()
    return { ok: true }
  },

  'privacy:getLocalOnly': () => ({ localOnly: isLocalOnly() }),
  'privacy:setLocalOnly': ({ localOnly }) => {
    setLocalOnly(localOnly)
    if (!localOnly) {
      // Restart what was paused: triage and embedding indexing
      aiQueue.kick()
      embeddingIndexer.kick()
    }
    return { localOnly: isLocalOnly() }
  },

  'privacy:networkConnections': () => {
    const accounts = (
      getDb()
        .prepare('SELECT email, credential_type, imap_host, smtp_host FROM accounts ORDER BY id')
        .all() as Array<{
        email: string
        credential_type: string
        imap_host: string
        smtp_host: string
      }>
    ).map((a) => ({
      email: a.email,
      credentialType: a.credential_type,
      imapHost: a.imap_host,
      smtpHost: a.smtp_host
    }))
    const localOnly = isLocalOnly()
    return {
      localOnly,
      connections: buildNetworkConnections({
        accounts,
        profiles: listProfiles(),
        taskProfiles: {
          triage: getTaskProfileId('triage'),
          draft: getTaskProfileId('draft'),
          stt: getTaskProfileId('stt'),
          decision: getTaskProfileId('decision')
        },
        calendarAccounts: listCalendarAccounts().map((c) => ({
          name: c.name,
          serverUrl: c.serverUrl
        })),
        localOnly,
        feed: resolveUpdateFeed(),
        embeddingsCached: isEmbeddingModelCached()
      })
    }
  },

  'org:info': () => {
    const org = getOrgConfig()
    return {
      productName: productName(),
      hideOpenRouterOnboarding: org?.hideOpenRouterOnboarding === true,
      edition: org ? ('organisation' as const) : ('upstream' as const)
    }
  },

  'updates:checkNow': () => checkForUpdates({ manual: true }),

  'embeddings:status': () => {
    const status = embeddingIndexer.getStatus()
    return {
      state: status.model.state,
      cached: isEmbeddingModelCached(),
      error: status.model.error,
      eligible: status.eligible,
      indexed: status.indexed
    }
  },
  'embeddings:downloadModel': async () => {
    await embeddingIndexer.downloadModel()
    return { ok: true }
  },

  'ai:appleFm': async (input) => appleFmStatus(input?.force ?? false),

  'ai:testModel': ({ profileId, model }) => runModelTest(profileId, model),

  'ai:stylePreview': async ({ accountId }) => ({ text: await stylePreview(getDb(), accountId) }),

  'ai:transcribe': async ({ audioBase64, format }) => ({
    text: await transcribeAudio(getDb(), audioBase64, format)
  }),

  'ai:usage': () => ({
    // "Can the AI work?" — drafts/chat are what matters to the user
    hasApiKey: taskBlockReason('draft') === null,
    // A reason instead of just yes/no: "Local only" is not a missing key
    draftBlock: taskBlockReason('draft'),
    openrouterKey: getProfile('openrouter')?.hasKey ?? false,
    triageModel: getTriageModel(),
    draftModel: getDraftModel()
  }),

  'compose:send': ({ accountId, to, cc, bcc, subject, textBody, htmlBody, replyToMessageId }) =>
    outboxWorker.enqueue(accountId, { to, cc, bcc, subject, textBody, htmlBody, replyToMessageId }),

  'outbox:cancel': ({ outboxId }) => outboxWorker.cancel(outboxId),

  'rules:draft': async ({ text }) => {
    const draft = await draftRule(getDb(), text)
    return {
      name: draft.name,
      description: draft.description,
      ruleJson: JSON.stringify(draft.rule)
    }
  },

  'rules:save': ({ name, description, sourceText, ruleJson }) => {
    const rule = ruleJsonSchema.parse(JSON.parse(ruleJson))
    const result = getDb()
      .prepare(
        `INSERT INTO rules (name, description, source_text, rule_json, needs_ai, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        name,
        description,
        sourceText,
        JSON.stringify(rule),
        ruleNeedsAi(rule) ? 1 : 0,
        Date.now()
      )
    return { id: Number(result.lastInsertRowid) }
  },

  'rules:list': () => ({
    rules: (
      getDb()
        .prepare(
          'SELECT id, name, description, enabled, hits, rule_json FROM rules ORDER BY id DESC'
        )
        .all() as Array<{
        id: number
        name: string
        description: string | null
        enabled: number
        hits: number
        rule_json: string
      }>
    ).map(({ rule_json, ...r }) => ({
      ...r,
      enabled: r.enabled === 1,
      aiCondition: aiConditionOf(rule_json)
    }))
  }),

  'rules:toggle': ({ id, enabled }) => {
    getDb()
      .prepare('UPDATE rules SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id)
    return { ok: true }
  },

  'rules:delete': ({ id }) => {
    getDb().prepare('DELETE FROM rules WHERE id = ?').run(id)
    return { ok: true }
  },

  'contacts:suggest': ({ q, limit }) => ({ contacts: suggestContacts(getDb(), q, limit) }),

  'contacts:dav:status': ({ accountId }) => contactsStatus(getDb(), accountId),

  'contacts:dav:setSync': ({ accountId, enabled }) => setContactsSync(getDb(), accountId, enabled),

  'contacts:dav:setAddressBook': ({ addressBookId, enabled }) => {
    setAddressBookEnabled(getDb(), addressBookId, enabled)
    return { ok: true }
  },

  'contacts:preferredAccount': ({ addr }) => ({
    accountId: preferredAccountForContact(getDb(), addr)
  }),

  'ai:draftReply': ({ threadKey, instruction, idea, reviseText }) =>
    startDraftReply(getDb(), pushFn, { threadKey, instruction, idea, reviseText }),

  'ai:draftNew': ({ accountId, to, subject, idea, instruction }) =>
    startDraftNew(getDb(), pushFn, { accountId, to, subject, idea, instruction }),

  'attachments:save': async ({ attachmentId }) => ({
    savedPath: await saveAttachment(getDb(), attachmentId)
  }),

  'messages:inlineImages': async ({ messageId }) => ({
    images: await getInlineImages(getDb(), messageId)
  }),

  'images:allowSender': ({ addr, allow }) => {
    if (allow) setSetting(imagesAllowKey(addr), '1')
    else getDb().prepare('DELETE FROM settings WHERE key = ?').run(imagesAllowKey(addr))
    return { ok: true }
  },

  'tasks:list': ({ status }) => {
    const db = getDb()
    return { tasks: listTasks(db, status), openCount: countOpenTasks(db) }
  },

  'tasks:decideSuggestion': ({ threadKey, accept }) => {
    decideSuggestion(getDb(), threadKey, accept)
    pushFn('tasks:changed', {})
    return { ok: true as const }
  },

  'tasks:update': ({ id, status }) => {
    updateTaskStatus(getDb(), id, status)
    pushFn('tasks:changed', {})
    return { ok: true }
  },

  'tasks:sync:get': () => {
    const db = getDb()
    return { calendarId: targetCalendar(db)?.id ?? null, lists: listTaskLists(db) }
  },

  'tasks:sync:set': ({ calendarId }) => {
    setTasksSyncCalendar(getDb(), calendarId)
    pushFn('tasks:changed', {})
    return { ok: true as const }
  },

  'drafts:list': () => ({ drafts: listDrafts(getDb()) }),

  'drafts:save': ({ threadKey, text, html }) => {
    saveDraft(getDb(), threadKey, text, html)
    return { ok: true as const }
  },

  'drafts:delete': ({ threadKey }) => ({ ok: deleteDraft(getDb(), threadKey) }),

  'followups:list': () => ({ items: followupRadar.list() }),

  'followups:markNudged': ({ messageId }) => {
    followupRadar.markNudged(messageId)
    return { ok: true as const }
  },

  'followups:saveNudge': ({ messageId, draft }) => {
    getDb()
      .prepare('UPDATE followups SET nudge_draft = ? WHERE message_id = ?')
      .run(draft, messageId)
    return { ok: true }
  },

  'followups:draftNudge': ({ messageId, idea }) =>
    startDraftNudge(getDb(), pushFn, { messageId, idea }),

  'followups:dismiss': ({ messageId }) => {
    followupRadar.dismiss(messageId)
    return { ok: true }
  },

  'ai:chat': ({ question, history }) => startChat(getDb(), pushFn, { question, history }),

  'owl:list': () => ({ conversations: listOwlConversations(getDb()) }),

  'owl:get': ({ id }) => ({ conversation: getOwlConversation(getDb(), id) }),

  'owl:save': ({ id, title, messages }) => ({
    id: saveOwlConversation(getDb(), { id, title, messages })
  }),

  'owl:delete': ({ id }) => ({ ok: deleteOwlConversation(getDb(), id) }),

  'ai:refreshStyle': async (input) => {
    const profile = await refreshStyleProfile(getDb(), input?.accountId ?? null)
    return { ok: profile !== null }
  },

  'spell:check': async ({ words }) => {
    const engine = await getSpellEngine()
    return { misspelled: engine.check(words) }
  },

  'spell:suggest': async ({ word }) => {
    const engine = await getSpellEngine()
    return { suggestions: engine.suggest(word) }
  }
}
