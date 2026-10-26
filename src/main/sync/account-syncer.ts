import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from 'imapflow'
import type Database from 'better-sqlite3-multiple-ciphers'
import { isTlsPinMismatch } from '../auth/loopback-tls'
import { imapConnectOptions, type AccountRow, type MailCredentials } from '../auth/providers'
import { parseMail, type ParsedMail } from '../mail/parser'
import {
  applyFlagUpdates,
  deleteByUids,
  storeBody,
  upsertEnvelope,
  type EnvelopeData
} from '../mail/ingest'
import { isReauthError } from '../auth/reauth'
import { rebuildContactStats } from '../db/repos/contacts'
import { applyRules } from '../ai/rules'
import {
  storeMessageHeaderDetails,
  type FetchedMessageHeaderData
} from '../db/repos/message-headers'
import { OpDeadError } from './op-queue'
import { resetFolderForUidValidity } from './uidvalidity'
import { inferSpecialUses } from '@shared/folder-roles'
import { metrics } from '../diagnostics/metrics'

const DEFAULT_ENVELOPE_BACKFILL_DAYS = 90
export const SEARCH_BACKFILL_DAYS = 183
const ENVELOPE_CHUNK = 200
const BODY_CHUNK = 10
const BODY_PASS_LIMIT = 50
/** After this many failed fetches the backfill skips a message (opening it still fetches). */
export const MAX_BODY_ATTEMPTS = 3
/** Larger messages are skipped by the background backfill (parser DoS defense); opening one still fetches it. */
export const MAX_BACKFILL_BODY_BYTES = 64 * 1024 * 1024
const FLAG_RESYNC_WINDOW = 500
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
// In case IDLE dies silently: additionally poll INBOX regularly
const INBOX_WATCHDOG_MS = 5 * 60_000

export type SyncState = 'idle' | 'connecting' | 'syncing' | 'error' | 'needs-reauth' | 'off'

/**
 * Login rejected by the server (imapflow sets `authenticationFailed`)? Then
 * no reconnect loop helps — the user has to provide new credentials.
 */
export function isAuthFailure(error: unknown): boolean {
  const e = error as { authenticationFailed?: unknown; serverResponseCode?: unknown } | null
  return (
    e?.authenticationFailed === true ||
    e?.serverResponseCode === 'AUTHENTICATIONFAILED' ||
    // OAuth refresh failed (invalid_grant / interaction_required)
    isReauthError(error) ||
    // Bridge certificate changed: no retry loop, user confirms via password
    isTlsPinMismatch(error)
  )
}

export interface SyncEvents {
  onState: (state: SyncState, detail: string | null) => void
  onMessagesChanged: (folderId: number | null, threadKeys: string[]) => void
}

export interface QueuedOp {
  id: number
  kind: 'setFlags' | 'move' | 'delete' | 'append'
  payload: {
    folderId?: number
    uids?: number[]
    add?: string[]
    remove?: string[]
    targetSpecialUse?: string
    /** The folder's UIDVALIDITY at enqueue — if it differs, the UIDs are invalid. */
    uidValidity?: number
  }
}

interface FolderRow {
  id: number
  path: string
  special_use: string | null
  uidvalidity: number | null
  uidnext: number | null
  sync_mode: string
  envelope_backfill_since: number | null
  body_backfill_since: number | null
}

const SEARCHABLE_SPECIAL_USES = new Set(['\\Inbox', '\\Sent', '\\Archive'])

/**
 * Next messages for the body backfill (parameters: folder id,
 * MAX_BODY_ATTEMPTS, cutoff, excluded ids, limit). Walks the partial index
 * idx_msg_body_pending (only messages without a body) newest first.
 */
export function pendingBodiesSql(excludedCount: number): string {
  const exclusion =
    excludedCount > 0 ? `AND id NOT IN (${Array(excludedCount).fill('?').join(',')})` : ''
  return `SELECT id, uid, thread_key FROM messages
    WHERE folder_id = ? AND body_state = 'none' AND body_attempts < ?
      AND (coalesce(date, internal_date) IS NULL OR coalesce(date, internal_date) >= ?)
      AND coalesce(size, 0) <= ${MAX_BACKFILL_BODY_BYTES}
      ${exclusion}
    ORDER BY coalesce(date, internal_date) DESC, id DESC
    LIMIT ?`
}

function isSearchableFolder(folder: Pick<FolderRow, 'special_use'>): boolean {
  return folder.special_use !== null && SEARCHABLE_SPECIAL_USES.has(folder.special_use)
}

/**
 * An account's backfill limit as epoch milliseconds: a set
 * sync period (accounts.sync_days) applies to list AND search, 0 means
 * "sync everything" (limit 0). Without a setting the
 * default windows apply (90 days list, 183 days search).
 */
export function backfillCutoff(
  syncDays: number | null | undefined,
  searchable: boolean,
  now = Date.now()
): number {
  if (syncDays === 0) return 0
  const days = syncDays ?? (searchable ? SEARCH_BACKFILL_DAYS : DEFAULT_ENVELOPE_BACKFILL_DAYS)
  return now - days * 24 * 3600 * 1000
}

