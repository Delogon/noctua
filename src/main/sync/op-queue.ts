import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import type { QueuedOp } from './account-syncer'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

export const MAX_OP_ATTEMPTS = 10
// Dead ops stay around for diagnosis, but are cleaned up eventually
const DEAD_OP_RETENTION_MS = 14 * 24 * 3600 * 1000

export type DeadReason =
  'attempts' | 'uidvalidity' | 'no-target-folder' | 'no-trash' | 'folder-gone'

/**
 * Permanent op error: retrying is pointless (target folder missing, UIDs
 * belong to a different UIDVALIDITY, …). The queue stores the op as "dead"
 * and reports it to the user instead of silently discarding it or retrying
 * forever.
 */
export class OpDeadError extends Error {
  constructor(
    readonly reason: DeadReason,
    message: string
  ) {
    super(message)
    this.name = 'OpDeadError'
  }
}

/** What the queue needs from the syncer — as an interface so tests can mock it. */
export interface OpExecutor {
  executeOp(op: QueuedOp): Promise<void>
  /** Is the command connection up? Without it, errors don't count as an attempt. */
  isConnected(): boolean
  /** Have the folder re-reconciled when an op was discarded (already applied locally). */
  invalidateFolder?(folderId: number): void
}

/**
 * Puts an op into the queue and stamps the folder's current UIDVALIDITY
 * into the payload: after a UIDVALIDITY change the UIDs point at different
 * (or no) messages — then the op must not run anymore.
 */
export function enqueueOp(
  db: Database.Database,
  accountId: number,
  kind: QueuedOp['kind'],
  payload: QueuedOp['payload']
): void {
  const stamped = { ...payload }
  if (payload.folderId !== undefined && stamped.uidValidity === undefined) {
    const folder = db
      .prepare('SELECT uidvalidity FROM folders WHERE id = ?')
      .get(payload.folderId) as { uidvalidity: number | null } | undefined
    if (folder?.uidvalidity != null) stamped.uidValidity = folder.uidvalidity
  }
  db.prepare(
    'INSERT INTO op_queue (account_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)'
  ).run(accountId, kind, JSON.stringify(stamped), Date.now())
}

/**
 * Processes an account's pending ops in order.
 * - Connection gone: abort without burning attempts (next connect).
 * - Op fails while connected: count the attempt and try the next op
 *   — one broken op doesn't block the whole queue. Later ops
 *   on the same messages are skipped meanwhile (order per
 *   message is preserved: no "archive" before the failed "mark read").
 * - Ops that failed for good become "dead" + are reported via push.
 */
export async function processOpQueue(
  db: Database.Database,
  accountId: number,
  syncer: OpExecutor,
  push: PushFn
): Promise<void> {
  db.prepare(`DELETE FROM op_queue WHERE status = 'dead' AND created_at < ?`).run(
    Date.now() - DEAD_OP_RETENTION_MS
  )
  const rows = db
    .prepare(
      `SELECT id, kind, payload_json, attempts FROM op_queue
       WHERE account_id = ? AND status = 'pending' ORDER BY id`
    )
    .all(accountId) as Array<{
    id: number
    kind: QueuedOp['kind']
    payload_json: string
    attempts: number
  }>

  const dead = new Map<DeadReason, number>()
  const staleFolders = new Set<number>()
  const failedKeys = new Set<string>()
  const markDead = (
    rowId: number,
    reason: DeadReason,
    message: string,
    folderId: number | undefined
  ): void => {
    db.prepare(`UPDATE op_queue SET status = 'dead', last_error = ? WHERE id = ?`).run(
      `${reason}: ${message}`.slice(0, 500),
      rowId
    )
    dead.set(reason, (dead.get(reason) ?? 0) + 1)
    // The action was already applied optimistically locally (mail deleted from
    // the DB) — re-reconcile the folder so the server state comes back.
    if (folderId !== undefined && reason !== 'uidvalidity' && reason !== 'folder-gone') {
      staleFolders.add(folderId)
    }
    console.warn(`[ops] op ${rowId} dead (${reason}): ${message}`)
  }

  for (const row of rows) {
    let payload: QueuedOp['payload']
    try {
      payload = JSON.parse(row.payload_json)
    } catch {
      markDead(row.id, 'attempts', 'payload nicht lesbar', undefined)
      continue
    }

    const keys = (payload.uids ?? []).map((uid) => `${payload.folderId}:${uid}`)
    if (keys.some((key) => failedKeys.has(key))) continue

    // Check the UIDVALIDITY stamp: after a reset the UIDs are worthless
    if (payload.folderId !== undefined) {
      const folder = db
        .prepare('SELECT uidvalidity FROM folders WHERE id = ?')
        .get(payload.folderId) as { uidvalidity: number | null } | undefined
      if (!folder) {
        markDead(row.id, 'folder-gone', 'Ordner existiert nicht mehr', undefined)
        continue
      }
      if (
        payload.uidValidity != null &&
        folder.uidvalidity !== null &&
        folder.uidvalidity !== payload.uidValidity
      ) {
        markDead(
          row.id,
          'uidvalidity',
          `UIDVALIDITY ${payload.uidValidity} → ${folder.uidvalidity}`,
          payload.folderId
        )
        continue
      }
    }

    try {
      await syncer.executeOp({ id: row.id, kind: row.kind, payload })
      db.prepare('DELETE FROM op_queue WHERE id = ?').run(row.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof OpDeadError) {
        markDead(row.id, error.reason, message, payload.folderId)
        continue
      }
      if (!syncer.isConnected()) break // Connection gone — next connect retries
      const attempts = row.attempts + 1
      if (attempts >= MAX_OP_ATTEMPTS) {
        markDead(row.id, 'attempts', message, payload.folderId)
      } else {
        db.prepare('UPDATE op_queue SET attempts = ?, last_error = ? WHERE id = ?').run(
          attempts,
          message.slice(0, 500),
          row.id
        )
        for (const key of keys) failedKeys.add(key)
      }
    }
  }

  for (const [reason, count] of dead) push('sync:opsDead', { accountId, count, reason })
  for (const folderId of staleFolders) syncer.invalidateFolder?.(folderId)
}
