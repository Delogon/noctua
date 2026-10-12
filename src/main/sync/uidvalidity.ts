import type Database from 'better-sqlite3-multiple-ciphers'
import { cleanupSearchOrphans } from '../mail/ingest'

/**
 * Resets a folder after a UIDVALIDITY change — ATOMICALLY in one
 * transaction: delete messages, clean up search index orphans, store the new
 * UIDVALIDITY and set uidnext/backfill cursor to NULL. A crash
 * midway thus never leaves an empty folder with an old uidnext that
 * would never be filled again (uidnext NULL = full backfill on the next sync).
 *
 * Known limitation: local data attached to the message row (AI
 * annotations, tasks, follow-ups, header details) is dropped via ON DELETE
 * CASCADE and is NOT carried over via the Message-ID to the newly loaded
 * rows — that would need a temporary store across the resync.
 * The AI queue re-annotates new inbox mails anyway.
 *
 * Not yet executed ops without a UIDVALIDITY stamp (enqueued before REL-5)
 * are discarded too; the op queue itself detects stamped ones by the mismatch.
 */
/**
 * Pending ops of the folder's account via idx_op_queue_status(account_id,
 * status), so only those payloads are parsed, never a dead-letter backlog.
 * Parameters: folder id (account lookup), folder id (payload match).
 */
export const DISCARD_UNSTAMPED_OPS_SQL = `UPDATE op_queue
  SET status = 'dead', last_error = 'uidvalidity: Ordner zurückgesetzt'
  WHERE account_id = (SELECT account_id FROM folders WHERE id = ?)
    AND status = 'pending'
    AND json_extract(payload_json, '$.folderId') = ?
    AND json_extract(payload_json, '$.uidValidity') IS NULL`

export function resetFolderForUidValidity(
  db: Database.Database,
  folderId: number,
  newUidValidity: number
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folderId)
    cleanupSearchOrphans(db)
    db.prepare(
      `UPDATE folders
       SET uidvalidity = ?, uidnext = NULL,
           envelope_backfill_since = NULL, body_backfill_since = NULL
       WHERE id = ?`
    ).run(newUidValidity, folderId)
    db.prepare(DISCARD_UNSTAMPED_OPS_SQL).run(folderId, folderId)
  })()
}