/**
 * Iterative instead of recursive: BODYSTRUCTURE comes from the server — a deeply
 * nested structure must not trigger a stack overflow that aborts the
 * ingest transaction again on every sync (SEC, vuln-0008).
 */
export function structureHasAttachments(root: unknown): boolean {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const n = node as { disposition?: string; childNodes?: unknown[] }
    if (typeof n.disposition === 'string' && n.disposition.toLowerCase() === 'attachment')
      return true
    if (Array.isArray(n.childNodes)) {
      for (const child of n.childNodes) stack.push(child)
    }
  }
  return false
}

function extractHeader(headers: Buffer | undefined, name: string): string | null {
  if (!headers) return null
  const pattern = new RegExp(`^${name}:[ \\t]*((?:[^\\r\\n]|\\r?\\n[ \\t])+)`, 'im')
  return headers.toString('binary').match(pattern)?.[1] ?? null
}

/** Upper limit for References — the newest (last) entries suffice for threading. */
const MAX_REFERENCES = 100

function extractReferences(headers: Buffer | undefined): string[] {
  const refs = extractHeader(headers, 'references')?.match(/<[^<>]+>/g) ?? []
  return refs.length > MAX_REFERENCES ? refs.slice(-MAX_REFERENCES) : refs
}

function mapHeaderAddresses(list?: MessageAddressObject[]): FetchedMessageHeaderData['to'] {
  return (list ?? [])
    .filter((address) => address.address)
    .map((address) => ({
      name: address.name?.trim() || null,
      address: address.address!.toLowerCase()
    }))
}

function rawHeaderBlock(source: Buffer): Buffer {
  const crlfBoundary = source.indexOf('\r\n\r\n')
  if (crlfBoundary >= 0) return source.subarray(0, crlfBoundary)
  const lfBoundary = source.indexOf('\n\n')
  return lfBoundary >= 0 ? source.subarray(0, lfBoundary) : source
}

function toEnvelopeData(msg: FetchMessageObject): EnvelopeData {
  const env = msg.envelope
  const from = env?.from?.[0]
  const mapAddr = (list?: Array<{ name?: string; address?: string }>): EnvelopeData['to'] =>
    (list ?? [])
      .filter((a) => a.address)
      .map((a) => ({ name: a.name?.trim() || null, address: a.address!.toLowerCase() }))
  return {
    uid: msg.uid,
    gmMsgid: msg.emailId ?? null,
    gmThrid: msg.threadId ?? null,
    messageId: env?.messageId ?? null,
    inReplyTo: env?.inReplyTo ?? null,
    references: extractReferences(msg.headers),
    subject: env?.subject ?? null,
    fromAddr: from?.address?.toLowerCase() ?? null,
    fromName: from?.name?.trim() || from?.address?.toLowerCase() || null,
    to: mapAddr(env?.to),
    cc: mapAddr(env?.cc),
    replyTo: mapAddr(env?.replyTo),
    date: env?.date ? new Date(env.date).getTime() : null,
    internalDate: msg.internalDate ? new Date(msg.internalDate).getTime() : null,
    size: msg.size ?? null,
    flags: msg.flags ?? new Set(),
    hasAttachments: structureHasAttachments(msg.bodyStructure),
    listUnsubscribe: extractHeader(msg.headers, 'list-unsubscribe') !== null,
    listUnsubscribeUrl: extractHeader(msg.headers, 'list-unsubscribe'),
    listUnsubscribePost:
      extractHeader(msg.headers, 'list-unsubscribe-post')?.toLowerCase().includes('one-click') ??
      false
  }
}

/**
 * Syncs an account: command connection (backfill, fetches, ops) plus
 * a dedicated IDLE connection on INBOX. Reconnect with exponential backoff.
 */
export class AccountSyncer {
  private cmd: ImapFlow | null = null
  private idleConn: ImapFlow | null = null
  private stopped = false
  private backoffAttempt = 0
  private chain: Promise<unknown> = Promise.resolve()
  private idleDebounce: NodeJS.Timeout | null = null
  private wakeReconnect: (() => void) | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private watchdogTimer: NodeJS.Timeout | null = null
  private needsReauth = false
  // Folder syncs not yet started — identical requests share one run
  private pendingFolderSyncs = new Map<number, Promise<void>>()
  private folders: FolderRow[] = []

  constructor(
    private readonly db: Database.Database,
    readonly account: AccountRow,
    private readonly getCredentials: () => Promise<MailCredentials>,
    private readonly events: SyncEvents
  ) {}

  start(): void {
    void this.runLoop()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.wakeReconnect?.()
    if (this.idleDebounce) clearTimeout(this.idleDebounce)
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    await Promise.allSettled([this.cmd?.logout(), this.idleConn?.logout()])
    this.cmd = null
    this.idleConn = null
    this.events.onState('off', null)
  }

