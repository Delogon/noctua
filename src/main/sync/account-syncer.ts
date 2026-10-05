import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from 'imapflow'
import type Database from 'better-sqlite3-multiple-ciphers'
import { buildImapOptions, type AccountRow, type MailCredentials } from '../auth/providers'
import { parseMail } from '../mail/parser'
import {
  applyFlagUpdate,
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

const DEFAULT_ENVELOPE_BACKFILL_DAYS = 90
export const SEARCH_BACKFILL_DAYS = 183
const ENVELOPE_CHUNK = 200
const BODY_CHUNK = 10
const BODY_PASS_LIMIT = 50
const FLAG_RESYNC_WINDOW = 500
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
// Falls IDLE still stirbt: INBOX zusätzlich regelmäßig abfragen
const INBOX_WATCHDOG_MS = 5 * 60_000

export type SyncState = 'idle' | 'connecting' | 'syncing' | 'error' | 'needs-reauth' | 'off'

/**
 * Login vom Server abgelehnt (imapflow setzt `authenticationFailed`)? Dann
 * hilft kein Reconnect-Loop — der Nutzer muss neue Zugangsdaten liefern.
 */
export function isAuthFailure(error: unknown): boolean {
  const e = error as { authenticationFailed?: unknown; serverResponseCode?: unknown } | null
  return (
    e?.authenticationFailed === true ||
    e?.serverResponseCode === 'AUTHENTICATIONFAILED' ||
    // OAuth-Refresh gescheitert (invalid_grant / interaction_required)
    isReauthError(error)
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
    /** UIDVALIDITY des Ordners beim Einreihen — bei Abweichung sind die UIDs ungültig. */
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

function isSearchableFolder(folder: Pick<FolderRow, 'special_use'>): boolean {
  return folder.special_use !== null && SEARCHABLE_SPECIAL_USES.has(folder.special_use)
}

/**
 * Backfill-Grenze eines Kontos als Epoch-Millisekunden: ein gesetzter
 * Sync-Zeitraum (accounts.sync_days) gilt für Liste UND Suche, 0 heißt
 * „alles synchronisieren" (Grenze 0). Ohne Einstellung gelten die
 * Standardfenster (90 Tage Liste, 183 Tage Suche).
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

function structureHasAttachments(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { disposition?: string; childNodes?: unknown[] }
  if (n.disposition?.toLowerCase() === 'attachment') return true
  return (n.childNodes ?? []).some(structureHasAttachments)
}

function extractHeader(headers: Buffer | undefined, name: string): string | null {
  if (!headers) return null
  const pattern = new RegExp(`^${name}:[ \\t]*((?:[^\\r\\n]|\\r?\\n[ \\t])+)`, 'im')
  return headers.toString('binary').match(pattern)?.[1] ?? null
}

function extractReferences(headers: Buffer | undefined): string[] {
  return extractHeader(headers, 'references')?.match(/<[^<>]+>/g) ?? []
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
 * Synchronisiert ein Konto: Kommando-Verbindung (Backfill, Fetches, Ops) plus
 * dedizierte IDLE-Verbindung auf INBOX. Reconnect mit Exponential-Backoff.
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
  // Noch nicht gestartete Ordner-Syncs — gleiche Anforderungen teilen sich einen Lauf
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
   * Bricht einen laufenden Backoff-Wait ab (z. B. nach System-Wakeup). Im
   * needs-reauth-Zustand bewusst wirkungslos: Wiederholte falsche Logins
   * können das Konto beim Anbieter sperren.
   */
  wake(): void {
    if (this.needsReauth) return
    this.wakeReconnect?.()
  }

  /** Nutzer-Aktion (RETRY, neue Zugangsdaten): beendet auch needs-reauth. */
  retryNow(): void {
    this.needsReauth = false
    this.wakeReconnect?.()
  }

  isConnected(): boolean {
    return !!this.cmd?.usable
  }

  /** Serialisiert Arbeit auf der Kommando-Verbindung. */
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
          // Kein Backoff-Loop gegen falsche Zugangsdaten: warten, bis der Nutzer
          // RETRY drückt oder die Zugangsdaten ändert (retryNow / Neustart).
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
    const options = buildImapOptions(this.account, await this.getCredentials())
    this.cmd = new ImapFlow(options)
    this.cmd.on('error', (err) => console.warn(`[sync:${this.account.email}] cmd:`, err.message))
    await this.cmd.connect()

    this.events.onState('syncing', null)
    const folders = await this.syncFolderList()
    this.folders = folders
    for (const folder of folders) {
      if (folder.sync_mode !== 'full') continue
      await this.enqueue(() => this.syncFolder(folder))
      if (folder.special_use === '\\Sent') rebuildContactStats(this.db, this.account.id)
    }
    const inbox = folders.find((f) => f.special_use === '\\Inbox')
    // IDLE zuerst starten; der progressive Body-Backfill darf neue Mails nicht
    // fuer Minuten blockieren.
    if (inbox) await this.startIdle(inbox)

    for (const folder of folders.filter(isSearchableFolder)) {
      void this.enqueue(() => this.backfillBodies(folder)).catch((error) =>
        console.warn(`[sync:${this.account.email}] Body-Backfill ${folder.path}:`, error)
      )
    }
    // Nicht-INBOX-Ordner haben kein IDLE — alle 10 Minuten inkrementell nachziehen.
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
    // Watchdog: IDLE kann ohne close-Event sterben — dann würde die INBOX nie
    // wieder syncen. Scheitert der Poll, greift der normale Reconnect.
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
   * Manueller Refresh (Refresh-Button/⌘K): alle Voll-Sync-Ordner sofort
   * inkrementell nachziehen, statt auf IDLE bzw. den 10-Minuten-Poll zu
   * warten — für Ordner ohne IDLE (v. a. Spam) der einzige schnelle Weg.
   */
  refreshNow(): void {
    // Getrennt/Backoff: aufwecken reicht — der Reconnect synct ohnehin alles.
    this.retryNow()
    if (!this.cmd) return
    for (const folder of this.folders) {
      if (folder.sync_mode !== 'full') continue
      void this.enqueueFolderSync(folder).catch((error) =>
        console.warn(`[sync:${this.account.email}] Refresh ${folder.path}:`, error)
      )
    }
  }

  /** Gezielter Resync eines Ordners (z. B. Sent direkt nach dem Senden). */
  resyncSpecialUse(specialUse: string): Promise<void> {
    const folder = this.folders.find((f) => f.special_use === specialUse)
    if (!folder || !this.cmd) return Promise.resolve()
    return this.enqueueFolderSync(folder).then(() => {
      if (specialUse === '\\Sent') rebuildContactStats(this.db, this.account.id)
    })
  }

  /**
   * Reiht einen Ordner-Sync (+ Body-Backfill) ein. Ist für den Ordner schon
   * einer eingereiht, der noch nicht läuft, teilen sich beide Anforderungen
   * diesen Lauf — IDLE-Bursts, Poll und Refresh stauen sich nicht mehr auf.
   */
  private enqueueFolderSync(folder: FolderRow): Promise<void> {
    const pending = this.pendingFolderSyncs.get(folder.id)
    if (pending) return pending
    const run = this.enqueue(async () => {
      this.pendingFolderSyncs.delete(folder.id) // ab jetzt zählt eine neue Anforderung wieder
      await this.syncFolder(folder)
      if (isSearchableFolder(folder)) await this.backfillBodies(folder)
    })
    this.pendingFolderSyncs.set(folder.id, run)
    // Scheitert der Lauf, bevor er startete, darf der Eintrag nicht hängen bleiben
    void run.catch(() => {
      if (this.pendingFolderSyncs.get(folder.id) === run) this.pendingFolderSyncs.delete(folder.id)
    })
    return run
  }

  /** Ordner nach verworfener Op neu abgleichen lassen (voller Backfill dedupliziert). */
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
      `INSERT INTO folders (account_id, path, special_use, sync_mode)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, path) DO UPDATE SET
         special_use = excluded.special_use, sync_mode = excluded.sync_mode
       RETURNING id, path, special_use, uidvalidity, uidnext, sync_mode,
                 envelope_backfill_since, body_backfill_since`
    )
    for (const box of list) {
      let specialUse = box.specialUse ?? null
      if (box.path.toUpperCase() === 'INBOX') specialUse = '\\Inbox'
      let syncMode = 'off'
      // Junk voll syncen: der SPAM-Ordner-Filter braucht die Envelopes.
      // Triage/Embeddings/Badge bleiben auf \Inbox begrenzt — Spam kostet nichts.
      if (
        specialUse === '\\Inbox' ||
        specialUse === '\\Sent' ||
        specialUse === '\\Archive' ||
        specialUse === '\\Junk'
      )
        syncMode = 'full'
      else if (specialUse === '\\Trash') syncMode = 'flags'
      // Gmail "Alle Nachrichten" ist die Duplikat-Falle — nie synchronisieren.
      if (specialUse === '\\All' || specialUse === '\\Flagged') syncMode = 'off'
      rows.push(upsert.get(this.account.id, box.path, specialUse, syncMode) as FolderRow)
    }
    return rows
  }

  private async syncFolder(folder: FolderRow): Promise<void> {
    const lock = await this.cmd!.getMailboxLock(folder.path)
    try {
      const mailbox = this.cmd!.mailbox
      if (!mailbox || typeof mailbox === 'boolean') return
      const uidValidity = Number(mailbox.uidValidity ?? 0)

      if (folder.uidvalidity !== null && folder.uidvalidity !== uidValidity) {
        console.warn(`[sync:${this.account.email}] UIDVALIDITY changed for ${folder.path} — reset`)
        // Atomar (REL-3): löschen + neue UIDVALIDITY + Cursor-Reset in einer Transaktion
        resetFolderForUidValidity(this.db, folder.id, uidValidity)
        folder.uidvalidity = uidValidity
        folder.uidnext = null
        folder.envelope_backfill_since = null
        folder.body_backfill_since = null
      }

      if (folder.uidnext === null) {
        await this.backfillFolder(folder)
      } else {
        await this.incrementalSync(folder)
        // M13: bestehende Konten hatten bereits uidnext, aber nur 90 Tage.
        // Der Cursor zieht die fehlende Historie genau einmal nach.
        if (isSearchableFolder(folder)) await this.backfillFolder(folder)
      }

      this.db
        .prepare('UPDATE folders SET uidvalidity = ?, uidnext = ?, last_synced_at = ? WHERE id = ?')
        .run(uidValidity, mailbox.uidNext ?? folder.uidnext, Date.now(), folder.id)
      folder.uidvalidity = uidValidity
      folder.uidnext = mailbox.uidNext ?? folder.uidnext
    } finally {
      lock.release()
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
    const tx = this.db.transaction(() => {
      for (const msg of messages) {
        const result = upsertEnvelope(this.db, this.account.id, folder.id, toEnvelopeData(msg))
        if (result) threadKeys.add(result.threadKey)
      }
    })
    tx()
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
      const messages: FetchMessageObject[] = []
      for await (const msg of this.cmd!.fetch(chunk.join(','), this.fetchOptions(), {
        uid: true
      })) {
        messages.push(msg)
      }
      const threadKeys = this.ingestBatch(folder, messages)
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
    // 1) Neue Nachrichten ab bekanntem UIDNEXT
    const messages: FetchMessageObject[] = []
    for await (const msg of this.cmd!.fetch(`${folder.uidnext}:*`, this.fetchOptions(), {
      uid: true
    })) {
      if (msg.uid >= (folder.uidnext ?? 0)) messages.push(msg)
    }
    if (messages.length > 0) {
      const threadKeys = this.ingestBatch(folder, messages)
      this.events.onMessagesChanged(folder.id, threadKeys)
    }

    // 2) Flags + Expunge im jüngsten Fenster (CONDSTORE-unabhängig, robust)
    const known = this.db
      .prepare('SELECT uid FROM messages WHERE folder_id = ? ORDER BY uid DESC LIMIT ?')
      .all(folder.id, FLAG_RESYNC_WINDOW) as Array<{ uid: number }>
    if (known.length === 0) return
    const minUid = known[known.length - 1].uid
    const serverUids = new Set<number>()
    const changedThreads = new Set<string>()
    for await (const msg of this.cmd!.fetch(
      `${minUid}:*`,
      { uid: true, flags: true },
      { uid: true }
    )) {
      serverUids.add(msg.uid)
      const id = applyFlagUpdate(this.db, folder.id, msg.uid, msg.flags ?? new Set())
      if (id !== null) {
        const row = this.db.prepare('SELECT thread_key FROM messages WHERE id = ?').get(id) as
          { thread_key: string } | undefined
        if (row) changedThreads.add(row.thread_key)
      }
    }
    const vanished = known.filter((k) => !serverUids.has(k.uid)).map((k) => k.uid)
    if (vanished.length > 0) deleteByUids(this.db, folder.id, vanished)
    if (vanished.length > 0 || changedThreads.size > 0) {
      this.events.onMessagesChanged(folder.id, [...changedThreads])
    }
  }

  private async backfillBodies(folder: FolderRow, skippedIds: number[] = []): Promise<void> {
    if (!isSearchableFolder(folder)) return
    const cutoff = backfillCutoff(this.account.sync_days, true)
    const excluded = [...new Set(skippedIds)]
    const exclusionSql =
      excluded.length > 0 ? `AND id NOT IN (${excluded.map(() => '?').join(',')})` : ''
    const pending = this.db
      .prepare(
        `SELECT id FROM messages
         WHERE folder_id = ? AND body_state = 'none'
           AND (coalesce(date, internal_date) IS NULL OR coalesce(date, internal_date) >= ?)
           ${exclusionSql}
         ORDER BY coalesce(date, internal_date) DESC, id DESC
         LIMIT ?`
      )
      .all(folder.id, cutoff, ...excluded, BODY_PASS_LIMIT) as Array<{ id: number }>

    const failedIds: number[] = []
    for (let i = 0; i < pending.length; i += BODY_CHUNK) {
      if (this.stopped) return
      const batch = pending.slice(i, i + BODY_CHUNK)
      const threadKeys = new Set<string>()
      // Ein Lock pro Batch — garantiert die richtige selektierte Mailbox.
      const lock = await this.cmd!.getMailboxLock(folder.path)
      try {
        for (const { id } of batch) {
          const key = await this.fetchBodyInSelectedMailbox(id)
          if (key) threadKeys.add(key)
          else failedIds.push(id)
        }
      } finally {
        lock.release()
      }
      this.events.onMessagesChanged(folder.id, [...threadKeys])
    }

    const remaining = this.db
      .prepare(
        `SELECT count(*) AS count FROM messages
         WHERE folder_id = ? AND body_state = 'none'
           AND (coalesce(date, internal_date) IS NULL OR coalesce(date, internal_date) >= ?)`
      )
      .get(folder.id, cutoff) as { count: number }
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
           WHERE folder_id = ? AND body_state = 'none'
             AND (coalesce(date, internal_date) IS NULL OR coalesce(date, internal_date) >= ?)
             ${nextExclusionSql}`
        )
        .get(folder.id, cutoff, ...nextExcluded) as { count: number }
      if (untried.count === 0) return
      // Naechsten kleinen Durchlauf hinten anstellen. So erreicht der Backfill
      // mehr als 500 Bodies, ohne Senden/Archivieren minutenlang zu blockieren.
      void this.enqueue(() => this.backfillBodies(folder, nextExcluded)).catch((error) =>
        console.warn(`[sync:${this.account.email}] Body-Backfill ${folder.path}:`, error)
      )
    }
  }

  /** Setzt voraus, dass die Mailbox der Nachricht bereits gelockt/selektiert ist. */
  private async fetchBodyInSelectedMailbox(messageId: number): Promise<string | null> {
    const row = this.db
      .prepare('SELECT uid, thread_key FROM messages WHERE id = ?')
      .get(messageId) as { uid: number; thread_key: string } | undefined
    if (!row) return null
    const msg = await this.cmd!.fetchOne(String(row.uid), { source: true }, { uid: true })
    if (!msg || !msg.source) return null
    const parsed = await parseMail(msg.source)
    storeBody(this.db, messageId, parsed)
    storeMessageHeaderDetails(this.db, messageId, {
      from: parsed.from ? [parsed.from] : [],
      sender: parsed.sender ? [parsed.sender] : [],
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc ?? [],
      replyTo: parsed.replyTo,
      rawHeaders: rawHeaderBlock(msg.source)
    })
    try {
      applyRules(this.db, messageId, 'ingest')
    } catch (error) {
      console.warn('[rules]', error)
    }
    return row.thread_key
  }

  /** Roher RFC822-Source einer Nachricht (Attachment-Extraktion). */
  fetchRawSource(messageId: number): Promise<Buffer | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare(
          `SELECT m.uid, f.path FROM messages m JOIN folders f ON m.folder_id = f.id WHERE m.id = ?`
        )
        .get(messageId) as { uid: number; path: string } | undefined
      if (!row || !this.cmd) return null
      const lock = await this.cmd.getMailboxLock(row.path)
      try {
        const msg = await this.cmd.fetchOne(String(row.uid), { source: true }, { uid: true })
        return msg && msg.source ? msg.source : null
      } finally {
        lock.release()
      }
    })
  }

  /** Nur Envelope + vollständige Header; lädt keine oft großen Bodies/Anhänge. */
  fetchMessageHeaders(messageId: number): Promise<FetchedMessageHeaderData | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare(
          `SELECT m.uid, f.path FROM messages m JOIN folders f ON m.folder_id = f.id WHERE m.id = ?`
        )
        .get(messageId) as { uid: number; path: string } | undefined
      if (!row || !this.cmd) return null
      const lock = await this.cmd.getMailboxLock(row.path)
      try {
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

  /** On-demand Body-Fetch (Reader öffnet eine Mail ohne gecachten Inhalt). */
  fetchBody(messageId: number): Promise<string | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare(
          `SELECT f.path FROM messages m JOIN folders f ON m.folder_id = f.id WHERE m.id = ?`
        )
        .get(messageId) as { path: string } | undefined
      if (!row) return null
      const lock = await this.cmd!.getMailboxLock(row.path)
      try {
        return await this.fetchBodyInSelectedMailbox(messageId)
      } finally {
        lock.release()
      }
    })
  }

  private async startIdle(inbox: FolderRow): Promise<void> {
    const options = buildImapOptions(this.account, await this.getCredentials())
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

  /** Führt eine Queue-Operation auf der Kommando-Verbindung aus. */
  executeOp(op: QueuedOp): Promise<void> {
    return this.enqueue(async () => {
      const { payload } = op
      if (!payload.folderId || !payload.uids?.length) return
      const folder = this.db
        .prepare('SELECT id, path FROM folders WHERE id = ?')
        .get(payload.folderId) as { id: number; path: string } | undefined
      if (!folder) throw new OpDeadError('folder-gone', 'Ordner existiert nicht mehr')
      const range = payload.uids.join(',')

      // Zielordner VOR dem Lock auflösen: fehlt er, ist die Op dauerhaft
      // unausführbar — nie still als Erfolg werten (Mail wäre lokal weg, serverseitig nicht).
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
        // Ohne Papierkorb NICHT hart löschen — Datenverlust wäre unumkehrbar
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
            // Gmail: \Deleted + Expunge in INBOX = Archivieren (Label weg);
            // echtes Löschen läuft als move nach \Trash.
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
