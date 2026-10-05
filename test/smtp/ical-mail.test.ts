import { describe, expect, it } from 'vitest'
import MailComposer from 'nodemailer/lib/mail-composer'
import PostalMime from 'postal-mime'
import { buildReplyIcs } from '@main/calendar/itip'
import { nextcloudRequest } from '../calendar/invite-fixtures'

describe('iMIP-Mail (nodemailer icalEvent)', () => {
  it('REPLY: multipart/alternative mit text/calendar; method=REPLY und .ics-Anhang', async () => {
    const ics = buildReplyIcs(nextcloudRequest, {
      attendeeEmail: 'bob@mail.example.com',
      attendeeName: 'Bob',
      partstat: 'ACCEPTED',
      now: Date.UTC(2026, 9, 5)
    })
    const raw = await new MailComposer({
      from: 'bob@mail.example.com',
      to: 'alice@cloud.example.org',
      subject: 'Accepted: Projekt-Kickoff',
      text: 'Bob has accepted this invitation.',
      messageId: '<abc@mail.example.com>',
      icalEvent: { method: 'REPLY', content: ics }
    })
      .compile()
      .build()
    const text = raw.toString()
    expect(text).toMatch(/Content-Type: multipart\/alternative/)
    expect(text).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REPLY/)
    expect(text).toMatch(/Message-ID: <abc@mail\.example\.com>/)
    const parsed = await PostalMime.parse(raw)
    expect(parsed.text).toContain('accepted')
    const cal = parsed.attachments.filter((a) => a.mimeType === 'text/calendar')
    expect(cal.length).toBeGreaterThan(0)
    expect(cal[0].method).toBe('REPLY')
  })
})