  /**
   * Aborts a running backoff wait (e.g. after system wakeup). Deliberately
   * ineffective in the needs-reauth state: repeated wrong logins
   * can get the account locked at the provider.
   */
  wake(): void {
    if (this.needsReauth) return
    this.wakeReconnect?.()
  }

  /** User action (RETRY, new credentials): also ends needs-reauth. */
  retryNow(): void {
    this.needsReauth = false
    this.wakeReconnect?.()
  }

  isConnected(): boolean {
    return !!this.cmd?.usable
  }

  /** Serializes work on the command connection. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        this.events.onState('connecting', null)
        await this.connectAndSync()
        this.backoffAttempt = 0
        this.events.onState('idle', null)
        await this.waitForDisconnect()
      } catch (error) {
        if (this.stopped) break
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[sync:${this.account.email}] error: ${message}`)
        if (isAuthFailure(error)) {
          // No backoff loop against wrong credentials: wait until the user
          // presses RETRY or changes the credentials (retryNow / restart).
          this.needsReauth = true
          this.backoffAttempt = 0
          this.events.onState('needs-reauth', message)
        } else {
          this.events.onState('error', message)
        }
      }
      await Promise.allSettled([this.cmd?.logout(), this.idleConn?.logout()])
      this.cmd = null
      this.idleConn = null
      if (this.stopped) break

      if (this.needsReauth) {
        await new Promise<void>((resolve) => {
          this.wakeReconnect = resolve
        })
        this.needsReauth = false
        continue
      }
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.backoffAttempt)
      const jittered = delay * (0.7 + Math.random() * 0.6)
      this.backoffAttempt += 1
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, jittered)
        this.wakeReconnect = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  }

  private async connectAndSync(): Promise<void> {
    const options = await imapConnectOptions(this.account, await this.getCredentials())
    this.cmd = new ImapFlow(options)
    this.cmd.on('error', (err) => console.warn(`[sync:${this.account.email}] cmd:`, err.message))
    await this.cmd.connect()

    this.events.onState('syncing', null)
    const folders = await this.syncFolderList()
    this.folders = folders
    for (const folder of folders) {
      if (folder.sync_mode !== 'full') continue
      await this.enqueue(() => this.syncFolder(folder))
      if (folder.special_use === '\\Sent') {
        metrics.time('db.contacts.rebuildStats', () =>
          rebuildContactStats(this.db, this.account.id)
        )
      }
    }
    const inbox = folders.find((f) => f.special_use === '\\Inbox')
    // Start IDLE first; the progressive body backfill must not block new mails
    // for minutes.
    if (inbox) await this.startIdle(inbox)

    for (const folder of folders.filter(isSearchableFolder)) {
      void this.enqueue(() => this.backfillBodies(folder)).catch((error) =>
        console.warn(`[sync:${this.account.email}] Body-Backfill ${folder.path}:`, error)
      )
    }
    // Non-INBOX folders have no IDLE — catch up incrementally every 10 minutes.
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      for (const folder of this.folders) {
        if (folder.sync_mode === 'full' && folder.special_use !== '\\Inbox') {
          void this.enqueueFolderSync(folder).catch((error) =>
            console.warn(`[sync:${this.account.email}] Poll ${folder.path}:`, error)
          )
        }
      }
    }, 10 * 60_000)
    // Watchdog: IDLE can die without a close event — then the INBOX would never
    // sync again. If the poll fails, the normal reconnect kicks in.
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    if (inbox) {
      this.watchdogTimer = setInterval(() => {
        void this.enqueueFolderSync(inbox).catch((error) =>
          console.warn(`[sync:${this.account.email}] INBOX-Watchdog:`, error)
        )
      }, INBOX_WATCHDOG_MS)
    }
  }

  /**
   * Manual refresh (refresh button/⌘K): catch up all full-sync folders
   * incrementally right away instead of waiting for IDLE or the 10-minute
   * poll — the only fast path for folders without IDLE (esp. spam).
   */
  refreshNow(): void {
    // Disconnected/backoff: waking up is enough — the reconnect syncs everything anyway.
    this.retryNow()
    if (!this.cmd) return
    // Re-read the folder list: new folders and a toggled folder sync
    // (mail.showFolders) take effect without a reconnect.
    void this.enqueue(async () => {
      this.folders = await this.syncFolderList()
    })
      .catch((error) => console.warn(`[sync:${this.account.email}] Ordnerliste:`, error))
      .then(() => {
        for (const folder of this.folders) {
          if (folder.sync_mode !== 'full') continue
          void this.enqueueFolderSync(folder).catch((error) =>
            console.warn(`[sync:${this.account.email}] Refresh ${folder.path}:`, error)
          )
        }
      })
  }

  /** Targeted resync of a folder (e.g. Sent right after sending). */
  resyncSpecialUse(specialUse: string): Promise<void> {
    const folder = this.folders.find((f) => f.special_use === specialUse)
    if (!folder || !this.cmd) return Promise.resolve()
    return this.enqueueFolderSync(folder).then(() => {
      if (specialUse === '\\Sent') {
        metrics.time('db.contacts.rebuildStats', () =>
          rebuildContactStats(this.db, this.account.id)
        )
      }
    })
  }

