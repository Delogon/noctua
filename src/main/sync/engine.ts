import type Database from 'better-sqlite3'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import type { MessageAction } from '@shared/types'
import { getSecret } from '../auth/secrets'
import { accountSecretKey, type AccountRow, type MailCredentials } from '../auth/providers'
import { msAccessToken } from '../auth/msal'
import { googleAccessToken } from '../auth/google'
import { AccountSyncer, type QueuedOp, type SyncState } from './account-syncer'
import { enqueueOp, processOpQueue } from './op-queue'
import type { FetchedMessageHeaderData } from '../db/repos/message-headers'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

interface MessageRef {
  id: number
  account_id: number
  folder_id: number
  uid: number
  thread_key: string
}

/**
 * Seit wann ein Konto im Fehlerzustand hängt (Design 3b: „… — since 11:42").
 * Der Backoff-Loop wechselt zwischen error → connecting → error; der erste
 * Fehlerzeitpunkt bleibt dabei stehen und wird erst durch einen erfolgreichen
 * Sync (idle) oder das Stoppen des Kontos gelöscht.
 */
export function nextErrorSince(prev: number | null, state: SyncState, now: number): number | null {
  if (state === 'idle' || state === 'off') return null
  if (state === 'error' || state === 'needs-reauth') return prev ?? now
  return prev
}

/** Verwaltet einen AccountSyncer pro Konto und die offline-fähige Op-Queue. */
class SyncEngine {
  private db: Database.Database | null = null
  private syncers = new Map<number, AccountSyncer>()
  private states = new Map<number, { state: SyncState; detail: string | null }>()
  private errorSince = new Map<number, number>()
  private push: PushFn = () => {}

  init(db: Database.Database, push: PushFn): void {
    this.db = db
    this.push = push
  }

  startAll(): void {
    const accounts = this.db!.prepare('SELECT * FROM accounts').all() as AccountRow[]
    for (const account of accounts) this.startAccount(account)
  }

  startAccount(account: AccountRow): void {
    if (this.syncers.has(account.id)) return

    let getCredentials: () => Promise<MailCredentials>
    if (account.credential_type === 'oauth-ms') {
      // Access-Tokens leben ~1 h — bei jedem (Re-)Connect frisch holen
      getCredentials = async () => ({
        user: account.email,
        accessToken: await msAccessToken(account.email)
      })
    } else if (account.credential_type === 'oauth-google') {
      getCredentials = async () => ({
        user: account.email,
        accessToken: await googleAccessToken(account.email)
      })
    } else {
      const password = getSecret(accountSecretKey(account.id))
      if (!password) {
        this.states.set(account.id, { state: 'error', detail: 'Kein Passwort im Vault' })
        // Auch dieser Fehler bekommt seinen Zeitpunkt (Design 3b: „seit 11:42")
        if (!this.errorSince.has(account.id)) this.errorSince.set(account.id, Date.now())
        return
      }
      getCredentials = async () => ({ user: account.email, pass: password })
    }

    const syncer = new AccountSyncer(this.db!, account, getCredentials, {
      onState: (state, detail) => {
        this.states.set(account.id, { state, detail })
        const since = nextErrorSince(this.errorSince.get(account.id) ?? null, state, Date.now())
        if (since === null) this.errorSince.delete(account.id)
        else this.errorSince.set(account.id, since)
        this.push('sync:state', { accountId: account.id, state, detail })
        if (state === 'idle') void this.processQueue(account.id)
      },
      onMessagesChanged: (folderId, threadKeys) => {
        this.push('messages:changed', { accountId: account.id, folderId, threadKeys })
      }
    })
    this.syncers.set(account.id, syncer)
    syncer.start()
  }

