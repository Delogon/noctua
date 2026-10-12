import { describe, expect, it } from 'vitest'
import { buildNudgeSend, nudgedToday } from '@renderer/features/paper/nudge-send'

// Nudge send payload: signature stays out (the send path appends it
// exactly once); the nudge threads into the thread via replyToMessageId.

describe('buildNudgeSend', () => {
  const followup = {
    messageId: 42,
    accountId: 7,
    subject: 'Bauzäune für die Kommunalwahl',
    toAddrs: ['heike.boldt@posteo.de', 'zweite@posteo.de']
  }

  it('baut Re:-Betreff, Empfänger und Thread-Bezug aus dem Followup', () => {
    const payload = buildNudgeSend(followup, 'Hallo Heike,\n\nkurzer Stups.', '<div>x</div>')
    expect(payload).toEqual({
      accountId: 7,
      to: ['heike.boldt@posteo.de', 'zweite@posteo.de'],
      cc: [],
      bcc: [],
      subject: 'Re: Bauzäune für die Kommunalwahl',
      textBody: 'Hallo Heike,\n\nkurzer Stups.',
      htmlBody: '<div>x</div>',
      replyToMessageId: 42
    })
  })

  it('hängt KEINE Signatur an den Text — das übernimmt der Versand-Pfad', () => {
    const payload = buildNudgeSend(followup, 'Kurzer Stups.\n\n', '')
    expect(payload.textBody).toBe('Kurzer Stups.')
    expect(payload.textBody).not.toContain('Tim')
  })

  it('verdoppelt ein vorhandenes Re:/AW: im Betreff nicht', () => {
    expect(buildNudgeSend({ ...followup, subject: 'Re: Termin' }, 'x', '').subject).toBe(
      'Re: Termin'
    )
    expect(buildNudgeSend({ ...followup, subject: 'AW: Termin' }, 'x', '').subject).toBe(
      'Re: Termin'
    )
    expect(buildNudgeSend({ ...followup, subject: null }, 'x', '').subject).toBe('Re: ')
  })
})

describe('nudgedToday', () => {
  it('gilt nur für den Kalendertag', () => {
    const now = new Date('2026-07-16T09:00:00').getTime()
    expect(nudgedToday(new Date('2026-07-16T00:05:00').getTime(), now)).toBe(true)
    expect(nudgedToday(new Date('2026-07-15T23:55:00').getTime(), now)).toBe(false)
    expect(nudgedToday(null, now)).toBe(false)
  })
})