  /**
   * Enqueues a folder sync (+ body backfill). If one is already queued for the
   * folder and not yet running, both requests share
   * that run — IDLE bursts, poll and refresh no longer pile up.
   */
  private enqueueFolderSync(folder: FolderRow): Promise<void> {
    const pending = this.pendingFolderSyncs.get(folder.id)
    if (pending) return pending
    const run = this.enqueue(async () => {
      this.pendingFolderSyncs.delete(folder.id) // from now on a new request counts again
      await this.syncFolder(folder)
      if (isSearchableFolder(folder)) await this.backfillBodies(folder)
    })
    this.pendingFolderSyncs.set(folder.id, run)
    // If the run fails before it started, the entry must not get stuck
    void run.catch(() => {
      if (this.pendingFolderSyncs.get(folder.id) === run) this.pendingFolderSyncs.delete(folder.id)
    })
    return run
  }

  /**
   * Stored UIDs are only valid for the UIDVALIDITY they were synced under. If
   * the locked mailbox reports another one, a UID fetch would return a different
   * message — skip it and let the folder sync run the reset.
   */
  private uidValidityChanged(folderId: number, expected: number | null): boolean {
    const mailbox = this.cmd?.mailbox
    const live = mailbox && typeof mailbox !== 'boolean' ? Number(mailbox.uidValidity) : null
    if (expected === null || live === null || live === expected) return false
    console.warn(`[sync:${this.account.email}] UIDVALIDITY ${expected} → ${live}, fetch skipped`)
    const folder = this.folders.find((f) => f.id === folderId)
    if (folder) {
      void this.enqueueFolderSync(folder).catch((error) =>
        console.warn(`[sync:${this.account.email}] Resync ${folder.path}:`, error)
      )
    }
    return true
  }

  /** Have the folder re-reconciled after a discarded op (full backfill dedupes). */
  invalidateFolder(folderId: number): void {
    const folder = this.folders.find((f) => f.id === folderId)
    this.db
      .prepare('UPDATE folders SET uidnext = NULL, envelope_backfill_since = NULL WHERE id = ?')
      .run(folderId)
    if (!folder) return
    folder.uidnext = null
    folder.envelope_backfill_since = null
    if (this.cmd && folder.sync_mode === 'full') {
      void this.enqueueFolderSync(folder).catch((error) =>
        console.warn(`[sync:${this.account.email}] Resync ${folder.path}:`, error)
      )
    }
  }

  private async waitForDisconnect(): Promise<void> {
    await new Promise<void>((resolve) => {
      const onClose = (): void => resolve()
      this.cmd?.once('close', onClose)
      this.idleConn?.once('close', onClose)
      if (this.stopped) resolve()
    })
    if (!this.stopped) throw new Error('connection closed')
  }

  private async syncFolderList(): Promise<FolderRow[]> {
    const list = await this.cmd!.list()
    const rows: FolderRow[] = []
    const upsert = this.db.prepare(
      `INSERT INTO folders (account_id, path, special_use, sync_mode, delimiter)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, path) DO UPDATE SET
         special_use = excluded.special_use, sync_mode = excluded.sync_mode,
         delimiter = excluded.delimiter
       RETURNING id, path, special_use, uidvalidity, uidnext, sync_mode,
                 envelope_backfill_since, body_backfill_since`
    )
    // Folder view on: sync own folders too (envelopes in the backfill window)
    const userFolders =
      (
        this.db.prepare("SELECT value FROM settings WHERE key = 'mail.showFolders'").get() as
          { value: string } | undefined
      )?.value === '1'
    // Server without SPECIAL-USE: fill in roles by name — esp. Junk
    const specialUses = inferSpecialUses(list)
    list.forEach((box, i) => {
      const specialUse = specialUses[i]
      let syncMode = 'off'
      // Sync Junk fully: the SPAM folder filter needs the envelopes.
      // Triage/embeddings/badge stay limited to \Inbox — spam costs nothing.
      if (
        specialUse === '\\Inbox' ||
        specialUse === '\\Sent' ||
        specialUse === '\\Archive' ||
        specialUse === '\\Junk'
      )
        syncMode = 'full'
      else if (specialUse === '\\Trash') syncMode = 'flags'
      else if (specialUse === null && userFolders && !box.flags?.has('\\Noselect'))
        syncMode = 'full'
      // Gmail "All Mail" is the duplicate trap — never sync it.
      if (specialUse === '\\All' || specialUse === '\\Flagged') syncMode = 'off'
      rows.push(
        upsert.get(
          this.account.id,
          box.path,
          specialUse,
          syncMode,
          box.delimiter ?? null
        ) as FolderRow
      )
    })
    return rows
  }

