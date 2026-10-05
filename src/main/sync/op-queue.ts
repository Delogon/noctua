import type Database from 'better-sqlite3'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import type { QueuedOp } from './account-syncer'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

export const MAX_OP_ATTEMPTS = 10
// Tote Ops bleiben zur Diagnose liegen, werden aber irgendwann aufgeräumt
const DEAD_OP_RETENTION_MS = 14 * 24 * 3600 * 1000

export type DeadReason =
  'attempts' | 'uidvalidity' | 'no-target-folder' | 'no-trash' | 'folder-gone'

/**
 * Permanenter Op-Fehler: Wiederholen ist sinnlos (Zielordner fehlt, UIDs
 * gehören zu einer anderen UIDVALIDITY, …). Die Queue legt die Op als „dead"
 * ab und meldet das dem Nutzer, statt sie still zu verwerfen oder ewig zu
 * wiederholen.
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

/** Was die Queue vom Syncer braucht — als Interface, damit Tests ihn mocken können. */
export interface OpExecutor {
  executeOp(op: QueuedOp): Promise<void>
  /** Steht die Kommando-Verbindung? Ohne sie zählen Fehler nicht als Versuch. */
  isConnected(): boolean
  /** Ordner neu abgleichen lassen, wenn eine Op verworfen wurde (lokal schon angewendet). */
  invalidateFolder?(folderId: number): void
}

/**
 * Legt eine Op in die Queue und stempelt die aktuelle UIDVALIDITY des Ordners
 * in den Payload: Nach einem UIDVALIDITY-Wechsel zeigen die UIDs auf andere
 * (oder gar keine) Nachrichten — dann darf die Op nicht mehr laufen.
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
 * Arbeitet die ausstehenden Ops eines Kontos der Reihe nach ab.
 * - Verbindung weg: abbrechen, ohne Versuche zu verbrennen (nächster Connect).
 * - Op scheitert bei stehender Verbindung: Versuch zählen und die nächste Op
 *   probieren — eine kaputte Op blockiert nicht die ganze Queue. Spätere Ops
 *   auf dieselben Nachrichten werden dabei übersprungen (Reihenfolge je
 *   Nachricht bleibt gewahrt: kein „Archivieren" vor dem fehlgeschlagenen „Gelesen").
 * - Endgültig gescheiterte Ops werden „dead" + per Push gemeldet.
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
    // Lokal wurde die Aktion optimistisch schon angewendet (Mail aus der DB
    // gelöscht) — den Ordner neu abgleichen, damit der Server-Stand zurückkommt.
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

    // UIDVALIDITY-Stempel prüfen: nach einem Reset sind die UIDs wertlos
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
      if (!syncer.isConnected()) break // Verbindung weg — nächster Connect versucht erneut
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
