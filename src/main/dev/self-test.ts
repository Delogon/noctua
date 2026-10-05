import type Database from 'better-sqlite3-multiple-ciphers'
import { sendMail } from '../smtp/sender'
import { syncEngine } from '../sync/engine'
import { startDraftNew, startDraftReply } from '../ai/drafts'
import { startChat } from '../ai/chat'

/**
 * Dev-only Draft-Streaming-Test (NOCTUA_TEST_DRAFT=1): startet einen
 * AI-Antwortentwurf auf den neuesten Thread und loggt die Chunks.
 */
export function runDraftTest(db: Database.Database): void {
  setTimeout(() => {
    const row = db
      .prepare(
        `SELECT m.thread_key, m.subject FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE f.special_use = '\\Inbox' AND m.body_state = 'full'
         ORDER BY m.date DESC LIMIT 1`
      )
      .get() as { thread_key: string; subject: string | null } | undefined
    if (!row) {
      console.log('[drafttest] kein Thread mit Body gefunden')
      return
    }
    console.log(`[drafttest] starte Entwurf für "${row.subject}"…`)
    let received = 0
    const logPush: Parameters<typeof startDraftReply>[1] = (_channel, payload) => {
      const p = payload as { chunk: string; done: boolean; error: string | null }
      if (p.error) console.error(`[drafttest] FEHLER: ${p.error}`)
      else if (p.done) console.log(`[drafttest] FERTIG — ${received} Zeichen gestreamt`)
      else {
        received += p.chunk.length
        if (received <= 200) process.stdout.write(p.chunk)
      }
    }
    startDraftReply(db, logPush, {
      threadKey: row.thread_key,
      instruction: 'Bestätige höflich und knapp den Erhalt.'
    })
  }, 12_000)
}

/**
 * Dev-only Idee→Mail-Test (NOCTUA_TEST_DRAFT_NEW=1): verfasst aus einer
 * Diktat-Idee eine neue Mail und prüft das BETREFF-Protokoll live.
 */
export function runDraftNewTest(db: Database.Database): void {
  setTimeout(() => {
    const account = db.prepare('SELECT id, email FROM accounts ORDER BY id LIMIT 1').get() as
      | { id: number; email: string }
      | undefined
    if (!account) {
      console.log('[draftnew] kein Konto vorhanden — übersprungen')
      return
    }
    console.log(`[draftnew] starte Idee→Mail über Konto ${account.email}…`)
    let text = ''
    let subject: string | null = null
    const logPush: Parameters<typeof startDraftNew>[1] = (_channel, payload) => {
      const p = payload as { chunk: string; done: boolean; error: string | null; subject: string | null }
      if (p.error) console.error(`[draftnew] FEHLER: ${p.error}`)
      else if (p.subject) {
        subject = p.subject
        console.log(`[draftnew] BETREFF-Vorschlag: "${p.subject}"`)
      } else if (p.done) {
        console.log(`[draftnew] FERTIG — subject=${JSON.stringify(subject)} — Text (${text.length} Zeichen):`)
        console.log(text)
      } else text += p.chunk
    }
    startDraftNew(db, logPush, {
      accountId: account.id,
      to: [account.email],
      subject: '',
      idea: 'morgen treffen kaffee so gegen drei fragen ob das passt und dass ich das protokoll mitbringe',
      instruction: undefined
    })
  }, 12_000)
}

/**
 * Dev-only E2E-Roundtrip (NOCTUA_TEST_SELF_SEND=1): sendet eine Mail an das
 * eigene Konto, wartet auf die IDLE-Zustellung in der INBOX, antwortet darauf
 * (In-Reply-To/References) und loggt die gemessene Latenz. Verifiziert SMTP,
 * Sent-Ablage, IDLE-Push und Threading gegen den echten Server.
 */
