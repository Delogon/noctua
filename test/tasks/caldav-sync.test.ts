import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { DavClient } from '@main/dav'
import { syncAccount, type ConflictInfo, type SyncContext } from '@main/calendar/sync'
import { getCalAccount, listDeadOps, listPendingOps, type CalAccountRow } from '@main/calendar/repo'
import {
  afterCalendarChanged,
  initTasksSync,
  reconcileTasks,
  setTasksSyncCalendar
} from '@main/tasks/caldav-sync'
import { listTasks, updateTaskStatus } from '@main/db/repos/tasks'
import { buildTodoIcs, fieldsHash, patchTodoIcs, readTodo, taskUid } from '@main/tasks/todo'
import { closeTestDb, createTestDb } from '../helpers/db'
import { FakeCalDavServer } from '../helpers/fake-caldav'

const NOW = Date.UTC(2099, 0, 10, 12, 0, 0)

const vtodo = (lines: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nextcloud Tasks//EN',
    'BEGIN:VTODO',
    ...lines,
    'END:VTODO',
    'END:VCALENDAR',
    ''
  ].join('\r\n')

describe('VTODO-Abbildung', () => {
  it('liest Titel, Notiz, Datum-Fälligkeit und offenen Status', () => {
    const f = readTodo(
      vtodo([
        'UID:u1',
        'SUMMARY:Steuer machen',
        'DESCRIPTION:Belege sammeln',
        'DUE;VALUE=DATE:20990131',
        'STATUS:NEEDS-ACTION'
      ])
    )
    expect(f).toMatchObject({
      uid: 'u1',
      title: 'Steuer machen',
      notes: 'Belege sammeln',
      due: '2099-01-31',
      done: false
    })
  })

  it('DUE als Date-Time mit TZID und floating wird zum Wanddatum', () => {
    expect(
      readTodo(vtodo(['UID:a', 'SUMMARY:x', 'DUE;TZID=Europe/Berlin:20990131T233000'])).due
    ).toBe('2099-01-31')
    expect(readTodo(vtodo(['UID:b', 'SUMMARY:x', 'DUE:20990201T010000'])).due).toBe('2099-02-01')
  })

  it('DUE in UTC folgt der Systemzone', () => {
    const f = readTodo(vtodo(['UID:c', 'SUMMARY:x', 'DUE:20990131T120000Z']))
    expect(f.due).toBe('2099-01-31')
  })

  it('erledigt: STATUS, COMPLETED, PERCENT-COMPLETE', () => {
    const done = (l: string[]): boolean => readTodo(vtodo(['UID:d', 'SUMMARY:x', ...l])).done
    expect(done(['STATUS:COMPLETED'])).toBe(true)
    expect(done(['COMPLETED:20990101T100000Z'])).toBe(true)
    expect(done(['PERCENT-COMPLETE:100'])).toBe(true)
    expect(done(['STATUS:IN-PROCESS', 'PERCENT-COMPLETE:40'])).toBe(false)
  })

  it('schreibt neue VTODOs mit Mail-Link', () => {
    const ics = buildTodoIcs(
      'noctua-task-7@noctua',
      { title: 'Antworten', notes: 'Aus: Hallo', due: '2099-03-01', done: false },
      { now: NOW, messageId: '<abc@mail.example>' }
    )
    expect(ics).toContain('BEGIN:VTODO')
    expect(ics).toContain('X-NOCTUA-MESSAGE-ID:abc@mail.example')
    expect(ics).toContain('URL:mid:abc@mail.example')
    expect(ics).toContain('DUE;VALUE=DATE:20990301')
    expect(ics).toContain('STATUS:NEEDS-ACTION')
    const back = readTodo(ics)
    expect(back).toMatchObject({
      title: 'Antworten',
      due: '2099-03-01',
      messageId: 'abc@mail.example'
    })
  })

  it('Round-Trip: nur Geändertes wird angefasst, Unbekanntes bleibt', () => {
    const src = vtodo([
      'UID:u2',
      'SUMMARY:Alt',
      'DUE;TZID=Europe/Berlin:20990131T170000',
      'PRIORITY:3',
      'CATEGORIES:Arbeit,Privat',
      'X-CUSTOM-FOO;X-PARAM=1:bar',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'DESCRIPTION:Erinnerung',
      'END:VALARM'
    ])
    const prev = readTodo(src)
    // nur der Titel ändert sich: DUE (mit Uhrzeit/TZID) bleibt unangetastet
    const out = patchTodoIcs(src, { ...prev, title: 'Neu' }, prev, NOW)
    expect(out).toContain('SUMMARY:Neu')
    expect(out).toContain('DUE;TZID=Europe/Berlin:20990131T170000')
    expect(out).toContain('PRIORITY:3')
    expect(out).toContain('CATEGORIES:Arbeit,Privat')
    expect(out).toContain('X-CUSTOM-FOO;X-PARAM=1:bar')
    expect(out).toContain('BEGIN:VALARM')
    expect(out).toContain('TRIGGER:-PT15M')
  })

  it('Erledigen setzt STATUS/COMPLETED/PERCENT, Wiederöffnen räumt auf', () => {
    const src = vtodo(['UID:u3', 'SUMMARY:x', 'PRIORITY:1'])
    const open = readTodo(src)
    const done = patchTodoIcs(src, { ...open, done: true }, open, NOW)
    expect(done).toMatch(/STATUS:COMPLETED/)
    expect(done).toMatch(/COMPLETED:20990110T120000Z/)
    expect(done).toMatch(/PERCENT-COMPLETE:100/)
    expect(done).toContain('PRIORITY:1')
    const reopened = patchTodoIcs(done, open, readTodo(done), NOW)
    expect(reopened).toContain('STATUS:NEEDS-ACTION')
    expect(reopened).not.toContain('COMPLETED:')
    expect(reopened).not.toContain('PERCENT-COMPLETE')
  })

  it('Hash ignoriert Zeilenenden und Rand-Whitespace', () => {
    const a = { title: 'x ', notes: 'a\r\nb', due: null, done: false }
    const b = { title: 'x', notes: 'a\nb ', due: null, done: false }
    expect(fieldsHash(a)).toBe(fieldsHash(b))
    expect(fieldsHash(a)).not.toBe(fieldsHash({ ...a, done: true }))
  })
})

