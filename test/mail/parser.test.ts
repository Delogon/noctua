import { describe, it, expect } from 'vitest'
import { htmlToText, makeSnippet, parseMail } from '@main/mail/parser'

describe('htmlToText', () => {
  it('entfernt Tags und behält den Textinhalt', () => {
    expect(htmlToText('<p>Hallo <b>Welt</b></p>')).toBe('Hallo Welt')
  })

  it('wirft Script- und Style-Inhalte komplett raus', () => {
    const html = '<style>.a{color:red}</style><p>Text</p><script>alert(1)</script>'
    expect(htmlToText(html)).toBe('Text')
  })

  it('dekodiert gängige Entities und normalisiert Whitespace', () => {
    expect(htmlToText('<p>A&amp;B</p>   <p>C&nbsp;D</p>')).toBe('A&B C D')
  })
})

describe('makeSnippet', () => {
  it('bevorzugt Plaintext', () => {
    expect(makeSnippet('  reiner text  ', '<p>html</p>')).toBe('reiner text')
  })

  it('fällt auf HTML→Text zurück, wenn kein Plaintext da ist', () => {
    expect(makeSnippet(null, '<p>aus html</p>')).toBe('aus html')
  })

  it('kürzt auf maximal 180 Zeichen', () => {
    const long = 'x'.repeat(500)
    expect(makeSnippet(long, null)?.length).toBe(180)
  })

  it('liefert null bei leerem Inhalt', () => {
    expect(makeSnippet(null, null)).toBeNull()
    expect(makeSnippet('   ', '')).toBeNull()
  })
})

describe('parseMail', () => {
  it('parst Header, Adressen und References', async () => {
    const raw = Buffer.from(
      [
        'From: Alice <alice@example.com>',
        'To: Bob <bob@example.com>',
        'Subject: Testbetreff',
        'Message-ID: <msg-1@example.com>',
        'In-Reply-To: <parent@example.com>',
        'References: <root@example.com> <parent@example.com>',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Hallo Bob, das ist der Body.'
      ].join('\r\n'),
      'utf8'
    )
    const parsed = await parseMail(raw)
    expect(parsed.subject).toBe('Testbetreff')
    expect(parsed.from?.address).toBe('alice@example.com')
    expect(parsed.to[0]?.address).toBe('bob@example.com')
    expect(parsed.messageId).toBe('<msg-1@example.com>')
    expect(parsed.references).toContain('<root@example.com>')
    expect(parsed.references).toContain('<parent@example.com>')
    expect(parsed.text).toContain('Hallo Bob')
  })

  it('liefert die echte Anhanggröße (postal-mime gibt Uint8Array zurück)', async () => {
    const raw = Buffer.from(
      [
        'From: a@example.com',
        'Subject: s',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b"',
        '',
        '--b',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Text',
        '--b',
        'Content-Type: application/pdf; name="x.pdf"',
        'Content-Disposition: attachment; filename="x.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from('0123456789').toString('base64'),
        '--b--'
      ].join('\r\n'),
      'utf8'
    )
    const parsed = await parseMail(raw)
    expect(parsed.attachments[0]).toMatchObject({ filename: 'x.pdf', size: 10 })
  })

  it('normalisiert Absenderadressen auf Kleinschreibung', async () => {
    const raw = Buffer.from('From: X <Mixed@Case.COM>\r\nSubject: s\r\n\r\nbody', 'utf8')
    const parsed = await parseMail(raw)
    expect(parsed.from?.address).toBe('mixed@case.com')
  })

  it('wirft nie — kaputte Eingabe liefert ein Fallback-Resultat', async () => {
    const parsed = await parseMail(Buffer.from([0xff, 0xfe, 0x00, 0x01]))
    expect(parsed).toBeDefined()
    expect(parsed.to).toEqual([])
  })
})
