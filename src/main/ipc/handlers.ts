import { app } from 'electron'
import { ImapFlow } from 'imapflow'
import type { IpcHandlers } from '@shared/ipc-contract'
import type { AccountSummary } from '@shared/types'
import { ACCOUNT_COLORS, PASTEL_COLORS } from '@shared/types'
import { getDb, getSetting, setSetting } from '../db'
import { getThreadMessages, imagesAllowKey, listThreads, mboxCounts } from '../db/repos/threads'
import { getInlineImages, saveAttachment } from '../mail/attachments'
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
import {
  accountSecretKey,
  buildImapOptions,
  PROVIDER_DEFAULTS,
  type AccountRow
} from '../auth/providers'
import { syncEngine } from '../sync/engine'
import { getDraftModel, getTriageModel } from '../ai/openrouter'
import { appleFmStatus } from '../ai/apple-fm'
import { startDraftNew, startDraftNudge, startDraftReply, stylePreview } from '../ai/drafts'
import { draftRule, ruleJsonSchema, ruleNeedsAi } from '../ai/rules'
import { outboxWorker } from '../smtp/outbox'
import { cancelMsLogin, msInteractiveLogin } from '../auth/msal'
import { cancelGoogleLogin, googleInteractiveLogin } from '../auth/google'
import { startChat } from '../ai/chat'
import { refreshStyleProfile } from '../ai/style'
import { listModels } from '../ai/models'
import { runModelTest } from '../ai/model-test'
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

/** Vom Bootstrap gesetzt — Handler, die streamen, pushen darüber. */
export function setHandlerPush(fn: PushFn): void {
  pushFn = fn
}

async function testImapLogin(
  email: string,
  password: string,
  host: string,
  port: number
): Promise<void> {
  // buildImapOptions kennt die Sonderfälle (STARTTLS-Ports, Loopback-Bridge)
  const client = new ImapFlow(
    buildImapOptions(
      { email, provider: 'imap', imap_host: host, imap_port: port },
      { user: email, pass: password }
    )
  )
  await client.connect()
  await client.logout()
}