export function runSelfSendTest(db: Database.Database): void {
  setTimeout(() => {
    void (async () => {
      const account = db.prepare('SELECT id, email FROM accounts ORDER BY id LIMIT 1').get() as
        | { id: number; email: string }
        | undefined
      if (!account) {
        console.log('[selftest] kein Konto vorhanden — übersprungen')
        return
      }
      const marker = `Noctua Selbsttest ${Date.now()}`
      const sentAt = Date.now()
      console.log(`[selftest] sende "${marker}" an ${account.email}`)
      try {
        await sendMail(db, {
          accountId: account.id,
          to: [account.email],
          cc: [],
          subject: marker,
          textBody: 'Automatischer Roundtrip-Test von Noctua (M3). Diese Mail kann gelöscht werden.'
        })
      } catch (error) {
        console.error('[selftest] SEND FEHLGESCHLAGEN:', error)
        return
      }
      console.log('[selftest] gesendet, warte auf IDLE-Zustellung in INBOX…')
      syncEngine.resyncSent(account.id)

      const findInbox = db.prepare(
        `SELECT m.id, m.thread_key FROM messages m JOIN folders f ON f.id = m.folder_id
         WHERE f.special_use = '\\Inbox' AND m.subject = ?`
      )
      const deadline = Date.now() + 90_000
      let delivered: { id: number; thread_key: string } | undefined
      while (Date.now() < deadline) {
        delivered = findInbox.get(marker) as { id: number; thread_key: string } | undefined
        if (delivered) break
        await new Promise((r) => setTimeout(r, 1000))
      }
      if (!delivered) {
        console.error('[selftest] Mail nach 90 s nicht in INBOX — IDLE-Pfad prüfen')
        return
      }
      const latency = ((Date.now() - sentAt) / 1000).toFixed(1)
      console.log(`[selftest] ZUGESTELLT nach ${latency}s (inkl. SMTP+Gmail-intern) — id=${delivered.id}`)

      console.log('[selftest] sende Antwort (Threading-Test)…')
      await sendMail(db, {
        accountId: account.id,
        to: [account.email],
        cc: [],
        subject: `Re: ${marker}`,
        textBody: 'Antwort im selben Thread (References-Test).',
        replyToMessageId: delivered.id
      })
      const replyDeadline = Date.now() + 90_000
      while (Date.now() < replyDeadline) {
        const rows = findInbox.all(`Re: ${marker}`) as Array<{ id: number; thread_key: string }>
        if (rows.length > 0) {
          const sameThread = rows[0].thread_key === delivered.thread_key
          console.log(
            `[selftest] ANTWORT ZUGESTELLT — thread_key ${sameThread ? 'IDENTISCH ✓ Threading funktioniert' : `WEICHT AB ✗ (${rows[0].thread_key} vs ${delivered.thread_key})`}`
          )
          return
        }
        await new Promise((r) => setTimeout(r, 1000))
      }
      console.error('[selftest] Antwort nach 90 s nicht in INBOX')
    })()
  }, 10_000)
}

/** Dev-only Chat-Test (NOCTUA_TEST_CHAT="Frage"): loggt Antwort + Quellen. */
export function runChatTest(db: Database.Database, question: string): void {
  setTimeout(() => {
    console.log(`[chattest] Frage: ${question}`)
    let received = ''
    const logPush: Parameters<typeof startChat>[1] = (_channel, payload) => {
      const p = payload as {
        chunk: string
        done: boolean
        error: string | null
        sources: Array<{ index: number; subject: string | null }> | null
      }
      if (p.error) console.error(`[chattest] FEHLER: ${p.error}`)
      else if (p.done) {
        console.log(`[chattest] ANTWORT: ${received.slice(0, 400)}`)
        console.log(
          `[chattest] QUELLEN: ${(p.sources ?? []).map((s) => `[${s.index}] ${s.subject}`).join(' | ')}`
        )
      } else received += p.chunk
    }
    startChat(db, logPush, { question, history: [] })
  }, 15_000)
}

/** Dev-only M10-Test (NOCTUA_TEST_M10=1). */
export function runM10Test(db: Database.Database): void {
  setTimeout(() => {
    void (async () => {
      const { outboxWorker } = await import('../smtp/outbox')
      const account = db.prepare('SELECT id, email FROM accounts ORDER BY id LIMIT 1').get() as
        | { id: number; email: string }
        | undefined
      if (!account) return console.log('[m10test] kein Konto')

      // 1. Undo Send: einreihen, sofort abbrechen
      const { outboxId } = outboxWorker.enqueue(account.id, {
        to: [account.email],
        cc: [],
        subject: 'M10 Undo-Test (sollte NIE ankommen)',
        textBody: 'abgebrochen'
      })
      const cancel = outboxWorker.cancel(outboxId)
      console.log(`[m10test] Undo: cancel.ok=${cancel.ok}, draft=${cancel.draft ? 'zurück' : 'weg'}`)
      const state = (db.prepare('SELECT state FROM outbox WHERE id = ?').get(outboxId) as { state: string }).state
      console.log(`[m10test] Outbox-Status nach Cancel: ${state} (erwartet: canceled)`)

      // 2. NL-Regel übersetzen
      try {
        const { draftRule } = await import('../ai/rules')
        const drafted = await draftRule(db, 'Google-Benachrichtigungen ueber Speicherplatz immer archivieren')
        console.log(`[m10test] Regel: "${drafted.name}" match=${JSON.stringify(drafted.rule.match)} actions=${JSON.stringify(drafted.rule.actions)}`)
      } catch (e) {
        console.error('[m10test] Regel-Draft:', (e as Error).message)
      }

      console.log('[m10test] FERTIG')
    })()
  }, 12_000)
}