  private async syncFolder(folder: FolderRow): Promise<void> {
    const endSpan = metrics.span('sync.folder')
    const lock = await this.cmd!.getMailboxLock(folder.path)
    try {
      const mailbox = this.cmd!.mailbox
      if (!mailbox || typeof mailbox === 'boolean') return
      const uidValidity = Number(mailbox.uidValidity ?? 0)

      if (folder.uidvalidity !== null && folder.uidvalidity !== uidValidity) {
        console.warn(`[sync:${this.account.email}] UIDVALIDITY changed for ${folder.path} — reset`)
        // Atomic (REL-3): delete + new UIDVALIDITY + cursor reset in one transaction
        resetFolderForUidValidity(this.db, folder.id, uidValidity)
        folder.uidvalidity = uidValidity
        folder.uidnext = null
        folder.envelope_backfill_since = null
        folder.body_backfill_since = null
      }

      if (folder.uidvalidity === null) {
        // Stamp before the first backfill: ops on messages ingested now carry it
        this.db
          .prepare('UPDATE folders SET uidvalidity = ? WHERE id = ?')
          .run(uidValidity, folder.id)
        folder.uidvalidity = uidValidity
      }

      if (folder.uidnext === null) {
        await this.backfillFolder(folder)
      } else {
        await this.incrementalSync(folder)
        // M13: existing accounts already had uidnext, but only 90 days.
        // The cursor catches up on the missing history exactly once.
        if (isSearchableFolder(folder)) await this.backfillFolder(folder)
      }

      this.db
        .prepare('UPDATE folders SET uidvalidity = ?, uidnext = ?, last_synced_at = ? WHERE id = ?')
        .run(uidValidity, mailbox.uidNext ?? folder.uidnext, Date.now(), folder.id)
      folder.uidvalidity = uidValidity
      folder.uidnext = mailbox.uidNext ?? folder.uidnext
    } finally {
      lock.release()
      endSpan()
    }
  }

  private fetchOptions(): {
    uid: boolean
    flags: boolean
    envelope: boolean
    internalDate: boolean
    size: boolean
    bodyStructure: boolean
    threadId: boolean
    headers: string[]
  } {
    return {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
      threadId: true,
      headers: ['references', 'list-unsubscribe', 'list-unsubscribe-post']
    }
  }

  private ingestBatch(folder: FolderRow, messages: FetchMessageObject[]): string[] {
    const threadKeys = new Set<string>()
    // Per-message savepoint: one poison message is skipped instead of rolling
    // back the batch — otherwise UIDNEXT never advances and the folder stalls.
    const ingestOne = this.db.transaction((msg: FetchMessageObject) =>
      upsertEnvelope(this.db, this.account.id, folder.id, toEnvelopeData(msg))
    )
    const tx = this.db.transaction(() => {
      for (const msg of messages) {
        try {
          const result = ingestOne(msg)
          if (result) threadKeys.add(result.threadKey)
        } catch (error) {
          console.warn(`[sync:${this.account.email}] envelope uid ${msg.uid} skipped:`, error)
          metrics.count('sync.envelopesSkipped', 1)
        }
      }
    })
    metrics.time('sync.ingestBatch', tx, { messages: messages.length })
    metrics.count('sync.envelopesIngested', messages.length)
    return [...threadKeys]
  }

  private async backfillFolder(folder: FolderRow): Promise<void> {
    const cutoff = backfillCutoff(this.account.sync_days, isSearchableFolder(folder))
    if (
      isSearchableFolder(folder) &&
      folder.envelope_backfill_since !== null &&
      folder.envelope_backfill_since <= cutoff
    ) {
      return
    }
    const uids = await this.cmd!.search(
      cutoff === 0 ? { all: true } : { since: new Date(cutoff) },
      { uid: true }
    )
    const sorted = [...(uids === false ? [] : uids)].sort((a, b) => b - a)
    const known = new Set(
      (
        this.db.prepare('SELECT uid FROM messages WHERE folder_id = ?').all(folder.id) as Array<{
          uid: number
        }>
      ).map((row) => row.uid)
    )
    const missing = sorted.filter((uid) => !known.has(uid))

    for (let i = 0; i < missing.length; i += ENVELOPE_CHUNK) {
      if (this.stopped) return
      const chunk = missing.slice(i, i + ENVELOPE_CHUNK)
      const endChunk = metrics.span('sync.backfill.envelopeChunk')
      const messages: FetchMessageObject[] = []
      for await (const msg of this.cmd!.fetch(chunk.join(','), this.fetchOptions(), {
        uid: true
      })) {
        messages.push(msg)
      }
      const threadKeys = this.ingestBatch(folder, messages)
      endChunk({ messages: messages.length })
      this.events.onMessagesChanged(folder.id, threadKeys)
    }
    if (isSearchableFolder(folder)) {
      this.db
        .prepare('UPDATE folders SET envelope_backfill_since = ? WHERE id = ?')
        .run(cutoff, folder.id)
      folder.envelope_backfill_since = cutoff
    }
  }