// --- Abgleich mit Fake-Server ---------------------------------------------------------------------

let db: Database.Database
let server: FakeCalDavServer
let account: CalAccountRow
let conflicts: ConflictInfo[]
let tasksChanged: number

beforeEach(() => {
  db = createTestDb()
  server = new FakeCalDavServer({ components: ['VEVENT', 'VTODO'] })
  server.addCalendar('tasks', 'Aufgaben')
  conflicts = []
  tasksChanged = 0
  initTasksSync({
    onTasksChanged: () => (tasksChanged += 1),
    onConflict: (c) =>
      conflicts.push({ ...c, kind: 'update', reason: 'conflict', summary: c.summary })
  })
  const r = db
    .prepare(
      `INSERT INTO cal_accounts (name, server_url, home_url, username, created_at)
       VALUES ('Test', 'https://cal.test/dav/', 'https://cal.test/dav/calendars/anna/', 'anna', 1)`
    )
    .run()
  account = getCalAccount(db, Number(r.lastInsertRowid))!
})
afterEach(() => {
  initTasksSync({ onTasksChanged: () => {}, onConflict: () => {} })
  closeTestDb(db)
})

function ctx(): SyncContext {
  return {
    db,
    client: new DavClient({ username: 'anna', password: 'pw', fetch: server.fetch }),
    events: {
      onChanged: (a, ids) => afterCalendarChanged(db, a, ids),
      onConflict: (c) => conflicts.push(c)
    }
  }
}

/** Ein voller Zyklus wie im Betrieb: Sync (Push+Pull) mit anschließendem Abgleich, dann Push. */
async function cycle(times = 2): Promise<void> {
  for (let i = 0; i < times; i++) {
    await syncAccount(ctx(), account, { force: true })
    reconcileTasks(db)
  }
  await syncAccount(ctx(), account, { force: true })
}

function calId(): number {
  return (db.prepare('SELECT id FROM calendars').get() as { id: number }).id
}

