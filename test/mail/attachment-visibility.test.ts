import { describe, expect, it } from 'vitest'
import { isVisibleMailAttachment } from '@main/mail/attachment-visibility'

describe('isVisibleMailAttachment', () => {
  it('namenloser text/calendar-Teil ist die Einladungs-Alternative, kein Anhang', () => {
    expect(
      isVisibleMailAttachment({ mimeType: 'text/calendar', filename: null, contentId: null }, null)
    ).toBe(false)
  })

  it('benannte .ics-Datei bleibt als Anhang sichtbar', () => {
    expect(
      isVisibleMailAttachment(
        { mimeType: 'text/calendar', filename: 'invite.ics', contentId: null },
        null
      )
    ).toBe(true)
  })

  it('technische Signaturen sind unsichtbar, normale Dateien sichtbar', () => {
    expect(
      isVisibleMailAttachment({ mimeType: 'application/pgp-signature', contentId: null }, null)
    ).toBe(false)
    expect(isVisibleMailAttachment({ mimeType: 'application/pdf', contentId: null }, null)).toBe(
      true
    )
  })
})