  private async incrementalSync(folder: FolderRow): Promise<void> {
    // 1) New messages from the known UIDNEXT
    const endNew = metrics.span('sync.incremental.newMessages')
    const messages: FetchMessageObject[] = []
    for await (const msg of this.cmd!.fetch(`${folder.uidnext}:*`, this.fetchOptions(), {
      uid: true
    })) {
      if (msg.uid >= (folder.uidnext ?? 0)) messages.push(msg)
    }
    endNew({ messages: messages.length })
    if (messages.length > 0) {
      const threadKeys = this.ingestBatch(folder, messages)
      this.events.onMessagesChanged(folder.id, threadKeys)
    }

    // 2) Flags + expunge in the most recent window (CONDSTORE-independent, robust)
    const known = this.db
      .prepare('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid DESC LIMIT ?')
      .all(folder.id, FLAG_RESYNC_WINDOW) as Array<{ uid: number }>
    if (known.length === 0) return
    const minUid = known[known.length - 1].uid
    const endFlags = metrics.span('sync.incremental.flags')
    const serverUids = new Set<number>()
    const updates: Array<{ uid: number; flags: Set<string> }> = []
    for await (const msg of this.cmd!.fetch(
      `${minUid}:*`,
      { uid: true, flags: true },
      { uid: true }
    )) {
      serverUids.add(msg.uid)
      updates.push({ uid: msg.uid, flags: msg.flags ?? new Set() })
    }
    // Only real changes count: an unchanged window must not refresh ~500 threads
    const changedThreads = applyFlagUpdates(this.db, folder.id, updates)
    const vanished = known.filter((k) => !serverUids.has(k.uid)).map((k) => k.uid)
    if (vanished.length > 0) deleteByUids(this.db, folder.id, vanished)
    endFlags({
      uids: serverUids.size,
      changedThreads: changedThreads.length,
      vanished: vanished.length
    })
    if (vanished.length > 0 || changedThreads.length > 0) {
      this.events.onMessagesChanged(folder.id, changedThreads)
    }
  }

  private async backfillBodies(folder: FolderRow, skippedIds: number[] = []): Promise<void> {
    if (!isSearchableFolder(folder)) return
    const endPass = metrics.span('sync.bodies.pass')
    const cutoff = backfillCutoff(this.account.sync_days, true)
    const excluded = [...new Set(skippedIds)]
    const pending = this.db
      .prepare(pendingBodiesSql(excluded.length))
      .all(folder.id, MAX_BODY_ATTEMPTS, cutoff, ...excluded, BODY_PASS_LIMIT) as Array<{
      id: number
      uid: number
      thread_key: string
    }>

    const failedIds: number[] = []
    for (let i = 0; i < pending.length; i += BODY_CHUNK) {
      if (this.stopped) return
      const batch = pending.slice(i, i + BODY_CHUNK)
      // One FETCH per batch instead of one round trip per message. The lock
      // guarantees the right selected mailbox.
      const sources = new Map<number, Buffer>()
      const lock = await this.cmd!.getMailboxLock(folder.path)
      try {
        if (this.uidValidityChanged(folder.id, folder.uidvalidity)) return
        await metrics.timeAsync(
          'sync.bodies.fetchChunk',
          async () => {
            for await (const msg of this.cmd!.fetch(
              batch.map((row) => row.uid).join(','),
              { source: true },
              { uid: true }
            )) {
              if (msg.source) sources.set(msg.uid, msg.source)
            }
          },
          { messages: batch.length }
        )
      } finally {
        lock.release()
      }

      const stored: Array<{ id: number; threadKey: string; source: Buffer; parsed: ParsedMail }> =
        []
      for (const row of batch) {
        const source = sources.get(row.uid)
        if (!source) {
          failedIds.push(row.id)
          continue
        }
        metrics.count('sync.bodies.bytes', source.length)
        try {
          const parsed = await metrics.timeAsync('mail.parse', () => parseMail(source), {
            kb: Math.round(source.length / 1024)
          })
          stored.push({ id: row.id, threadKey: row.thread_key, source, parsed })
        } catch (error) {
          console.warn(`[sync:${this.account.email}] parse failed:`, error)
          failedIds.push(row.id)
        }
      }
      const batchFailed = batch.filter((row) => !stored.some((s) => s.id === row.id))
      metrics.time(
        'sync.bodies.store',
        () =>
          this.db.transaction(() => {
            for (const s of stored) this.storeFetchedBody(s.id, s.source, s.parsed)
            const countAttempt = this.db.prepare(
              'UPDATE messages SET body_attempts = body_attempts + 1 WHERE id = ?'
            )
            for (const row of batchFailed) countAttempt.run(row.id)
          })(),
        { messages: stored.length }
      )
      for (const s of stored) this.applyIngestRules(s.id)
      // A batch where every fetch failed changed nothing: no refresh
      if (stored.length > 0) {
        this.events.onMessagesChanged(folder.id, [...new Set(stored.map((s) => s.threadKey))])
      }
    }
    endPass({ pending: pending.length, failed: failedIds.length })

    const remaining = this.db
      .prepare(
        `SELECT count(*) AS count FROM messages
         WHERE folder_id = ? AND body_state = 'none' AND body_attempts < ?
           AND (coalesce(date, internal_date) IS NULL OR coalesce(date, internal_date) >= ?)
      AND coalesce(size, 0) <= ${MAX_BACKFILL_BODY_BYTES}`
      )
      .get(folder.id, MAX_BODY_ATTEMPTS, cutoff) as { count: number }
    if (remaining.count === 0) {
      this.db
        .prepare('UPDATE folders SET body_backfill_since = ? WHERE id = ?')
        .run(cutoff, folder.id)
      folder.body_backfill_since = cutoff
    } else if (!this.stopped) {
      const nextExcluded = [...excluded, ...failedIds]
      const nextExclusionSql =
        nextExcluded.length > 0 ? `AND id NOT IN (${nextExcluded.map(() => '?').join(',')})` : ''
      const untried = this.db
        .prepare(
          `SELECT count(*) AS count FROM messages
           WHERE folder_id = ? AND body_state = 'none' AND body_attempts < ?
             AND (coalesce(date, internal_date) IS NULL OR coalesce(date, internal_date) >= ?)
      AND coalesce(size, 0) <= ${MAX_BACKFILL_BODY_BYTES}
             ${nextExclusionSql}`
        )
        .get(folder.id, MAX_BODY_ATTEMPTS, cutoff, ...nextExcluded) as { count: number }
      if (untried.count === 0) return
      // Queue the next small pass at the back. That way the backfill reaches
      // more than 500 bodies without blocking sending/archiving for minutes.
      void this.enqueue(() => this.backfillBodies(folder, nextExcluded)).catch((error) =>
        console.warn(`[sync:${this.account.email}] Body-Backfill ${folder.path}:`, error)
      )
    }
  }