async function enable(): Promise<void> {
  await syncAccount(ctx(), account) // Kalenderliste laden
  setTasksSyncCalendar(db, calId())
  await cycle()
}

function addTask(
  title: string,
  over: Partial<{
    status: string
    due: string | null
    notes: string | null
    sourceId: number | null
  }> = {}
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO tasks (source_kind, source_id, account_id, title, notes, due_date, status, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 1)`
      )
      .run(
        'manual',
        over.sourceId ?? null,
        title,
        over.notes ?? null,
        over.due ?? null,
        over.status ?? 'open'
      ).lastInsertRowid
  )
}

const serverFiles = (): string[] =>
  [...(server.calendars.get('tasks')?.objects.keys() ?? [])].map((h) => h.split('/').pop()!)

const taskRow = (
  id: number
): { title: string; status: string; due_date: string | null } | undefined =>
  db.prepare('SELECT title, status, due_date FROM tasks WHERE id = ?').get(id) as never

describe('Aufgaben <-> CalDAV', () => {
  it('Standard aus: ohne gewählte Liste passiert nichts', async () => {
    addTask('A')
    await syncAccount(ctx(), account)
    expect(reconcileTasks(db)).toEqual({ tasksChanged: false, queued: false })
    expect(serverFiles()).toEqual([])
  })

  it('aktive Aufgaben werden hochgeladen; verworfene, erledigte und KI-Vorschläge nie', async () => {
    const open = addTask('Offen', { due: '2099-02-01', notes: 'Aus: Mail' })
    addTask('Verworfen', { status: 'dismissed' })
    addTask('Schon erledigt', { status: 'done' })
    // KI-Vorschlag: nur Annotation, nie eine Aufgabenzeile
    const acc = Number(
      db
        .prepare(
          `INSERT INTO accounts (email, account_name, provider, credential_type, imap_host, imap_port,
             smtp_host, smtp_port, color, created_at)
           VALUES ('me@example.org','Me','imap','password','i',993,'s',465,'#fff',1)`
        )
        .run().lastInsertRowid
    )
    expect(acc).toBeGreaterThan(0)
    await enable()

    expect(serverFiles()).toEqual([`${taskUid(open)}.ics`])
    const ics = server.object('tasks', `${taskUid(open)}.ics`)!.ics
    expect(ics).toContain('SUMMARY:Offen')
    expect(ics).toContain('DUE;VALUE=DATE:20990201')
    const put = server.callsOfKind('put').find((c) => c.method === 'PUT')
    expect(put?.headers['if-none-match']).toBe('*')
    expect(listPendingOps(db, account.id)).toHaveLength(0)
  })

  it('neue Aufgaben aus der Triage (accept) werden synchronisiert, Vorschlag allein nicht', async () => {
    await enable()
    // decideSuggestion(dismiss) legt nur einen 'dismissed'-Merker an
    const mid = seedMail()
    db.prepare(
      `INSERT INTO ai_annotations (message_id, category, priority, action_items_json, needs_reply, prompt_version, created_at)
       VALUES (?, 'work', 3, '[{"title":"Rechnung zahlen","due":null}]', 0, 1, 1)`
    ).run(mid)
    const { decideSuggestion } = await import('@main/db/repos/tasks')
    decideSuggestion(db, 'thread-1', false)
    await cycle()
    expect(serverFiles()).toEqual([])
    decideSuggestion(db, 'thread-1', true) // zweites INSERT OR IGNORE ändert den Merker nicht
    expect(serverFiles()).toEqual([])
    // frischer Thread, akzeptiert
    const mid2 = seedMail('thread-2', '<m2@x>')
    db.prepare(
      `INSERT INTO ai_annotations (message_id, category, priority, action_items_json, needs_reply, prompt_version, created_at)
       VALUES (?, 'work', 3, '[{"title":"Vertrag prüfen","due":"2099-05-05"}]', 0, 1, 1)`
    ).run(mid2)
    decideSuggestion(db, 'thread-2', true)
    await cycle()
    expect(serverFiles()).toHaveLength(1)
    const ics = [...server.calendars.get('tasks')!.objects.values()][0].ics
    expect(ics).toContain('SUMMARY:Vertrag prüfen')
    expect(ics).toContain('X-NOCTUA-MESSAGE-ID:m2@x')
  })

  function seedMail(threadKey = 'thread-1', messageId = '<m1@x>'): number {
    const acc = Number(
      (db.prepare('SELECT id FROM accounts LIMIT 1').get() as { id: number } | undefined)?.id ??
        db
          .prepare(
            `INSERT INTO accounts (email, account_name, provider, credential_type, imap_host, imap_port,
               smtp_host, smtp_port, color, created_at)
             VALUES ('me@example.org','Me','imap','password','i',993,'s',465,'#fff',1)`
          )
          .run().lastInsertRowid
    )
    const folder = Number(
      (db.prepare('SELECT id FROM folders LIMIT 1').get() as { id: number } | undefined)?.id ??
        db
          .prepare(
            `INSERT INTO folders (account_id, path, special_use) VALUES (?, 'INBOX', '\\Inbox')`
          )
          .run(acc).lastInsertRowid
    )
    return Number(
      db
        .prepare(
          `INSERT INTO messages (account_id, folder_id, uid, message_id, thread_key, subject, from_addr, date)
           VALUES (?, ?, ?, ?, ?, 'Betreff', 'chef@firma.example', 1)`
        )
        .run(acc, folder, Math.floor(Math.random() * 1e6), messageId, threadKey).lastInsertRowid
    )
  }

  it('Aufgabe aus Nextcloud erscheint als manuelle Aufgabe und bleibt stabil', async () => {
    server.put(
      'tasks',
      'nc1.ics',
      vtodo(['UID:nc1', 'SUMMARY:Aus Nextcloud', 'DUE;VALUE=DATE:20990301', 'DESCRIPTION:Notiz'])
    )
    await enable()
    const rows = listTasks(db, 'open')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      title: 'Aus Nextcloud',
      sourceKind: 'manual',
      dueDate: '2099-03-01',
      notes: 'Notiz',
      syncState: 'synced'
    })
    // nichts zurückgeschrieben
    expect(server.callsOfKind('put').filter((c) => c.method === 'PUT')).toHaveLength(0)
    expect(tasksChanged).toBeGreaterThan(0)
  })

  it('lokal erledigen: PUT mit If-Match, unbekannte Properties bleiben', async () => {
    server.put('tasks', 'nc1.ics', vtodo(['UID:nc1', 'SUMMARY:Aufgabe', 'PRIORITY:2', 'X-FOO:bar']))
    await enable()
    const id = (db.prepare('SELECT id FROM tasks').get() as { id: number }).id
    const etagBefore = server.object('tasks', 'nc1.ics')!.etag
    server.calls.length = 0
    updateTaskStatus(db, id, 'done')
    expect(listTasks(db, 'done')[0].syncState).toBe('pending')
    await cycle()
    const puts = server.calls.filter((c) => c.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].headers['if-match']).toBe(etagBefore)
    const ics = server.object('tasks', 'nc1.ics')!.ics
    expect(ics).toContain('STATUS:COMPLETED')
    expect(ics).toContain('PRIORITY:2')
    expect(ics).toContain('X-FOO:bar')
    expect(listTasks(db, 'done')[0].syncState).toBe('synced')
    // stabil: weitere Zyklen erzeugen keine weiteren PUTs
    server.calls.length = 0
    await cycle()
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('Server-Änderung (Titel, Fälligkeit, erledigt) wird übernommen', async () => {
    server.put('tasks', 'nc1.ics', vtodo(['UID:nc1', 'SUMMARY:Alt']))
    await enable()
    server.put(
      'tasks',
      'nc1.ics',
      vtodo(['UID:nc1', 'SUMMARY:Neu', 'DUE;VALUE=DATE:20990401', 'STATUS:COMPLETED'])
    )
    await cycle()
    const done = listTasks(db, 'done')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ title: 'Neu', dueDate: '2099-04-01', status: 'done' })
  })

  it('lokal verwerfen löscht serverseitig (DELETE mit If-Match)', async () => {
    const id = addTask('Weg damit')
    await enable()
    const file = `${taskUid(id)}.ics`
    const etag = server.object('tasks', file)!.etag
    server.calls.length = 0
    updateTaskStatus(db, id, 'dismissed')
    await cycle()
    expect(serverFiles()).toEqual([])
    const del = server.calls.find((c) => c.method === 'DELETE')
    expect(del?.headers['if-match']).toBe(etag)
    expect(db.prepare('SELECT count(*) n FROM task_caldav').get()).toEqual({ n: 0 })
  })

  it('lokal gelöschte Aufgabe (Zeile weg) löscht serverseitig', async () => {
    const id = addTask('Zeile weg')
    await enable()
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    reconcileTasks(db)
    await cycle()
    expect(serverFiles()).toEqual([])
  })

  it('Server-Löschung entfernt die lokale Aufgabe', async () => {
    server.put('tasks', 'nc1.ics', vtodo(['UID:nc1', 'SUMMARY:Wird gelöscht']))
    const id = addTask('Bleibt')
    await enable()
    expect(listTasks(db, 'open')).toHaveLength(2)
    server.remove('tasks', 'nc1.ics')
    await cycle()
    const titles = listTasks(db, 'open').map((t) => t.title)
    expect(titles).toEqual(['Bleibt'])
    expect(taskRow(id)).toBeDefined()
  })

  it('412: Server-Fassung bleibt, Konflikt wird gemeldet, Aufgabe zeigt Serverstand', async () => {
    server.put('tasks', 'nc1.ics', vtodo(['UID:nc1', 'SUMMARY:Original']))
    await enable()
    const id = (db.prepare('SELECT id FROM tasks').get() as { id: number }).id
    // lokale Änderung (reiht Update ein), anderer Client ändert vor dem Push
    db.prepare(`UPDATE tasks SET title = 'Meine Fassung' WHERE id = ?`).run(id)
    reconcileTasks(db)
    expect(listPendingOps(db, account.id)).toHaveLength(1)
    server.put('tasks', 'nc1.ics', vtodo(['UID:nc1', 'SUMMARY:Server-Fassung']))
    conflicts = []
    await cycle()
    expect(conflicts.some((c) => c.reason === 'conflict' && c.uid === 'nc1')).toBe(true)
    expect(server.object('tasks', 'nc1.ics')!.ics).toContain('Server-Fassung')
    expect(taskRow(id)!.title).toBe('Server-Fassung')
    expect(listDeadOps(db, account.id)).toHaveLength(1)
    expect(listTasks(db, 'open')[0].syncState).toBe('conflict')
  })

  it('erneutes Aktivieren dedupliziert per UID (auch ohne Zuordnungen)', async () => {
    const id = addTask('Einmalig')
    server.put('tasks', 'nc1.ics', vtodo(['UID:nc1', 'SUMMARY:Vom Server']))
    await enable()
    expect(serverFiles().sort()).toEqual(['nc1.ics', `${taskUid(id)}.ics`].sort())
    // aus, Zuordnungen verloren, wieder an
    setTasksSyncCalendar(db, null)
    db.prepare('DELETE FROM task_caldav').run()
    setTasksSyncCalendar(db, calId())
    await cycle()
    expect(serverFiles()).toHaveLength(2)
    expect(listTasks(db, 'open')).toHaveLength(2)
    expect(server.callsOfKind('put').filter((c) => c.method === 'PUT')).toHaveLength(1)
  })

  it('Wechsel der Liste verwirft Zuordnungen, Aufgaben bleiben lokal', async () => {
    addTask('Lokal')
    await enable()
    server.addCalendar('tasks2', 'Zweite')
    await syncAccount(ctx(), account, { force: true })
    const other = (
      db.prepare(`SELECT id FROM calendars WHERE display_name = 'Zweite'`).get() as { id: number }
    ).id
    setTasksSyncCalendar(db, other)
    await cycle()
    expect(listTasks(db, 'open')).toHaveLength(1)
    expect(server.calendars.get('tasks2')!.objects.size).toBe(1)
  })

  it('lehnt schreibgeschützte bzw. VTODO-lose Kalender ab', async () => {
    await syncAccount(ctx(), account)
    db.prepare(`UPDATE calendars SET components = 'VEVENT'`).run()
    expect(() => setTasksSyncCalendar(db, calId())).toThrow()
  })
})
