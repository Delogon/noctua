import { afterEach, describe, expect, it } from 'vitest'
import { __setOrgConfigForTest } from '@main/org-config'
import {
  computeMailSignals,
  isHomoglyphHost,
  lookalikeBrand,
  type MailSignalInput
} from '@main/mail/threat-signals'
import {
  HEURISTIC_PHISHING_HIGH,
  HEURISTIC_PHISHING_SUSPICIOUS,
  HEURISTIC_SPAM_SUSPICIOUS,
  phishingLevel,
  spamLevel
} from '@shared/decision-thresholds'

const base: MailSignalInput = {
  fromName: 'Anna Berger',
  fromAddr: 'anna@firma.de',
  replyToJson: null,
  html: null,
  subject: 'Protokoll vom Dienstag',
  text: 'Hallo Lena, anbei das Protokoll. Viele Grüße, Anna'
}

const codes = (patch: Partial<MailSignalInput>): string[] =>
  computeMailSignals({ ...base, ...patch }).codes

describe('lokale Spam-/Phishing-Signale', () => {
  it('normale Mails bleiben ohne Signal (persönlich, Newsletter, russisch, IDN)', () => {
    expect(computeMailSignals(base)).toMatchObject({ codes: [], phishingScore: 0, spamScore: 0 })
    expect(
      codes({
        fromName: 'Heise Newsletter',
        fromAddr: 'newsletter@heise.de',
        subject: 'Die Woche bei heise',
        html: '<div style="display:none">&zwnj; &zwnj; &zwnj; &zwnj;</div><p>Neue Artikel diese Woche über Rust, Datenbanken und Sicherheit. <a href="https://www.heise.de/a">heise.de/a</a></p>',
        text: 'Neue Artikel diese Woche über Rust, Datenbanken und Sicherheit.'
      })
    ).toEqual([])
    expect(
      codes({
        fromName: 'Иван Петров',
        fromAddr: 'ivan@yandex.ru',
        subject: 'Встреча в понедельник',
        text: 'Привет! Давай встретимся в понедельник в 10 утра.'
      })
    ).toEqual([])
  })

  it('Homoglyph-Absenderdomain (kyrillisches а in paypal.com)', () => {
    expect(isHomoglyphHost('pаypal.com')).toBe(true)
    expect(isHomoglyphHost('xn--pypal-4ve.com')).toBe(true)
    expect(isHomoglyphHost('пример.рф')).toBe(false)
    expect(isHomoglyphHost('xn--mnchen-3ya.de')).toBe(false)
    const s = computeMailSignals({ ...base, fromName: 'PayPal', fromAddr: 'service@pаypal.com' })
    expect(s.codes).toContain('homoglyph_sender')
    expect(s.phishingScore).toBeGreaterThanOrEqual(HEURISTIC_PHISHING_SUSPICIOUS)
  })

  it('Lookalike-Domains nur bei echter Verschleierung', () => {
    expect(lookalikeBrand('paypa1.com')).toBe('paypal')
    expect(lookalikeBrand('secure-rnicrosoft.net')).toBe('microsoft')
    expect(lookalikeBrand('paypal-community.com')).toBeNull()
    expect(lookalikeBrand('paypal.com')).toBeNull()
    expect(lookalikeBrand('g00gle.de')).toBe('google')
    expect(codes({ fromAddr: 'service@paypa1.com' })).toContain('lookalike_sender')
  })

  it('Marke im Namen, Freemail als Absender', () => {
    expect(
      codes({ fromName: 'Sparkasse Kundenservice', fromAddr: 'sk.service@gmail.com' })
    ).toContain('brand_freemail')
    // Google legitimately sends from gmail.com-like addresses – no warning
    expect(codes({ fromName: 'Gmail Team', fromAddr: 'team@gmail.com' })).not.toContain(
      'brand_freemail'
    )
  })

  it('Schriftmischung und unsichtbare Zeichen im Betreff', () => {
    expect(codes({ subject: 'Ihr Kоnto wurde gesperrt' })).toContain('mixed_script:1')
    expect(codes({ subject: 'Rech​nung offen' })).toContain('invisible_chars')
    expect(codes({ text: 'V​i​a​gra' })).toContain('invisible_chars')
  })

  it('Links: @-Trick, Skript-URL, Kürzer, Homoglyph-Ziel, Lookalike-Ziel, IP', () => {
    const c = codes({
      html: [
        '<a href="https://paypal.com@evil.example/login">Login</a>',
        '<a href="javascript:alert(1)">x</a>',
        '<a href="https://bit.ly/abc">mehr</a>',
        '<a href="https://xn--pple-43d.com/">Apple</a>',
        '<a href="https://amaz0n-support.com/">Konto</a>',
        '<a href="http://192.168.1.10/a">hier</a>'
      ].join('')
    })
    expect(c).toEqual(
      expect.arrayContaining([
        'userinfo_link:1',
        'script_link:1',
        'shortener_link:1',
        'homoglyph_link:1',
        'lookalike_link:1',
        'ip_link:1'
      ])
    )
  })

  it('Links in reinen Text-Mails werden ebenfalls geprüft', () => {
    expect(codes({ text: 'Bitte hier einloggen: http://10.0.0.1/login' })).toContain('ip_link:1')
  })

  it('Formular, Druck-Formulierungen und gefährliche Anhänge', () => {
    const s = computeMailSignals({
      ...base,
      subject: 'Ihr Konto wurde gesperrt',
      text: 'Bestätigen Sie Ihre Daten innerhalb von 24 Stunden.',
      html: '<p>Bestätigen Sie Ihre Daten.</p><form action="x"><input type="password"></form><a href="https://x.example">Login</a>',
      attachments: [
        { filename: 'rechnung.pdf.exe', mimeType: 'application/octet-stream' },
        { filename: 'login.html', mimeType: 'text/html' },
        { filename: 'angebot.docm', mimeType: null },
        { filename: 'scan‮fdp.js', mimeType: null }
      ]
    })
    expect(s.codes).toEqual(
      expect.arrayContaining([
        'credential_form',
        'urgency_language',
        'dangerous_attachment:2',
        'html_attachment:1',
        'macro_attachment:1',
        'double_extension:1',
        'bidi_control'
      ])
    )
    expect(phishingLevel(null, s.phishingScore)).toBe('high')
  })

  it('Authentifizierung und Server-Spam-Markierung', () => {
    const fail = { spf: 'pass', dkim: 'pass', dmarc: 'fail' } as const
    expect(codes({ auth: fail })).toEqual(['dmarc_fail'])
    expect(codes({ auth: { spf: 'softfail', dkim: 'none', dmarc: 'none' } })).toEqual(['auth_fail'])
    expect(codes({ auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass' } })).toEqual([])
    const flagged = computeMailSignals({ ...base, serverSpamFlag: true })
    expect(flagged.codes).toEqual(['server_spam'])
    expect(spamLevel(null, flagged.spamScore)).toBe('suspicious')
  })

  it('Spam-Muster: Formulierungen, Großbuchstaben, Bild-Mail; bekannter Kontakt dämpft', () => {
    const spam: Partial<MailSignalInput> = {
      subject: 'GEWINNEN SIE JETZT!!!',
      text: 'Sie haben gewonnen! Casino Jackpot, 100% kostenlos. Jetzt handeln!',
      html: '<img src="https://x/a.png">'
    }
    const s = computeMailSignals({ ...base, ...spam })
    expect(s.codes).toEqual(expect.arrayContaining(['shouting_subject']))
    expect(s.codes.some((c) => c.startsWith('spam_phrases:'))).toBe(true)
    expect(s.spamScore).toBeGreaterThanOrEqual(HEURISTIC_SPAM_SUSPICIOUS)
    const known = computeMailSignals({ ...base, ...spam, knownSender: true })
    expect(known.spamScore).toBe(s.spamScore - 2)
    expect(
      computeMailSignals({
        ...base,
        html: '<img src="a.png">',
        text: ''
      }).codes
    ).toEqual(['image_only'])
  })
})

describe('request and impersonation signals', () => {
  it('brand in the display name from a domain that is not the brand', () => {
    expect(codes({ fromName: 'DHL Express', fromAddr: 'info@dhl-zustellung.example' })).toContain(
      'brand_other_domain'
    )
    // Official domains and subdomains stay quiet
    expect(codes({ fromName: 'DHL Paket', fromAddr: 'noreply@dhl.de' })).toEqual([])
    expect(codes({ fromName: 'PayPal', fromAddr: 'service@mail.paypal.com' })).toEqual([])
    // Freemail is covered by brand_freemail, look-alikes by their own signal
    expect(codes({ fromName: 'Sparkasse', fromAddr: 'sk@gmail.com' })).not.toContain(
      'brand_other_domain'
    )
    expect(codes({ fromName: 'PayPal', fromAddr: 'service@paypa1.com' })).not.toContain(
      'brand_other_domain'
    )
  })

  it('executive title from a free email address', () => {
    expect(codes({ fromName: 'Thomas Berg (CEO)', fromAddr: 'tberg@gmail.com' })).toContain(
      'executive_freemail'
    )
    expect(codes({ fromName: 'Geschäftsführerin Maria Klein', fromAddr: 'mk@web.de' })).toContain(
      'executive_freemail'
    )
    expect(codes({ fromName: 'Thomas Berg (CEO)', fromAddr: 'thomas.berg@firma.de' })).toEqual([])
  })

  it('confidential payment requests', () => {
    expect(
      codes({
        text: 'Ich brauche heute noch eine Überweisung an einen neuen Lieferanten. Bitte vertraulich behandeln.'
      })
    ).toContain('confidential_payment')
    expect(
      codes({ text: 'Please keep this confidential: we need a wire transfer to the new supplier.' })
    ).toContain('confidential_payment')
    // Confidential, but no payment (e.g. HR) – and a payment that is not secret
    expect(codes({ text: 'Vertraulich: die Bewerbungsunterlagen für die Stelle.' })).toEqual([])
    expect(codes({ text: 'Die Zahlung ist eingegangen, vielen Dank.' })).toEqual([])
  })

  it('requests for bank details, credentials or a fee, but not invoices', () => {
    for (const text of [
      'Senden Sie uns Ihre Bankdaten, um den Gewinn zu erhalten.',
      'Zahlen Sie die Zollgebühr von 1,99 € hier.',
      'Please send us your bank details to receive the refund.',
      'Pay the customs fee of 2.99 EUR to release your parcel.',
      'Enter your password to keep your mailbox.'
    ]) {
      expect(codes({ text }), text).toContain('sensitive_request')
    }
    for (const text of [
      'Rechnung 2024-117: Bitte überweisen Sie den Betrag auf unsere Bankverbindung IBAN DE12 3456.',
      'Ihre Bankverbindung wurde erfolgreich geändert.',
      'Your password was changed. If this was you, no action is needed.',
      'Bitte zahlen Sie den Betrag bis zum 15. Oktober.'
    ]) {
      expect(codes({ text }), text).toEqual([])
    }
  })
})

describe('brand, freemail and shortener lists', () => {
  it('cover regional banks, carriers, tax authorities and services', () => {
    expect(lookalikeBrand('v0lksbank-login.com')).toBe('volksbank')
    expect(lookalikeBrand('e1ster.de')).toBe('elster')
    expect(
      codes({ fromName: 'DPD Paketservice', fromAddr: 'info@dpd-zustellung.example' })
    ).toContain('brand_other_domain')
    expect(
      codes({ fromName: 'Volksbank', fromAddr: 'service@volksbank-online.example' })
    ).toContain('brand_other_domain')
    expect(codes({ fromName: 'ELSTER', fromAddr: 'noreply@elster.de' })).toEqual([])
    expect(codes({ fromName: 'Hermes', fromAddr: 'info@myhermes.de' })).toEqual([])
    expect(codes({ fromName: 'Klarna Support', fromAddr: 'klarna.help@posteo.de' })).toContain(
      'brand_freemail'
    )
    expect(codes({ text: 'Details: https://clck.ru/abc' })).toContain('shortener_link:1')
  })
})

describe('organisation brands and trusted domains', () => {
  afterEach(() => __setOrgConfigForTest(undefined))

  it('protects the company name like a built-in brand', () => {
    __setOrgConfigForTest({ security: { brands: { acme: ['acme.com', 'acme-mail.net'] } } })
    expect(codes({ fromName: 'ACME IT-Support', fromAddr: 'it@acme-helpdesk.example' })).toContain(
      'brand_other_domain'
    )
    expect(codes({ fromName: 'ACME IT-Support', fromAddr: 'it@acme-mail.net' })).toEqual([])
    expect(lookalikeBrand('acrne.com')).toBe('acme')
    // Built-in brands stay
    expect(lookalikeBrand('paypa1.com')).toBe('paypal')
  })

  it('never flags trusted senders or link targets', () => {
    const phishy = {
      fromName: 'Microsoft 365 Portal',
      fromAddr: 'noreply@portal.partner-tools.example',
      replyToJson: JSON.stringify([{ address: 'help@desk.partner-tools.example' }]),
      html: '<a href="https://go.partner-tools.example/x">https://login.microsoftonline.com</a> <a href="https://bit.ly/x">x</a>'
    }
    expect(codes(phishy)).toEqual(
      expect.arrayContaining(['brand_other_domain', 'link_mismatch:1', 'shortener_link:1'])
    )
    __setOrgConfigForTest({ security: { trustedDomains: ['partner-tools.example'] } })
    // Only the untrusted shortener remains
    expect(codes(phishy)).toEqual(['shortener_link:1'])
  })
})

describe('Stufen aus Modell + Regeln', () => {
  it('Modell allein, Modell mit Bestätigung, Regeln allein', () => {
    expect(phishingLevel(1.5, 0)).toBe('high')
    expect(phishingLevel(1.0, 0)).toBe('suspicious')
    expect(phishingLevel(1.0, HEURISTIC_PHISHING_SUSPICIOUS)).toBe('high')
    expect(phishingLevel(0.2, 1)).toBe('none')
    expect(phishingLevel(0.1, HEURISTIC_PHISHING_HIGH)).toBe('high')
    expect(phishingLevel(null, HEURISTIC_PHISHING_SUSPICIOUS)).toBe('suspicious')
    expect(phishingLevel(null, 0)).toBe('none')
    expect(spamLevel(1.4, 0)).toBe('high')
    expect(spamLevel(null, 2)).toBe('none')
  })
})