  /** Body, attachments, search index and header details of a fetched message. */
  private storeFetchedBody(messageId: number, source: Buffer, parsed: ParsedMail): void {
    storeBody(this.db, messageId, parsed)
    storeMessageHeaderDetails(this.db, messageId, {
      from: parsed.from ? [parsed.from] : [],
      sender: parsed.sender ? [parsed.sender] : [],
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc ?? [],
      replyTo: parsed.replyTo,
      rawHeaders: rawHeaderBlock(source)
    })
  }

  private applyIngestRules(messageId: number): void {
    try {
      applyRules(this.db, messageId, 'ingest')
    } catch (error) {
      console.warn('[rules]', error)
    }
  }

  /** Assumes the message's mailbox is already locked/selected. */
  private async fetchBodyInSelectedMailbox(messageId: number): Promise<string | null> {
    const row = this.db
      .prepare('SELECT uid, thread_key FROM messages WHERE id = ?')
      .get(messageId) as { uid: number; thread_key: string } | undefined
    if (!row) return null
    const msg = await metrics.timeAsync('sync.bodies.fetchOne', () =>
      this.cmd!.fetchOne(String(row.uid), { source: true }, { uid: true })
    )
    if (!msg || !msg.source) return null
    metrics.count('sync.bodies.bytes', msg.source.length)
    const parsed = await metrics.timeAsync('mail.parse', () => parseMail(msg.source!), {
      kb: Math.round(msg.source.length / 1024)
    })
    metrics.time('sync.bodies.store', () =>
      this.db.transaction(() => this.storeFetchedBody(messageId, msg.source!, parsed))()
    )
    this.applyIngestRules(messageId)
    return row.thread_key
  }