  async stopAccount(accountId: number): Promise<void> {
    await this.syncers.get(accountId)?.stop()
    this.syncers.delete(accountId)
    this.states.delete(accountId)
    this.errorSince.delete(accountId)
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.syncers.values()].map((s) => s.stop()))
    this.syncers.clear()
  }

  getState(accountId: number): {
    state: SyncState
    detail: string | null
    errorSince: number | null
  } {
    const known = this.states.get(accountId)
    return {
      state: known?.state ?? 'off',
      detail: known?.detail ?? null,
      errorSince: this.errorSince.get(accountId) ?? null
    }
  }

  wakeAll(): void {
    for (const syncer of this.syncers.values()) syncer.wake()
  }

  /**
   * Manueller Refresh aus der UI: alle Konten sofort abgleichen — oder mit
   * accountId nur eines (RETRY am Fehlerzustand, Design 3b). refreshNow weckt
   * auch Backoff-Wartephasen, ein gescheitertes Konto verbindet also sofort neu.
   */
  syncNow(accountId?: number): void {
    if (accountId !== undefined) {
      this.syncers.get(accountId)?.refreshNow()
      return
    }
    for (const syncer of this.syncers.values()) syncer.refreshNow()
  }

  /** Sent-Ordner nach einem Versand zeitnah nachziehen. */
  resyncSent(accountId: number): void {
    void this.syncers
      .get(accountId)
      ?.resyncSpecialUse('\\Sent')
      .catch((error) => console.warn(`[sync] Sent-Resync (Konto ${accountId}):`, error))
  }

  /**
   * Zugangsdaten eines Kontos haben sich geändert (Passwort im Vault): Syncer
   * neu starten, damit er das neue Geheimnis liest und needs-reauth verlässt.
   */
  async credentialsChanged(secretKey: string): Promise<void> {
    const accounts = this.db!.prepare('SELECT * FROM accounts').all() as AccountRow[]
    const account = accounts.find((a) => accountSecretKey(a.id) === secretKey)
    if (!account || !this.syncers.has(account.id)) return
    await this.stopAccount(account.id)
    this.startAccount(account)
  }

  async fetchRawSource(messageId: number): Promise<Buffer | null> {
    const row = this.db!.prepare('SELECT account_id FROM messages WHERE id = ?').get(messageId) as
      { account_id: number } | undefined
    if (!row) return null
    const syncer = this.syncers.get(row.account_id)
    if (!syncer) return null
    return syncer.fetchRawSource(messageId)
  }

  async fetchMessageHeaders(messageId: number): Promise<FetchedMessageHeaderData | null> {
    const row = this.db!.prepare('SELECT account_id FROM messages WHERE id = ?').get(messageId) as
      { account_id: number } | undefined
    if (!row) return null
    const syncer = this.syncers.get(row.account_id)
    if (!syncer) return null
    // Header sind klein und werden pro Nachricht nur einmal gecacht. Das
    // zugrunde liegende IMAP-Kommando künstlich zu "timeouten" würde es nicht
    // abbrechen, sondern lediglich ein späteres erfolgreiches Ergebnis verlieren.
    return syncer.fetchMessageHeaders(messageId)
  }

  async fetchBody(messageId: number): Promise<void> {
    const row = this.db!.prepare('SELECT account_id FROM messages WHERE id = ?').get(messageId) as
      { account_id: number } | undefined
    if (!row) return
    const syncer = this.syncers.get(row.account_id)
    if (!syncer) return
    await Promise.race([
      syncer.fetchBody(messageId),
      new Promise((resolve) => setTimeout(resolve, 15_000))
    ])
  }

  /**
   * Optimistische Aktion: DB und UI sofort, IMAP über die Op-Queue.
   * j/k/e darf sich nie nach Netzlatenz anfühlen.
   */
  applyAction(messageIds: number[], action: MessageAction): void {
    const db = this.db!
    const placeholders = messageIds.map(() => '?').join(',')
    const refs = db
      .prepare(
        `SELECT id, account_id, folder_id, uid, thread_key FROM messages WHERE id IN (${placeholders})`
      )
      .all(...messageIds) as MessageRef[]
    if (refs.length === 0) return

    const groups = new Map<string, MessageRef[]>()
    for (const ref of refs) {
      const key = `${ref.account_id}:${ref.folder_id}`
      groups.set(key, [...(groups.get(key) ?? []), ref])
    }

    const touchedAccounts = new Set<number>()

    const tx = db.transaction(() => {
      for (const [, group] of groups) {
        const { account_id, folder_id } = group[0]
        const ids = group.map((r) => r.id)
        const uids = group.map((r) => r.uid)
        const idPlaceholders = ids.map(() => '?').join(',')
        const provider = (
          db.prepare('SELECT provider FROM accounts WHERE id = ?').get(account_id) as {
            provider: string
          }
        ).provider

        let op: { kind: QueuedOp['kind']; payload: QueuedOp['payload'] } | null = null
        if (action === 'markRead' || action === 'markUnread') {
          db.prepare(`UPDATE messages SET seen = ? WHERE id IN (${idPlaceholders})`).run(
            action === 'markRead' ? 1 : 0,
            ...ids
          )
          op = {
            kind: 'setFlags',
            payload:
              action === 'markRead'
                ? { folderId: folder_id, uids, add: ['\\Seen'] }
                : { folderId: folder_id, uids, remove: ['\\Seen'] }
          }
        } else if (action === 'flag' || action === 'unflag') {
          db.prepare(`UPDATE messages SET flagged = ? WHERE id IN (${idPlaceholders})`).run(
            action === 'flag' ? 1 : 0,
            ...ids
          )
          op = {
            kind: 'setFlags',
            payload:
              action === 'flag'
                ? { folderId: folder_id, uids, add: ['\\Flagged'] }
                : { folderId: folder_id, uids, remove: ['\\Flagged'] }
          }
        } else if (action === 'archive') {
          db.prepare(`DELETE FROM messages WHERE id IN (${idPlaceholders})`).run(...ids)
          op =
            provider === 'gmail'
              ? { kind: 'delete', payload: { folderId: folder_id, uids } }
              : {
                  kind: 'move',
                  payload: { folderId: folder_id, uids, targetSpecialUse: '\\Archive' }
                }
        } else if (action === 'notSpam') {
          db.prepare(`DELETE FROM messages WHERE id IN (${idPlaceholders})`).run(...ids)
          op = {
            kind: 'move',
            payload: { folderId: folder_id, uids, targetSpecialUse: '\\Inbox' }
          }
        } else if (action === 'delete') {
          db.prepare(`DELETE FROM messages WHERE id IN (${idPlaceholders})`).run(...ids)
          op = {
            kind: 'move',
            payload: { folderId: folder_id, uids, targetSpecialUse: '\\Trash' }
          }
        }
        if (op) {
          enqueueOp(db, account_id, op.kind, op.payload)
          touchedAccounts.add(account_id)
        }
      }
    })
    tx()

    for (const [, group] of groups) {
      this.push('messages:changed', {
        accountId: group[0].account_id,
        folderId: group[0].folder_id,
        threadKeys: [...new Set(group.map((r) => r.thread_key))]
      })
    }
    for (const accountId of touchedAccounts) void this.processQueue(accountId)
  }

  private processing = new Set<number>()
  private reprocess = new Set<number>()

  private async processQueue(accountId: number): Promise<void> {
    if (this.processing.has(accountId)) {
      // Während des Laufs eingereihte Ops nicht bis zum nächsten idle liegen lassen
      this.reprocess.add(accountId)
      return
    }
    const syncer = this.syncers.get(accountId)
    if (!syncer) return
    this.processing.add(accountId)
    try {
      await processOpQueue(this.db!, accountId, syncer, this.push)
    } catch (error) {
      console.warn(`[ops] Queue-Lauf (Konto ${accountId}) abgebrochen:`, error)
    } finally {
      this.processing.delete(accountId)
    }
    if (this.reprocess.delete(accountId)) void this.processQueue(accountId)
  }
}

export const syncEngine = new SyncEngine()
