import { existsSync, statSync } from 'node:fs'
import type Database from 'better-sqlite3-multiple-ciphers'
import { folderRole } from '@shared/folder-roles'

// Size and shape of the mailbox — counts only. Accounts appear as
// "Account 1, 2, …" with provider type, without address or name.

export interface DatasetStats {
  accounts: Array<{
    index: number
    provider: string
    syncDays: number | null
    aiEnabled: boolean
    folders: number
    messages: number
    threads: number
    bodies: number
  }>
  totals: Record<string, number | null>
  foldersByRole: Record<string, number>
  largestFolderMessages: number | null
  largestThreadMessages: number | null
  aiJobs: Array<{ kind: string; status: string; count: number }>
  db: {
    fileBytes: number | null
    walBytes: number | null
    pageSize: number | null
    pageCount: number | null
    freelistCount: number | null
    schemaVersion: number | null
    hasStat1: boolean
  }
  indexes: Array<{ table: string; name: string }>
  settings: Record<string, string>
}

function scalar(db: Database.Database, sql: string): number | null {
  try {
    const row = db.prepare(sql).get() as Record<string, unknown> | undefined
    const value = row ? Object.values(row)[0] : null
    return typeof value === 'number' ? value : value === null ? null : Number(value)
  } catch {
    return null
  }
}

function fileSize(path: string | null): number | null {
  if (!path || !existsSync(path)) return null
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

/** Settings that affect load — only these, no content/keys. */
const PERF_SETTINGS = [
  'mail.showFolders',
  'ai.triageProvider',
  'privacy.localOnly',
  'tasks.autoCreate',
  'security.autoJunk',
  'ui.layout'
]

export function collectDatasetStats(db: Database.Database, dbPath: string | null): DatasetStats {
  const accounts = (() => {
    try {
      return db
        .prepare(
          `SELECT a.id, a.provider, a.ai_enabled,
             (SELECT count(*) FROM folders f WHERE f.account_id = a.id) folders,
             (SELECT count(*) FROM messages m WHERE m.account_id = a.id) messages,
             (SELECT count(DISTINCT thread_key) FROM messages m WHERE m.account_id = a.id) threads,
             (SELECT count(*) FROM messages m WHERE m.account_id = a.id AND m.body_state = 'full') bodies
           FROM accounts a ORDER BY a.id`
        )
        .all() as Array<{
        id: number
        provider: string
        ai_enabled: number
        folders: number
        messages: number
        threads: number
        bodies: number
      }>
    } catch {
      return []
    }
  })()
  const syncDays = (id: number): number | null => {
    try {
      const row = db.prepare('SELECT sync_days FROM accounts WHERE id = ?').get(id) as
        { sync_days: number | null } | undefined
      return row?.sync_days ?? null
    } catch {
      return null
    }
  }

  const foldersByRole: Record<string, number> = {}
  try {
    for (const row of db
      .prepare(`SELECT special_use role, sync_mode mode, count(*) n FROM folders GROUP BY 1, 2`)
      .all() as Array<{ role: string | null; mode: string; n: number }>) {
      // Mapped through folderRole: raw SPECIAL-USE strings come from the server
      const key = `${folderRole(row.role)}:${row.mode}`
      foldersByRole[key] = (foldersByRole[key] ?? 0) + row.n
    }
  } catch {
    // older schemas
  }

  let aiJobs: DatasetStats['aiJobs'] = []
  try {
    aiJobs = db
      .prepare('SELECT kind, status, count(*) count FROM ai_jobs GROUP BY kind, status')
      .all() as DatasetStats['aiJobs']
  } catch {
    // no jobs table
  }

  let indexes: DatasetStats['indexes'] = []
  try {
    indexes = db
      .prepare(
        `SELECT tbl_name "table", name FROM sqlite_master WHERE type = 'index' ORDER BY tbl_name, name`
      )
      .all() as DatasetStats['indexes']
  } catch {
    // ignore
  }

  const settings: Record<string, string> = {}
  for (const key of PERF_SETTINGS) {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
        { value: string } | undefined
      if (row) settings[key] = row.value.slice(0, 40)
    } catch {
      // ignore
    }
  }

  return {
    accounts: accounts.map((a, i) => ({
      index: i + 1,
      provider: a.provider,
      syncDays: syncDays(a.id),
      aiEnabled: a.ai_enabled === 1,
      folders: a.folders,
      messages: a.messages,
      threads: a.threads,
      bodies: a.bodies
    })),
    totals: {
      messages: scalar(db, 'SELECT count(*) FROM messages'),
      threads: scalar(db, 'SELECT count(DISTINCT thread_key) FROM messages'),
      bodies: scalar(db, 'SELECT count(*) FROM message_bodies'),
      bodyChars: scalar(
        db,
        'SELECT coalesce(sum(length(text_plain)), 0) + coalesce(sum(length(html_raw)), 0) FROM message_bodies'
      ),
      bodiesPending: scalar(db, `SELECT count(*) FROM messages WHERE body_state = 'none'`),
      attachments: scalar(db, 'SELECT count(*) FROM attachments'),
      headerDetails: scalar(db, 'SELECT count(*) FROM message_header_details'),
      annotations: scalar(db, 'SELECT count(*) FROM ai_annotations'),
      decisions: scalar(db, 'SELECT count(*) FROM ai_decisions'),
      embeddingStates: scalar(db, 'SELECT count(*) FROM message_embedding_state'),
      embeddingsPending: scalar(
        db,
        'SELECT count(*) FROM message_embedding_state WHERE embedded_hash IS NULL OR embedded_hash <> content_hash'
      ),
      contacts: scalar(db, 'SELECT count(*) FROM contact_stats'),
      tasks: scalar(db, 'SELECT count(*) FROM tasks'),
      opQueue: scalar(db, 'SELECT count(*) FROM op_queue'),
      rules: scalar(db, 'SELECT count(*) FROM rules'),
      calendarObjects: scalar(db, 'SELECT count(*) FROM cal_objects'),
      contactsCardDav: scalar(db, 'SELECT count(*) FROM dav_contacts')
    },
    foldersByRole,
    largestFolderMessages: scalar(
      db,
      'SELECT max(n) FROM (SELECT count(*) n FROM messages GROUP BY folder_id)'
    ),
    largestThreadMessages: scalar(
      db,
      'SELECT max(n) FROM (SELECT count(*) n FROM messages GROUP BY thread_key)'
    ),
    aiJobs,
    db: {
      fileBytes: fileSize(dbPath),
      walBytes: fileSize(dbPath ? `${dbPath}-wal` : null),
      pageSize: scalar(db, 'PRAGMA page_size'),
      pageCount: scalar(db, 'PRAGMA page_count'),
      freelistCount: scalar(db, 'PRAGMA freelist_count'),
      schemaVersion: scalar(db, 'PRAGMA user_version'),
      hasStat1: scalar(db, `SELECT count(*) FROM sqlite_master WHERE name = 'sqlite_stat1'`) === 1
    },
    indexes,
    settings
  }
}