  /** Raw RFC822 source of a message (attachment extraction). */
  fetchRawSource(messageId: number): Promise<Buffer | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare(
          `SELECT m.uid, f.id folder_id, f.path, f.uidvalidity
           FROM messages m JOIN folders f ON m.folder_id = f.id WHERE m.id = ?`
        )
        .get(messageId) as
        { uid: number; folder_id: number; path: string; uidvalidity: number | null } | undefined
      if (!row || !this.cmd) return null
      const lock = await this.cmd.getMailboxLock(row.path)
      try {
        if (this.uidValidityChanged(row.folder_id, row.uidvalidity)) return null
        const msg = await this.cmd.fetchOne(String(row.uid), { source: true }, { uid: true })
        return msg && msg.source ? msg.source : null
      } finally {
        lock.release()
      }
    })
  }

  /** Only envelope + full headers; doesn't load often large bodies/attachments. */
  fetchMessageHeaders(messageId: number): Promise<FetchedMessageHeaderData | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare(
          `SELECT m.uid, f.id folder_id, f.path, f.uidvalidity
           FROM messages m JOIN folders f ON m.folder_id = f.id WHERE m.id = ?`
        )
        .get(messageId) as
        { uid: number; folder_id: number; path: string; uidvalidity: number | null } | undefined
      if (!row || !this.cmd) return null
      const lock = await this.cmd.getMailboxLock(row.path)
      try {
        if (this.uidValidityChanged(row.folder_id, row.uidvalidity)) return null
        const msg = await this.cmd.fetchOne(
          String(row.uid),
          { headers: true, envelope: true },
          { uid: true }
        )
        if (!msg || !msg.headers) return null
        const envelope = msg.envelope
        return {
          from: mapHeaderAddresses(envelope?.from),
          sender: mapHeaderAddresses(envelope?.sender),
          to: mapHeaderAddresses(envelope?.to),
          cc: mapHeaderAddresses(envelope?.cc),
          bcc: mapHeaderAddresses(envelope?.bcc),
          replyTo: mapHeaderAddresses(envelope?.replyTo),
          rawHeaders: msg.headers
        }
      } finally {
        lock.release()
      }
    })
  }

  /** On-demand body fetch (reader opens a mail without cached content). */
  fetchBody(messageId: number): Promise<string | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare(
          `SELECT f.id folder_id, f.path, f.uidvalidity
           FROM messages m JOIN folders f ON m.folder_id = f.id WHERE m.id = ?`
        )
        .get(messageId) as
        { folder_id: number; path: string; uidvalidity: number | null } | undefined
      if (!row) return null
      const lock = await this.cmd!.getMailboxLock(row.path)
      try {
        if (this.uidValidityChanged(row.folder_id, row.uidvalidity)) return null
        return await this.fetchBodyInSelectedMailbox(messageId)
      } finally {
        lock.release()
      }
    })
  }

  private async startIdle(inbox: FolderRow): Promise<void> {
    const options = await imapConnectOptions(this.account, await this.getCredentials())
    this.idleConn = new ImapFlow(options)
    this.idleConn.on('error', (err) => console.warn(`[idle:${this.account.email}]`, err.message))
    await this.idleConn.connect()
    await this.idleConn.mailboxOpen(inbox.path)

    const trigger = (): void => {
      if (this.idleDebounce) clearTimeout(this.idleDebounce)
      this.idleDebounce = setTimeout(() => {
        void this.enqueueFolderSync(inbox).catch((error) =>
          console.warn(`[idle:${this.account.email}] Sync:`, error)
        )
      }, 500)
    }
    this.idleConn.on('exists', trigger)
    this.idleConn.on('expunge', trigger)
    this.idleConn.on('flags', trigger)
  }

  /** Runs a queue operation on the command connection. */
  executeOp(op: QueuedOp): Promise<void> {
    return this.enqueue(async () => {
      const { payload } = op
      if (!payload.folderId || !payload.uids?.length) return
      const folder = this.db
        .prepare('SELECT id, path FROM folders WHERE id = ?')
        .get(payload.folderId) as { id: number; path: string } | undefined
      if (!folder) throw new OpDeadError('folder-gone', 'Ordner existiert nicht mehr')
      const range = payload.uids.join(',')

      // Resolve the target folder BEFORE the lock: if it's missing, the op is permanently
      // unexecutable — never count it as silent success (mail gone locally, not on server).
      let moveTarget: string | null = null
      if (op.kind === 'move') {
        moveTarget = this.resolveSpecialUse(payload.targetSpecialUse)
        if (!moveTarget) {
          throw new OpDeadError(
            payload.targetSpecialUse === '\\Trash' ? 'no-trash' : 'no-target-folder',
            `Zielordner ${payload.targetSpecialUse ?? '?'} nicht gefunden`
          )
        }
      }
      let deleteTrash: string | null = null
      if (op.kind === 'delete' && this.account.provider !== 'gmail') {
        // Without a trash folder do NOT hard-delete — data loss would be irreversible
        deleteTrash = this.resolveSpecialUse('\\Trash')
        if (!deleteTrash) throw new OpDeadError('no-trash', 'Kein Papierkorb-Ordner vorhanden')
      }

      const lock = await this.cmd!.getMailboxLock(folder.path)
      try {
        if (payload.uidValidity !== undefined) {
          const mailbox = this.cmd!.mailbox
          const live = mailbox && typeof mailbox !== 'boolean' ? Number(mailbox.uidValidity) : null
          if (live !== null && live !== payload.uidValidity) {
            throw new OpDeadError('uidvalidity', `UIDVALIDITY ${payload.uidValidity} → ${live}`)
          }
        }
        if (op.kind === 'setFlags') {
          if (payload.add?.length)
            await this.cmd!.messageFlagsAdd(range, payload.add, { uid: true })
          if (payload.remove?.length)
            await this.cmd!.messageFlagsRemove(range, payload.remove, { uid: true })
        } else if (op.kind === 'move') {
          await this.cmd!.messageMove(range, moveTarget!, { uid: true })
        } else if (op.kind === 'delete') {
          if (this.account.provider === 'gmail') {
            // Gmail: \Deleted + expunge in INBOX = archive (label removed);
            // real deletion runs as a move to \Trash.
            await this.cmd!.messageDelete(range, { uid: true })
          } else {
            await this.cmd!.messageMove(range, deleteTrash!, { uid: true })
          }
        }
      } finally {
        lock.release()
      }
    })
  }

  private resolveSpecialUse(specialUse: string | undefined): string | null {
    if (!specialUse) return null
    const row = this.db
      .prepare('SELECT path FROM folders WHERE account_id = ? AND special_use = ?')
      .get(this.account.id, specialUse) as { path: string } | undefined
    return row?.path ?? null
  }
}
