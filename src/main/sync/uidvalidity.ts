import type Database from 'better-sqlite3-multiple-ciphers'
import { cleanupSearchOrphans } from '../mail/ingest'

/**
 * Setzt einen Ordner nach UIDVALIDITY-Wechsel zurück — ATOMAR in einer
 * Transaktion: Nachrichten löschen, Suchindex-Waisen bereinigen, neue
 * UIDVALIDITY speichern und uidnext/Backfill-Cursor auf NULL. Ein Absturz
 * mittendrin hinterlässt so nie einen leeren Ordner mit altem uidnext, der
 * nie mehr befüllt würde (uidnext NULL = voller Backfill beim nächsten Sync).
 *
 * Bekannte Grenze: lokale Daten, die an der Nachrichtenzeile hängen (KI-
 * Annotationen, Aufgaben, Follow-ups, Header-Details), fallen per ON DELETE
 * CASCADE mit weg und werden NICHT über die Message-ID auf die neu geladenen
 * Zeilen übertragen — das bräuchte einen Zwischenspeicher über den Resync
 * hinweg. Die KI-Queue annotiert neue Inbox-Mails ohnehin neu.
 *
 * Noch nicht ausgeführte Ops ohne UIDVALIDITY-Stempel (vor REL-5 eingereiht)
 * werden mit-verworfen; gestempelte erkennt die Op-Queue selbst am Mismatch.
 */
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
    db.prepare(
      `UPDATE op_queue
       SET status = 'dead', last_error = 'uidvalidity: Ordner zurückgesetzt'
       WHERE status = 'pending'
         AND json_extract(payload_json, '$.folderId') = ?
         AND json_extract(payload_json, '$.uidValidity') IS NULL`
    ).run(folderId)
  })()
}