function toSummary(row: AccountRow): AccountSummary {
  const { state, detail, errorSince } = syncEngine.getState(row.id)
  return {
    id: row.id,
    email: row.email,
    accountName: row.account_name,
    displayName: row.display_name,
    provider: row.provider,
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
  if (conflict) throw new Error(`Der Postfachname „${accountName.trim()}“ ist bereits vergeben`)
}

function countThreads(accountId: number): number {
  try {
    const row = getDb()
      .prepare('SELECT count(DISTINCT thread_key) n FROM messages WHERE account_id = ?')
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

  // Allowlist hier nochmals erzwungen (nicht nur im zod-Schema): OAuth-Client-
  // Konfiguration und fremde Secrets bleiben für den Renderer unerreichbar.
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
    if (!imapHost || !smtpHost) throw new Error('IMAP-/SMTP-Host fehlt')

    // App-Passwörter kommen oft mit Leerzeichen formatiert
    const password = input.password.replace(/\s+/g, '')
    await testImapLogin(input.email, password, imapHost, imapPort)

    const result = db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at, sync_days)
         VALUES (?, ?, ?, ?, 'password', ?, ?, ?, ?, 1, ?, ?, ?)`
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
    // Browser-Login zuerst — die Adresse kommt aus dem Microsoft-Konto selbst
    const { email } = await msInteractiveLogin()
    const db = getDb()
    const existing = db
      .prepare('SELECT id, account_name FROM accounts WHERE email = ?')
      .get(email) as { id: number; account_name: string } | undefined
    if (existing) {
      // Doppelt verbinden ist praktisch immer ein Versehen — klar blocken
      throw new Error(`${email} ist bereits als „${existing.account_name}" verbunden`)
    }

    const ms = PROVIDER_DEFAULTS.microsoft
    const result = db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at, sync_days)
         VALUES (?, ?, NULL, 'microsoft', 'oauth-ms', ?, ?, ?, ?, 1, ?, ?, ?)`
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
    // Browser-Login zuerst — die Adresse kommt aus dem Google-Konto selbst
    const { email } = await googleInteractiveLogin()
    const db = getDb()
    const existing = db
      .prepare('SELECT id, account_name, credential_type FROM accounts WHERE email = ?')
      .get(email) as
      | { id: number; account_name: string; credential_type: AccountRow['credential_type'] }
      | undefined
    if (existing) {
      // Eine bereits verbundene Adresse nochmal hinzuzufügen ist praktisch immer
      // ein Versehen — klar blocken statt still „erfolgreich" zu melden. Das eben
      // gespeicherte Refresh-Token wird nur behalten, wenn das Konto ohnehin per
      // Google-OAuth läuft (dann ist es schlicht das frischeste).
      if (existing.credential_type !== 'oauth-google') {
        deleteSecret(`google:refresh:${email}`)
      }
      throw new Error(
        `${email} ist bereits als „${existing.account_name}" verbunden — zum Umstellen auf den Google-Login das Postfach erst trennen`
      )
    }

    const g = PROVIDER_DEFAULTS.gmail
    const result = db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at, sync_days)
         VALUES (?, ?, NULL, 'gmail', 'oauth-google', ?, ?, ?, ?, 1, ?, ?, ?)`
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
      // Neustart des Syncers, damit das neue Fenster sofort gilt — ein größeres
      // lädt beim Reconnect nach (Backfill-Guard vergleicht die Grenze).
      if (before && before.sync_days !== syncDays) {
        await syncEngine.stopAccount(accountId)
        const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
          AccountRow | undefined
        if (row) syncEngine.startAccount(row)
      }
    }
    return { ok: true, accountName: savedAccountName }
  },

  'accounts:remove': async ({ accountId }) => {
    const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
      AccountRow | undefined
    await syncEngine.stopAccount(accountId)
    getDb().prepare('DELETE FROM accounts WHERE id = ?').run(accountId)
    deleteSecret(accountSecretKey(accountId))
    // Google-Refresh-Token hängt an der Adresse, nicht an der Konto-ID
    if (row?.credential_type === 'oauth-google') {
      deleteSecret(`google:refresh:${row.email.toLowerCase()}`)
    }
    return { ok: true }
  },

  'accounts:cancelOAuth': ({ provider }) => ({
    // Bricht den wartenden Browser-Login ab — das zugehörige addGoogle/
    // addMicrosoft-invoke verwirft dadurch, der Renderer räumt still auf.
    canceled: provider === 'gmail' ? cancelGoogleLogin() : cancelMsLogin()
  }),

  'threads:list': ({ limit, accountId, mbox }) => ({
    threads: listThreads(getDb(), limit, accountId, mbox)
  }),

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
    // Weckt getrennte Verbindungen UND zieht verbundene Konten sofort nach —
    // wichtig für Ordner ohne IDLE (v. a. Spam), die sonst am 10-Minuten-Poll
    // hängen. Mit accountId nur ein Konto (RETRY am Fehlerzustand, Design 3b).
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

  'ai:models': async () => ({ models: await listModels() }),

  'ai:appleFm': async (input) => appleFmStatus(input?.force ?? false),

  'ai:testModel': ({ model }) => runModelTest(model),

  'ai:stylePreview': async ({ accountId }) => ({ text: await stylePreview(getDb(), accountId) }),

  'ai:transcribe': async ({ audioBase64, format }) => ({
    text: await transcribeAudio(getDb(), audioBase64, format)
  }),

  'ai:usage': () => ({
    hasApiKey: hasSecret('openrouter.apiKey'),
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
        .prepare('SELECT id, name, description, enabled, hits FROM rules ORDER BY id DESC')
        .all() as Array<{
        id: number
        name: string
        description: string | null
        enabled: number
        hits: number
      }>
    ).map((r) => ({ ...r, description: r.description, enabled: r.enabled === 1 }))
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
