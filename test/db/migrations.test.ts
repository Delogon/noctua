import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'
import { upsertEnvelope } from '@main/mail/ingest'

describe('migrations', () => {
  let db: Database.Database

  afterEach(() => {
    if (db) closeTestDb(db)
  })

  it('wenden alle Migrationen sauber an und setzen user_version', () => {
    db = createTestDb()
    expect(db.pragma('user_version', { simple: true })).toBe(23)
  })

  it('erzwingt eindeutige Postfachnamen unabhängig von Großschreibung', () => {
    db = createTestDb()
    const columns = (
      db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(columns).toContain('account_name')

    db.prepare(
      `INSERT INTO accounts (email, account_name, provider, credential_type,
       imap_host, imap_port, smtp_host, smtp_port, color, created_at)
       VALUES ('one@example.org', 'Europa', 'imap', 'password', 'imap.test', 993, 'smtp.test', 465, '#ffffff', 1)`
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO accounts (email, account_name, provider, credential_type,
         imap_host, imap_port, smtp_host, smtp_port, color, created_at)
         VALUES ('two@example.org', 'europa', 'imap', 'password', 'imap.test', 993, 'smtp.test', 465, '#ffffff', 1)`
        )
        .run()
    ).toThrow()
    expect(() =>
      db
        .prepare(
          `INSERT INTO accounts (email, provider, credential_type,
         imap_host, imap_port, smtp_host, smtp_port, color, created_at)
         VALUES ('missing@example.org', 'imap', 'password', 'imap.test', 993, 'smtp.test', 465, '#ffffff', 1)`
        )
        .run()
    ).toThrow()
  })

  it('legen die Kern-Tabellen an', () => {
    db = createTestDb()
    const tables = new Set(
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{
          name: string
        }>
      ).map((r) => r.name)
    )
    for (const t of [
      'accounts',
      'folders',
      'messages',
      'message_bodies',
      'message_header_details',
      'ai_annotations',
      'ai_jobs',
      'tasks',
      'followups',
      'outbox',
      'rules',
      'secrets',
      'settings',
      'owl_conversations'
    ]) {
      expect(tables, `Tabelle ${t} fehlt`).toContain(t)
    }
  })

  it('legen FTS5- und Vektor-Tabellen an', () => {
    db = createTestDb()
    const names = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE name LIKE ? OR name LIKE ?`)
        .all('messages_fts%', 'message_vecs%') as Array<{ name: string }>
    ).map((r) => r.name)
    expect(names).toContain('messages_fts')
    expect(names).toContain('message_vecs')
  })

  it('legt den versionierten Embedding-Stand und Backfill-Cursor an', () => {
    db = createTestDb()
    const stateColumns = (
      db.prepare('PRAGMA table_info(message_embedding_state)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(stateColumns).toEqual(
      expect.arrayContaining([
        'message_id',
        'content_hash',
        'embedded_hash',
        'embedding_model',
        'indexed_at'
      ])
    )
    const folderColumns = (
      db.prepare('PRAGMA table_info(folders)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(folderColumns).toEqual(
      expect.arrayContaining(['envelope_backfill_since', 'body_backfill_since'])
    )
  })

  it('enthalten die M10-Spalten an messages (list_unsubscribe_url)', () => {
    db = createTestDb()
    const cols = (db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    )
    expect(cols).toContain('list_unsubscribe')
    expect(cols).toContain('list_unsubscribe_url')
    expect(cols).toContain('list_unsubscribe_post')
  })

  it('legt den lokalen Header-Detail-Cache mit Cascade auf Nachrichten an', () => {
    db = createTestDb()
    const columns = (
      db.prepare('PRAGMA table_info(message_header_details)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(columns).toEqual(
      expect.arrayContaining([
        'message_id',
        'from_json',
        'sender_json',
        'to_json',
        'cc_json',
        'bcc_json',
        'reply_to_json',
        'raw_headers',
        'raw_headers_truncated',
        'fetched_at'
      ])
    )

    const accountId = seedAccount(db)
    const folderId = seedFolder(db, accountId, '\\Inbox')
    const messageId = upsertEnvelope(
      db,
      accountId,
      folderId,
      makeEnvelope({ uid: 814, messageId: '<headers-cascade@example.org>' })
    )!.messageId
    db.prepare(
      `INSERT INTO message_header_details (message_id, raw_headers, fetched_at)
       VALUES (?, 'From: Alice <alice@example.org>\r\n', 1)`
    ).run(messageId)

    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId)

    expect(db.prepare('SELECT count(*) count FROM message_header_details').get()).toEqual({
      count: 0
    })
  })

  it('erlaubt oauth-google und erhält Daten + Fremdschlüssel beim accounts-Neubau', () => {
    db = createTestDb()
    // Bestand überlebt den Neubau: Konto + Ordner + Nachricht bleiben verknüpft
    const acc = seedAccount(db, { email: 'bestand@test.de' })
    const folder = seedFolder(db, acc, '\\Inbox')
    upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 1, messageId: '<bestand@t>' }))
    expect(db.prepare('SELECT count(*) n FROM messages WHERE account_id = ?').get(acc)).toEqual({
      n: 1
    })

    // Neuer credential_type wird angenommen …
    db.prepare(
      `INSERT INTO accounts (email, account_name, provider, credential_type,
        imap_host, imap_port, smtp_host, smtp_port, created_at)
       VALUES ('oauth@gmail.com', 'OAuth', 'gmail', 'oauth-google',
        'imap.gmail.com', 993, 'smtp.gmail.com', 465, 1)`
    ).run()
    // … Unsinn weiterhin nicht
    expect(() =>
      db
        .prepare(
          `INSERT INTO accounts (email, account_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, created_at)
         VALUES ('kaputt@test.de', 'Kaputt', 'gmail', 'quatsch',
          'imap.test', 993, 'smtp.test', 465, 1)`
        )
        .run()
    ).toThrow(/CHECK constraint/)

    // Trigger und Namens-Index haben den Neubau überlebt
    expect(() =>
      db
        .prepare(
          `INSERT INTO accounts (email, account_name, provider, credential_type,
          imap_host, imap_port, smtp_host, smtp_port, created_at)
         VALUES ('ohnename@test.de', '', 'imap', 'password', 'h', 993, 's', 465, 1)`
        )
        .run()
    ).toThrow(/Postfachname fehlt/)

    // ON DELETE CASCADE der Kinder zeigt weiter auf die neue Tabelle
    db.prepare('DELETE FROM accounts WHERE id = ?').run(acc)
    expect(db.prepare('SELECT count(*) n FROM messages WHERE account_id = ?').get(acc)).toEqual({
      n: 0
    })
  })

  it('legt die Eulen-Gespräche mit Verlaufs-JSON an (M19)', () => {
    db = createTestDb()
    const columns = (
      db.prepare('PRAGMA table_info(owl_conversations)').all() as Array<{ name: string }>
    ).map((column) => column.name)
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'title', 'messages_json', 'created_at', 'updated_at'])
    )
  })

  it('sind idempotent (runMigrations auf voller DB ändert nichts)', async () => {
    db = createTestDb()
    const { runMigrations } = await import('@main/db/migrate')
    const result = runMigrations(db)
    expect(result).toEqual({ from: 23, to: 23 })
  })

  it('bereinigt Aufgaben aus kontenuebergreifenden Selbst-Sends', async () => {
    db = createTestDb()
    const sender = seedAccount(db, { email: 'sender@example.org' })
    const receiver = seedAccount(db, { email: 'receiver@example.org' })
    const inbox = seedFolder(db, receiver, '\\Inbox', 'INBOX')
    const messageId = upsertEnvelope(
      db,
      receiver,
      inbox,
      makeEnvelope({
        uid: 900,
        messageId: '<self-send@example.org>',
        fromAddr: 'sender@example.org',
        to: [{ name: null, address: 'receiver@example.org' }]
      })
    )!.messageId
    db.prepare(
      `INSERT INTO ai_annotations
       (message_id, category, priority, action_items_json, needs_reply, prompt_version, created_at)
       VALUES (?, 'work', 3, '[{"title":"Falsche Aufgabe","due":null}]', 1, 4, 1)`
    ).run(messageId)
    db.prepare(
      `INSERT INTO tasks
       (source_kind, source_id, account_id, title, status, created_at)
       VALUES ('mail', ?, ?, 'Falsche Aufgabe', 'open', 1)`
    ).run(messageId, receiver)

    // Eine echte v11-DB besitzt die M13/M14/M15/M19/M20/M23-Strukturen noch nicht. Der Test startet
    // sonst zwar bei user_version 11, behaelt aber physisch das aktuelle Schema.
    db.exec(`
      ALTER TABLE ai_annotations DROP COLUMN addressed_to_me;
      ALTER TABLE followups DROP COLUMN nudged_at;
      ALTER TABLE contact_stats DROP COLUMN display_name;
      DROP INDEX IF EXISTS idx_msg_from_addr_lower;
      DROP TABLE drafts;
      DROP TABLE owl_conversations;
      DROP TABLE message_header_details;
      DROP TABLE message_embedding_state;
      DROP TABLE messages_fts;
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        subject, sender, recipients, body,
        content = '',
        tokenize = "unicode61 remove_diacritics 2",
        prefix = '2 3'
      );
      ALTER TABLE folders DROP COLUMN envelope_backfill_since;
      ALTER TABLE folders DROP COLUMN body_backfill_since;
    `)
    db.pragma('user_version = 11')
    const { runMigrations } = await import('@main/db/migrate')
    expect(runMigrations(db)).toEqual({ from: 11, to: 23 })
    expect(db.prepare('SELECT count(*) count FROM tasks').get()).toEqual({ count: 0 })
    expect(
      db
        .prepare('SELECT action_items_json, needs_reply FROM ai_annotations WHERE message_id = ?')
        .get(messageId)
    ).toEqual({ action_items_json: '[]', needs_reply: 0 })
    expect(sender).not.toBe(receiver)
  })
})
