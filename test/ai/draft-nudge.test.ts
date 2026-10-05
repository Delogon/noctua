import { afterEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { startDraftNudge } from '@main/ai/drafts'
import { upsertEnvelope } from '@main/mail/ingest'
import { setSetting } from '@main/db'
import { closeTestDb, createAiTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

// Stups-Entwurf (M75): Der Prompt verhält sich zur Signatur wie der
// Antwort-Prompt — mit eingerichteter Signatur schreibt das Modell keine
// Grußformel, und eine trotzdem erzeugte wird vor der Anzeige gestrippt.

const { fakeCreate } = vi.hoisted(() => ({ fakeCreate: vi.fn() }))

vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: fakeCreate } } })
}))

/** Simulierter Streaming-Response: jedes Element ein Delta-Chunk. */
function modelStreams(...chunks: string[]): void {
  fakeCreate.mockResolvedValueOnce(
    (async function* () {
      for (const chunk of chunks) yield { choices: [{ delta: { content: chunk } }] }
    })()
  )
}

interface DraftResult {
  text: string
  error: string | null
}

/** Startet den Stups-Entwurf und sammelt alle Chunks bis done. */
function collectNudge(
  db: Database.Database,
  input: { messageId: number; idea?: string }
): Promise<DraftResult> {
  return new Promise((resolve) => {
    let text = ''
    startDraftNudge(
      db,
      (channel, payload) => {
        if (channel !== 'ai:draftChunk') return
        const p = payload as { chunk: string; done: boolean; error: string | null }
        text += p.chunk
        if (p.done) resolve({ text, error: p.error })
      },
      input
    )
  })
}

describe('startDraftNudge — Signatur & Idee', () => {
  let db: Database.Database

  afterEach(() => {
    closeTestDb(db)
    fakeCreate.mockReset()
  })

  function seedSentMail(): { accountId: number; messageId: number } {
    db = createAiTestDb()
    const accountId = seedAccount(db, { email: 'me@example.org' })
    const sent = seedFolder(db, accountId, '\\Sent')
    const sentAt = Date.now() - 5 * 24 * 3600 * 1000
    const messageId = upsertEnvelope(
      db,
      accountId,
      sent,
      makeEnvelope({
        uid: 900,
        messageId: '<nudge@example.org>',
        subject: 'Bauzäune für die Kommunalwahl',
        fromAddr: 'me@example.org',
        to: [{ name: 'Heike', address: 'heike@example.org' }],
        date: sentAt,
        internalDate: sentAt
      })
    )!.messageId
    db.prepare("UPDATE messages SET body_state = 'full' WHERE id = ?").run(messageId)
    db.prepare(
      'INSERT INTO message_bodies (message_id, text_plain, html_raw) VALUES (?, ?, NULL)'
    ).run(messageId, 'Hallo Heike,\n\nbekomme ich die Bauzäune?\n\nViele Grüße\nLena Hartmann')
    return { accountId, messageId }
  }

  it('mit eingerichteter Signatur: Prompt verbietet Grußformel, Schlussblock wird gestrippt', async () => {
    const { accountId, messageId } = seedSentMail()
    setSetting(
      `sig.${accountId}`,
      JSON.stringify({
        blocks: ['name', 'studio'],
        values: { name: 'Lena Hartmann', studio: 'Studio Fernweh' },
        img: false,
        imgShape: 'rect',
        imgPos: 'left'
      })
    )
    modelStreams(
      'Hallo Heike,\n\nwollte kurz nachhaken, ',
      'ob du meine Mail gesehen hast.',
      '\n\nViele Grüße\nLena Hartmann'
    )

    const result = await collectNudge(db, { messageId })

    expect(result.error).toBeNull()
    // Grußformel + Namenszeile des Modells fliegen raus — die Signatur hängt
    // erst der Versand-Pfad (sendMail) genau einmal an.
    expect(result.text).toBe(
      'Hallo Heike,\n\nwollte kurz nachhaken, ob du meine Mail gesehen hast.'
    )
    const systemPrompt = fakeCreate.mock.calls[0][0].messages[0].content as string
    expect(systemPrompt).toContain('KEINE Grußformel')
    expect(systemPrompt).not.toContain('Grußformel des Nutzers')
  })

  it('ohne Signatur: Grußformel des Nutzers bleibt erlaubt und erhalten', async () => {
    const { messageId } = seedSentMail()
    modelStreams('Hallo Heike,\n\nkurzer Stups.\n\nViele Grüße\nTim')

    const result = await collectNudge(db, { messageId })

    expect(result.error).toBeNull()
    expect(result.text).toBe('Hallo Heike,\n\nkurzer Stups.\n\nViele Grüße\nTim')
    const systemPrompt = fakeCreate.mock.calls[0][0].messages[0].content as string
    expect(systemPrompt).toContain('Grußformel des Nutzers')
  })

  it('reicht eine Nutzer-Idee (bearbeiteter Stups/Diktat) in den Prompt durch', async () => {
    const { messageId } = seedSentMail()
    modelStreams('Hallo Heike, dringlicher Stups.')

    await collectNudge(db, { messageId, idea: 'Bitte deutlich dringlicher, Frist Freitag.' })

    const userPrompt = fakeCreate.mock.calls[0][0].messages[1].content as string
    expect(userPrompt).toContain('Bitte deutlich dringlicher, Frist Freitag.')
    expect(userPrompt).not.toContain('Schreibe den Nachfass.')
  })

  it('ohne Idee bleibt der klassische Auftrag bestehen', async () => {
    const { messageId } = seedSentMail()
    modelStreams('Hallo Heike, kurzer Stups.')

    await collectNudge(db, { messageId })

    const userPrompt = fakeCreate.mock.calls[0][0].messages[1].content as string
    expect(userPrompt).toContain('Schreibe den Nachfass.')
  })
})
