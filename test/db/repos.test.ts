import { describe, it, expect, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { upsertEnvelope, storeBody } from '@main/mail/ingest'
import { listThreads, getThreadMessages } from '@main/db/repos/threads'
import {
  createTasksFromTriage,
  cleanupForwardTasksWithoutRequest,
  listTasks,
  countOpenTasks,
  updateTaskStatus
} from '@main/db/repos/tasks'
import { createTestDb, closeTestDb, seedAccount, seedFolder, makeEnvelope } from '../helpers/db'

function insertWithBody(
  db: Database.Database,
  acc: number,
  folder: number,
  env: Parameters<typeof makeEnvelope>[0],
  body: { text: string }
): number {
  const res = upsertEnvelope(db, acc, folder, makeEnvelope(env))!
  storeBody(db, res.messageId, {
    messageId: env.messageId ?? '<m@test>',
    inReplyTo: null,
    references: [],
    subject: env.subject ?? 'Betreff',
    from: { name: env.fromName ?? 'A', address: env.fromAddr ?? 'a@test.de' },
    to: [],
    cc: [],
    replyTo: [],
    date: env.date ?? 1_700_000_000_000,
    text: body.text,
    html: null,
    snippet: body.text.slice(0, 100),
    attachments: []
  })
  return res.messageId
}

describe('threads-repo', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('listThreads gruppiert Inbox-Nachrichten und aggregiert Ungelesen/Flag', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 1, messageId: '<a@t>', subject: 'Thema A', flags: new Set() })
    )
    upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({
        uid: 2,
        messageId: '<b@t>',
        subject: 'Re: Thema A',
        inReplyTo: '<a@t>',
        references: ['<a@t>'],
        flags: new Set(['\\Seen'])
      })
    )
    upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({
        uid: 3,
        messageId: '<c@t>',
        subject: 'Thema B',
        flags: new Set(['\\Flagged'])
      })
    )

    const threads = listThreads(db, 200)
    expect(threads).toHaveLength(2) // A+Reply = ein Thread, B = einer
    const threadA = threads.find((t) => t.messageCount === 2)
    expect(threadA?.unread).toBe(true) // mind. eine ungelesen
    const threadB = threads.find((t) => t.flagged)
    expect(threadB?.subject).toBe('Thema B')
  })

  it('Vorschlags-Streifen folgt dem Adressat-Gate', () => {
    db = createTestDb()
    const acc = seedAccount(db, { email: 'lena@test.de' })
    const folder = seedFolder(db, acc, '\\Inbox')

    const seedSuggestion = (
      uid: number,
      subject: string,
      to: string,
      body: string,
      addressedToMe = 1
    ): void => {
      const res = upsertEnvelope(
        db,
        acc,
        folder,
        makeEnvelope({
          uid,
          messageId: `<sugg-${uid}@t>`,
          subject,
          to: [{ name: null, address: to }],
          cc: []
        })
      )!
      storeBody(db, res.messageId, {
        messageId: `<sugg-${uid}@t>`,
        inReplyTo: null,
        references: [],
        subject,
        from: { name: 'Marie', address: 'marie@verein.de' },
        to: [],
        cc: [],
        replyTo: [],
        date: 1_700_000_000_000,
        text: body,
        html: null,
        snippet: body.slice(0, 100),
        attachments: []
      })
      db.prepare(
        `INSERT INTO ai_annotations (message_id, category, priority, prompt_version, needs_reply,
           addressed_to_me, action_items_json, created_at)
         VALUES (?, 'work', 3, 5, 0, ?, ?, 1)`
      ).run(res.messageId, addressedToMe, JSON.stringify([{ title: 'Plakate abholen', due: null }]))
    }

    seedSuggestion(1, 'Verteiler fremd', 'verteiler@verein.de', 'Hallo Jannik,\n\nanbei die Infos.')
    seedSuggestion(2, 'An mich Gruppe', 'lena@test.de', 'Hallo zusammen,\n\nbitte rückmelden.')
    seedSuggestion(3, 'An mich unsicher', 'lena@test.de', 'Hallo zusammen,\n\nJannik macht das.', 0)
    seedSuggestion(4, 'Verteiler Inhaber', 'verteiler@verein.de', 'Hallo Lena,\n\nübernimmst du?')
    seedSuggestion(5, 'Verteiler unsicher', 'verteiler@verein.de', 'Hallo zusammen,\n\nInfos.', 0)

    const bySubject = new Map(listThreads(db, 200).map((t) => [t.subject, t.taskState]))
    expect(bySubject.get('Verteiler fremd')).toBe('none') // fremde Anrede via Verteiler
    expect(bySubject.get('An mich Gruppe')).toBe('suggested')
    expect(bySubject.get('An mich unsicher')).toBe('suggested') // Vorschlag statt Auto-Task
    expect(bySubject.get('Verteiler Inhaber')).toBe('suggested') // Inhaber-Anrede überstimmt absent
    expect(bySubject.get('Verteiler unsicher')).toBe('none')
  })

  it('getThreadMessages liefert Nachrichten chronologisch mit Body', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const id = insertWithBody(
      db,
      acc,
      folder,
      { uid: 1, subject: 'X', messageId: '<x@t>' },
      { text: 'Inhalt' }
    )
    const row = db.prepare('SELECT thread_key FROM messages WHERE id = ?').get(id) as {
      thread_key: string
    }
    const msgs = getThreadMessages(db, row.thread_key)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].bodyText).toBe('Inhalt')
    expect(msgs[0].bodyState).toBe('full')
  })

  it('persistiert den Reply-To-Header aus der Envelope (M80)', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const withReplyTo = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({
        uid: 1,
        messageId: '<rt@t>',
        replyTo: [{ name: 'Antworten', address: 'antworten@test.de' }]
      })
    )!
    const without = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 2, messageId: '<ohne@t>', subject: 'Anderes Thema' })
    )!
    const [msg] = getThreadMessages(db, withReplyTo.threadKey)
    expect(msg.replyTo).toEqual([{ name: 'Antworten', address: 'antworten@test.de' }])
    const [plain] = getThreadMessages(db, without.threadKey)
    expect(plain.replyTo).toEqual([])
  })

  it('liefert echte Anhänge, aber keine im HTML eingebetteten CID-Bilder', () => {
    db = createTestDb()
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    const result = upsertEnvelope(
      db,
      acc,
      folder,
      makeEnvelope({ uid: 1, subject: 'Unterlagen', messageId: '<attachments@t>' })
    )!
    const mail = {
      messageId: '<attachments@t>',
      inReplyTo: null,
      references: [],
      subject: 'Unterlagen',
      from: { name: 'A', address: 'a@test.de' },
      to: [],
      cc: [],
      replyTo: [],
      date: 1_700_000_000_000,
      text: 'Im Anhang.',
      html: '<p>Im Anhang.</p><img src="cid:signature-logo">',
      snippet: 'Im Anhang.',
      attachments: [
        {
          filename: 'Bescheid.pdf',
          mimeType: 'application/pdf',
          contentId: null,
          size: 2048
        },
        {
          filename: 'logo.png',
          mimeType: 'image/png',
          contentId: 'signature-logo',
          size: 512
        },
        {
          filename: 'Foto.jpg',
          mimeType: 'image/jpeg',
          contentId: 'download-photo',
          size: 4096
        },
        {
          filename: null,
          mimeType: 'text/x-amp-html',
          contentId: null,
          size: 128
        }
      ]
    }
    storeBody(db, result.messageId, mail)

    const row = db
      .prepare('SELECT thread_key FROM messages WHERE id = ?')
      .get(result.messageId) as {
      thread_key: string
    }
    let [message] = getThreadMessages(db, row.thread_key)
    expect(message.hasAttachments).toBe(true)
    expect(message.attachments).toEqual([
      {
        id: expect.any(Number),
        filename: 'Bescheid.pdf',
        mimeType: 'application/pdf',
        size: 2048
      },
      {
        id: expect.any(Number),
        filename: 'Foto.jpg',
        mimeType: 'image/jpeg',
        size: 4096
      }
    ])

    storeBody(db, result.messageId, {
      ...mail,
      attachments: [mail.attachments[1], mail.attachments[3]]
    })
    ;[message] = getThreadMessages(db, row.thread_key)
    expect(message.hasAttachments).toBe(false)
    expect(message.attachments).toEqual([])
  })
})

