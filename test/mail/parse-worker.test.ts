import { describe, expect, it } from 'vitest'
import { handleParseRequest } from '@main/mail/parse-worker'
import { parseMail } from '@main/mail/parser'
import { parseMailOffThread } from '@main/mail/parse-off-thread'

const source = Buffer.from(
  [
    'From: Alice <alice@test.de>',
    'To: tim@test.de',
    'Subject: Hallo',
    'Message-ID: <p1@test>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Wie geht es dir?'
  ].join('\r\n')
)

describe('parse worker protocol', () => {
  it('returns the same result as parsing in-process', async () => {
    const response = await handleParseRequest({ id: 4, source })
    expect(response).toEqual({ id: 4, parsed: await parseMail(source) })
    // Structured clone keeps it intact (what crosses the thread boundary)
    expect(structuredClone(response)).toEqual(response)
  })

  it('outside Electron parses in-process', async () => {
    expect(await parseMailOffThread(source)).toEqual(await parseMail(source))
  })
})