describe('tasks-repo', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  function seedMessage(db: Database.Database): number {
    const acc = seedAccount(db)
    const folder = seedFolder(db, acc, '\\Inbox')
    return upsertEnvelope(db, acc, folder, makeEnvelope({ uid: 1 }))!.messageId
  }

  it('erstellt Aufgaben aus Action-Items erlaubter Kategorien', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: false,
      subject: 'Angebot prüfen',
      actionItems: [{ title: 'Angebot bis Freitag prüfen', due: '2026-07-10' }]
    })
    expect(n).toBe(1)
    expect(countOpenTasks(db)).toBe(1)
    expect(listTasks(db, 'open')[0].dueDate).toBe('2026-07-10')
  })

  it('erstellt KEINE Aufgaben für ausgeschlossene Kategorien (promotions)', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'promotions',
      needsReply: true,
      subject: 'Rabatt',
      actionItems: [{ title: 'Jetzt kaufen', due: null }]
    })
    expect(n).toBe(0)
  })

  it('legt bei ausgeschalteter Automatik (tasks.autoCreate=0) nichts an', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const args = {
      sourceKind: 'mail' as const,
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: true,
      subject: 'Angebot prüfen',
      actionItems: [{ title: 'Angebot prüfen', due: null }]
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES ('tasks.autoCreate', '0')`).run()
    expect(createTasksFromTriage(db, args)).toBe(0)
    expect(countOpenTasks(db)).toBe(0)
    // Wieder einschalten: dieselbe Mail erzeugt die Aufgaben nun regulär
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'tasks.autoCreate'`).run()
    expect(createTasksFromTriage(db, args)).toBeGreaterThan(0)
  })

  it('legt bei needs_reply eine Antwort-Aufgabe an', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'personal',
      needsReply: true,
      subject: 'Frage von Marion',
      actionItems: []
    })
    const titles = listTasks(db, 'open').map((t) => t.title)
    expect(titles.some((t) => t.startsWith('Antworten:'))).toBe(true)
  })

  it('dedupliziert identische Aufgaben (kein Doppel bei Re-Scan)', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const args = {
      sourceKind: 'mail' as const,
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: false,
      subject: 'S',
      actionItems: [{ title: 'Gleiche Aufgabe', due: null }]
    }
    createTasksFromTriage(db, args)
    createTasksFromTriage(db, args)
    expect(countOpenTasks(db)).toBe(1)
  })

  it('erstellt KEINE Aufgaben, wenn das Konto nur im CC steht', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: true,
      subject: '[finance] Bitte um kurzfristige Freigabe',
      actionItems: [{ title: 'Freigabe erteilen', due: '2026-07-08' }],
      accountEmail: 'lena.hartmann@example.eu',
      toJson: JSON.stringify([{ name: null, address: 'finanzen@voltniedersachsen.org' }]),
      ccJson: JSON.stringify([{ name: 'Lena Hartmann', address: 'Lena.Hartmann@example.eu' }])
    })
    expect(n).toBe(0)
    expect(countOpenTasks(db)).toBe(0)
  })

  it('erstellt Aufgaben, wenn das Konto direkt im An steht (CC egal)', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: false,
      subject: 'Direkt an mich',
      actionItems: [{ title: 'Bollerwagen freigeben', due: null }],
      accountEmail: 'lena.hartmann@example.eu',
      toJson: JSON.stringify([{ name: null, address: 'LENA.HARTMANN@example.eu' }]),
      ccJson: JSON.stringify([{ name: null, address: 'andere@example.eu' }])
    })
    expect(n).toBe(1)
  })

  it('Verteiler-Zustellung (weder An noch CC) erzeugt KEINE Aufgaben mehr', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: false,
      subject: 'Team-Verteiler',
      actionItems: [{ title: 'Team-Aufgabe', due: null }],
      accountEmail: 'lena.hartmann@example.eu',
      toJson: JSON.stringify([{ name: null, address: 'oldenburg@voltdeutschland.org' }]),
      ccJson: '[]'
    })
    expect(n).toBe(0)
    expect(countOpenTasks(db)).toBe(0)
  })

  it('Akzeptanzfall: Verteiler-Mail mit „Hallo Jannik" erzeugt KEINE Aufgabe', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'personal',
      needsReply: true,
      subject: 'Plakate und Sponsor Info',
      actionItems: [{ title: 'Plakate abholen', due: null }],
      accountEmail: 'lena.hartmann@example.org',
      toJson: JSON.stringify([{ name: null, address: 'verteiler@verein.de' }]),
      ccJson: '[]',
      bodyText: 'Hallo Jannik,\n\nanbei die Infos zu Plakaten und Sponsoren.',
      addressedToMe: true // selbst wenn das Modell irrt: Stufe 1+2 blocken
    })
    expect(n).toBe(0)
    expect(countOpenTasks(db)).toBe(0)
  })

  it('„Hallo Lena" via Verteiler erzeugt Aufgaben (Inhaber-Anrede überstimmt absent)', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'personal',
      needsReply: false,
      subject: 'Plakate',
      actionItems: [{ title: 'Plakate abholen', due: null }],
      accountEmail: 'lena.hartmann@example.org',
      toJson: JSON.stringify([{ name: null, address: 'verteiler@verein.de' }]),
      ccJson: '[]',
      bodyText: 'Hallo Lena,\n\nkannst du die Plakate abholen?'
    })
    expect(n).toBe(1)
  })

  it('fremde Anrede blockt auch bei An-Platzierung', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: true,
      subject: 'Übergabe',
      actionItems: [{ title: 'Unterlagen vorbereiten', due: null }],
      accountEmail: 'lena.hartmann@example.org',
      toJson: JSON.stringify([{ name: null, address: 'lena.hartmann@example.org' }]),
      ccJson: '[]',
      bodyText: 'Hallo Jannik,\n\nbitte bereite die Unterlagen vor.'
    })
    expect(n).toBe(0)
  })

  it('addressed_to_me=false legt nicht automatisch an (nur Vorschlag)', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: false,
      subject: 'Orga',
      actionItems: [{ title: 'Plakate abholen', due: null }],
      accountEmail: 'lena.hartmann@example.org',
      toJson: JSON.stringify([{ name: null, address: 'lena.hartmann@example.org' }]),
      ccJson: '[]',
      bodyText: 'Hallo zusammen,\n\nJannik übernimmt die Plakate.',
      addressedToMe: false
    })
    expect(n).toBe(0)
  })

  it('erstellt KEINE Aufgaben aus Mails einer anderen verbundenen Adresse', () => {
    db = createTestDb()
    seedAccount(db, { email: 'sender@example.org' })
    const receiver = seedAccount(db, { email: 'receiver@example.org' })
    const inbox = seedFolder(db, receiver, '\\Inbox')
    const msgId = upsertEnvelope(
      db,
      receiver,
      inbox,
      makeEnvelope({
        uid: 51,
        messageId: '<connected-self-send@test>',
        fromAddr: 'sender@example.org',
        to: [{ name: null, address: 'receiver@example.org' }]
      })
    )!.messageId
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: receiver,
      category: 'work',
      needsReply: true,
      subject: 'Von mir selbst',
      actionItems: [{ title: 'Nicht meine Aufgabe', due: null }],
      fromAddr: 'sender@example.org',
      folderSpecialUse: '\\Inbox'
    })

    expect(n).toBe(0)
    expect(countOpenTasks(db)).toBe(0)
  })

  it('erstellt KEINE Aufgaben aus dem Gesendet-Ordner', () => {
    db = createTestDb()
    const accountId = seedAccount(db, { email: 'me@example.org' })
    const sent = seedFolder(db, accountId, '\\Sent')
    const msgId = upsertEnvelope(
      db,
      accountId,
      sent,
      makeEnvelope({ uid: 52, messageId: '<sent@test>', fromAddr: 'me@example.org' })
    )!.messageId
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId,
      category: 'work',
      needsReply: true,
      subject: 'Gesendet',
      actionItems: [{ title: 'Nicht meine Aufgabe', due: null }],
      fromAddr: 'me@example.org',
      folderSpecialUse: '\\Sent'
    })

    expect(n).toBe(0)
  })

  it('erstellt KEINE Aufgaben aus einer nackten Weiterleitung', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    const n = createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: true,
      subject: 'Fwd: Nur zur Info',
      actionItems: [{ title: 'Nicht meine Aufgabe', due: null }],
      forwardWithoutRequest: true
    })

    expect(n).toBe(0)
  })

  it('bereinigt bestehende Aufgaben aus reinen FYI-Weiterleitungen', () => {
    db = createTestDb()
    const accountId = seedAccount(db)
    const inbox = seedFolder(db, accountId, '\\Inbox')
    const messageId = insertWithBody(
      db,
      accountId,
      inbox,
      {
        uid: 53,
        messageId: '<fyi-forward@test>',
        subject: 'Fwd: Nur zur Information'
      },
      {
        text: 'FYI\n\nAnfang der weitergeleiteten Nachricht:\nVon: Alice\nBitte antworten.'
      }
    )
    db.prepare(
      `INSERT INTO tasks (source_kind, source_id, account_id, title, status, created_at)
       VALUES ('mail', ?, ?, 'Falsche Aufgabe', 'open', 1)`
    ).run(messageId, accountId)

    expect(cleanupForwardTasksWithoutRequest(db)).toBe(1)
    expect(countOpenTasks(db)).toBe(0)
  })

  it('updateTaskStatus erledigt und entfernt aus der offenen Liste', () => {
    db = createTestDb()
    const msgId = seedMessage(db)
    createTasksFromTriage(db, {
      sourceKind: 'mail',
      sourceId: msgId,
      accountId: 1,
      category: 'work',
      needsReply: false,
      subject: 'S',
      actionItems: [{ title: 'Erledige mich', due: null }]
    })
    const task = listTasks(db, 'open')[0]
    updateTaskStatus(db, task.id, 'done')
    expect(countOpenTasks(db)).toBe(0)
    expect(listTasks(db, 'done')).toHaveLength(1)
  })
})
