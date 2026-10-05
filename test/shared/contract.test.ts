import { describe, it, expect } from 'vitest'
import { invokeContract, pushContract, INVOKE_CHANNELS, PUSH_CHANNELS } from '@shared/ipc-contract'

describe('ipc-contract', () => {
  it('validiert korrekte accounts:add-Payloads', () => {
    const spec = invokeContract['accounts:add']
    expect(() =>
      spec.input.parse({
        provider: 'gmail',
        accountName: 'Privat',
        email: 'a@b.de',
        password: 'x'.repeat(16)
      })
    ).not.toThrow()
  })

  it('lehnt ungültige E-Mail-Adressen ab', () => {
    const spec = invokeContract['accounts:add']
    expect(() =>
      spec.input.parse({
        provider: 'gmail',
        accountName: 'Privat',
        email: 'keine-mail',
        password: 'x'
      })
    ).toThrow()
  })

  it('validiert die Apple-Intelligence-Statusantwort (ai:appleFm)', () => {
    const spec = invokeContract['ai:appleFm']
    expect(() => spec.output.parse({ state: 'available', detail: null })).not.toThrow()
    expect(() =>
      spec.output.parse({ state: 'helper-missing', detail: 'nicht gebaut' })
    ).not.toThrow()
    expect(() => spec.output.parse({ state: 'lokal', detail: null })).toThrow()
    // Input ist optional (force default false)
    expect(() => spec.input.parse(undefined)).not.toThrow()
    expect(() => spec.input.parse({ force: true })).not.toThrow()
  })

  it('validiert den Google-Browser-Login (nur Postfachname nötig)', () => {
    const spec = invokeContract['accounts:addGoogle']
    expect(spec.input.parse({ accountName: '  Privat  ' })).toEqual({ accountName: 'Privat' })
    expect(() => spec.input.parse({ accountName: '' })).toThrow()
    expect(spec.output.parse({ accountId: 7, email: 'tim@gmail.com' })).toEqual({
      accountId: 7,
      email: 'tim@gmail.com'
    })
  })

  it('verlangt beim Verbinden einen Postfachnamen', () => {
    const spec = invokeContract['accounts:add']
    expect(() =>
      spec.input.parse({ provider: 'gmail', email: 'a@b.de', password: 'x'.repeat(16) })
    ).toThrow()
  })

  it('setzt Defaults (threads:list limit=200, mbox=inbox)', () => {
    const parsed = invokeContract['threads:list'].input.parse({})
    expect(parsed).toEqual({ limit: 200, mbox: 'inbox' })
  })

  it('validiert Entwurf-Speichern und die Entwurfs-Liste', () => {
    const save = invokeContract['drafts:save']
    expect(save.input.parse({ threadKey: 'k1', text: 'Hallo' })).toEqual({
      threadKey: 'k1',
      text: 'Hallo',
      html: ''
    })
    expect(() => save.input.parse({ threadKey: 'k1', text: '' })).toThrow()
    expect(() => save.input.parse({ threadKey: '', text: 'Hallo' })).toThrow()

    const list = invokeContract['drafts:list']
    expect(() =>
      list.output.parse({
        drafts: [
          {
            threadKey: 'k1',
            displayName: 'Alice',
            subject: null,
            text: 'Hallo',
            html: '',
            updatedAt: 1_752_576_600_000
          }
        ]
      })
    ).not.toThrow()

    expect(invokeContract['drafts:delete'].output.parse({ ok: false })).toEqual({ ok: false })
  })

  it('validiert Eingabe und vollständige Ausgabe der technischen Maildetails', () => {
    const spec = invokeContract['messages:details']
    expect(spec.input.parse({ messageId: 42 })).toEqual({ messageId: 42 })
    expect(() => spec.input.parse({ messageId: 0 })).toThrow()

    const details = {
      messageId: 42,
      technicalAvailable: true,
      from: [{ name: 'Sondernutzung', address: 'sondernutzung@stadt-oldenburg.de' }],
      sender: [],
      to: [
        { name: 'Lena Hartmann', address: 'tim@example.org' },
        { name: null, address: 'team@example.org' }
      ],
      cc: [{ name: null, address: 'cc@example.org' }],
      bcc: [],
      replyTo: [{ name: null, address: 'service@stadt-oldenburg.de' }],
      subject: 'Plakatiererlaubnis',
      sentAt: 1_752_576_600_000,
      receivedAt: 1_752_576_660_000,
      size: 84_321,
      messageIdHeader: '<permit@stadt-oldenburg.de>',
      inReplyTo: null,
      references: ['<request@example.org>'],
      returnPath: '<bounce@mailer.stadt-oldenburg.de>',
      deliveredTo: ['tim@example.org'],
      authentication: {
        spf: 'pass' as const,
        dkim: 'pass' as const,
        dmarc: 'pass' as const,
        mailedBy: 'mailer.stadt-oldenburg.de',
        signedBy: 'stadt-oldenburg.de',
        reportedBy: 'mx.example.org',
        headers: [
          {
            name: 'Authentication-Results',
            value: 'mx.example.org; spf=pass; dkim=pass; dmarc=pass'
          }
        ]
      },
      received: ['from mailer.stadt-oldenburg.de by mx.example.org'],
      spamHeaders: [],
      rawHeaders: 'From: Sondernutzung <sondernutzung@stadt-oldenburg.de>\r\n',
      rawHeadersTruncated: false
    }

    expect(spec.output.parse(details)).toEqual(details)
    expect(() =>
      spec.output.parse({
        ...details,
        authentication: { ...details.authentication, dmarc: 'verified' }
      })
    ).toThrow()
    expect(() =>
      spec.output.parse({ ...details, rawHeaders: 'x'.repeat(512 * 1024 + 1) })
    ).toThrow()
  })

  it('validiert die lokale semantische Suche samt optionalem Kontofilter', () => {
    const parsed = invokeContract['search:semantic'].input.parse({
      q: 'Wann schrieb die Stadt wegen der Plakatiererlaubnis?',
      accountId: 7
    })
    expect(parsed).toEqual({
      q: 'Wann schrieb die Stadt wegen der Plakatiererlaubnis?',
      limit: 20,
      accountId: 7
    })
  })

  it('übernimmt BCC und setzt es sonst als leere Empfängerliste', () => {
    const spec = invokeContract['compose:send']
    const base = { accountId: 1, to: ['an@example.org'], subject: 'Test', textBody: 'Hallo' }
    expect(spec.input.parse(base).bcc).toEqual([])
    expect(spec.input.parse({ ...base, bcc: ['blind@example.org'] }).bcc).toEqual([
      'blind@example.org'
    ])
  })

  it('übernimmt optional formatierten HTML-Inhalt des Composers', () => {
    const parsed = invokeContract['compose:send'].input.parse({
      accountId: 1,
      to: ['an@example.org'],
      subject: 'Formatiert',
      textBody: 'Hallo Welt',
      htmlBody: '<div>Hallo <strong>Welt</strong></div>'
    })
    expect(parsed.htmlBody).toContain('<strong>Welt</strong>')
  })

  it('validiert accounts:cancelOAuth (nur Browser-Login-Provider)', () => {
    const spec = invokeContract['accounts:cancelOAuth']
    expect(spec.input.parse({ provider: 'gmail' })).toEqual({ provider: 'gmail' })
    expect(spec.input.parse({ provider: 'microsoft' })).toEqual({ provider: 'microsoft' })
    // IMAP hat keinen Browser-Roundtrip — nichts abzubrechen
    expect(() => spec.input.parse({ provider: 'imap' })).toThrow()
    expect(spec.output.parse({ canceled: true })).toEqual({ canceled: true })
    expect(spec.output.parse({ canceled: false })).toEqual({ canceled: false })
  })

  it('validiert accounts:updatePassword / reauthorize (Längenlimit, keine Extras)', () => {
    const pw = invokeContract['accounts:updatePassword']
    expect(pw.input.parse({ accountId: 1, password: 'x' })).toEqual({ accountId: 1, password: 'x' })
    expect(() => pw.input.parse({ accountId: 1, password: '' })).toThrow()
    expect(() => pw.input.parse({ accountId: 1, password: 'x'.repeat(1001) })).toThrow()
    expect(() => pw.input.parse({ password: 'x' })).toThrow()
    const re = invokeContract['accounts:reauthorize']
    expect(re.input.parse({ accountId: 2 })).toEqual({ accountId: 2 })
    expect(() => re.input.parse({ accountId: 'a' })).toThrow()
  })

  it('sync:trigger nimmt optional ein einzelnes Konto (RETRY, Design 3b)', () => {
    const spec = invokeContract['sync:trigger']
    // Bestandsaufrufer ohne Eingabe bleiben gültig
    expect(spec.input.parse(undefined)).toBeUndefined()
    expect(spec.input.parse({})).toEqual({})
    expect(spec.input.parse({ accountId: 3 })).toEqual({ accountId: 3 })
    expect(() => spec.input.parse({ accountId: 3.5 })).toThrow()
  })

  it('accounts:list trägt errorSince für die Fehlerzeile (Default null)', () => {
    const base = {
      id: 1,
      email: 'tim@hotmail.de',
      accountName: 'Hotmail',
      displayName: null,
      provider: 'microsoft' as const,
      color: '#f0d9a8',
      syncState: 'error' as const,
      lastError: 'IMAP: connection refused (993)',
      signature: null,
      threadCount: 2,
      syncDays: null
    }
    const spec = invokeContract['accounts:list']
    expect(spec.output.parse({ accounts: [base] }).accounts[0].errorSince).toBeNull()
    expect(
      spec.output.parse({ accounts: [{ ...base, errorSince: 1_752_576_600_000 }] }).accounts[0]
        .errorSince
    ).toBe(1_752_576_600_000)
  })

  it('ai:testModel verlangt Profil und Modell-ID (beliebiges Format, z. B. llama3.2:latest)', () => {
    const spec = invokeContract['ai:testModel']
    expect(spec.input.parse({ profileId: 'openrouter', model: ' moonshotai/kimi-k2 ' })).toEqual({
      profileId: 'openrouter',
      model: 'moonshotai/kimi-k2'
    })
    expect(spec.input.parse({ profileId: 'p_ab12', model: 'llama3.2:latest' }).model).toBe(
      'llama3.2:latest'
    )
    expect(() => spec.input.parse({ model: 'moonshotai/kimi-k2' })).toThrow()
    expect(() => spec.input.parse({ profileId: 'Ungültig!', model: 'x' })).toThrow()
    expect(() => spec.input.parse({ profileId: 'openrouter', model: '' })).toThrow()
    expect(spec.output.parse({ ok: true, latencyMs: 812, costUsd: 0.0004, detail: null }).ok).toBe(
      true
    )
    expect(
      spec.output.parse({ ok: false, latencyMs: 90, costUsd: null, detail: 'HTTP 404' }).detail
    ).toBe('HTTP 404')
  })

  it('accounts:list trägt messageCount für die Mail-Zähler (Default 0)', () => {
    const base = {
      id: 1,
      email: 'tim@hotmail.de',
      accountName: 'Hotmail',
      displayName: null,
      provider: 'microsoft' as const,
      color: '#f0d9a8',
      syncState: 'syncing' as const,
      lastError: null,
      signature: null,
      threadCount: 2,
      syncDays: null
    }
    const spec = invokeContract['accounts:list']
    expect(spec.output.parse({ accounts: [base] }).accounts[0].messageCount).toBe(0)
    expect(
      spec.output.parse({ accounts: [{ ...base, messageCount: 807 }] }).accounts[0].messageCount
    ).toBe(807)
  })

  it('validiert ein sync:state-Push-Payload', () => {
    expect(() =>
      pushContract['sync:state'].parse({ accountId: 1, state: 'idle', detail: null })
    ).not.toThrow()
    expect(() =>
      pushContract['sync:state'].parse({ accountId: 1, state: 'schwebt', detail: null })
    ).toThrow()
  })

  it('validiert die Eulen-Gespräche (owl:save als Upsert, owl:list mit Gist)', () => {
    const save = invokeContract['owl:save']
    const messages = [
      {
        role: 'user' as const,
        content: 'Welche Rechnungen kamen diesen Monat?',
        at: 1_752_576_600_000
      },
      {
        role: 'assistant' as const,
        content: 'Drei — Hetzner, Adobe und ein DB-Ticket.',
        sources: [
          {
            index: 1,
            threadKey: 'k1',
            subject: 'Your Hetzner invoice for June',
            accountName: 'fernweh',
            mailbox: 'inbox' as const,
            date: 1_752_576_600_000
          }
        ]
      }
    ]
    // Upsert: ohne id neu anlegen, mit id aktualisieren
    expect(() => save.input.parse({ title: 'Welche Rechnungen?', messages })).not.toThrow()
    expect(() => save.input.parse({ id: 3, title: 'Welche Rechnungen?', messages })).not.toThrow()
    // Leere Gespräche werden nie gespeichert
    expect(() => save.input.parse({ title: 'Leer', messages: [] })).toThrow()
    expect(() => save.input.parse({ title: '  ', messages })).toThrow()
    expect(save.output.parse({ id: 7 })).toEqual({ id: 7 })

    const list = invokeContract['owl:list']
    expect(() =>
      list.output.parse({
        conversations: [
          { id: 1, title: 'Welche Rechnungen?', updatedAt: 1_752_576_600_000, answerGist: 'Drei.' },
          { id: 2, title: 'Offsite-Termine?', updatedAt: 1_752_576_500_000, answerGist: null }
        ]
      })
    ).not.toThrow()

    const get = invokeContract['owl:get']
    expect(() => get.input.parse({ id: 0 })).toThrow()
    expect(() =>
      get.output.parse({
        conversation: {
          id: 1,
          title: 'Welche Rechnungen?',
          messages,
          createdAt: 1,
          updatedAt: 2
        }
      })
    ).not.toThrow()
    expect(get.output.parse({ conversation: null })).toEqual({ conversation: null })

    expect(invokeContract['owl:delete'].output.parse({ ok: false })).toEqual({ ok: false })
  })

  it('validiert spell:check-Payloads', () => {
    const spec = invokeContract['spell:check']
    expect(() => spec.input.parse({ words: ['Haus', "geht's"] })).not.toThrow()
    expect(() => spec.input.parse({ words: [''] })).toThrow()
    expect(() => spec.input.parse({ words: 'Haus' })).toThrow()
  })

  it('settings:get/set akzeptieren nur Allowlist-Schlüssel', () => {
    const get = invokeContract['settings:get'].input
    const set = invokeContract['settings:set'].input
    for (const key of ['ui.language', 'sig.12', 'ai.styleProfile.3', 'ai.styleInstructions.7']) {
      expect(() => get.parse({ key }), key).not.toThrow()
    }
    // Stilprofile sind lesbar, aber nicht vom Renderer schreibbar
    expect(() => set.parse({ key: 'ai.styleProfile.3', value: '{}' })).toThrow()
    expect(() => set.parse({ key: 'sig.12', value: 'x' })).not.toThrow()
    for (const key of [
      'google.clientId',
      'google.clientSecret',
      'ms.clientId',
      'ai.dailyBudgetUsd',
      'images.allow.a@b.de',
      'sig.',
      'sig.0',
      'sig.01',
      'sig.1.2',
      'sig.12/../x',
      ''
    ]) {
      expect(() => get.parse({ key }), key).toThrow()
      expect(() => set.parse({ key, value: 'x' }), key).toThrow()
    }
  })

  it('secrets:set/exists akzeptieren nur openrouter.apiKey', () => {
    const set = invokeContract['secrets:set'].input
    const exists = invokeContract['secrets:exists'].input
    expect(() => set.parse({ key: 'openrouter.apiKey', value: 'k' })).not.toThrow()
    expect(() => exists.parse({ key: 'openrouter.apiKey' })).not.toThrow()
    for (const key of ['account:1:password', 'ms.tokenCache', 'google.refresh.a@b.de']) {
      expect(() => set.parse({ key, value: 'k' })).toThrow()
      expect(() => exists.parse({ key })).toThrow()
    }
  })

  it('begrenzt IDs und Thread-Keys', () => {
    const long = 'x'.repeat(513)
    expect(() => invokeContract['drafts:delete'].input.parse({ threadKey: long })).toThrow()
    expect(() =>
      invokeContract['drafts:save'].input.parse({ threadKey: long, text: 'a' })
    ).toThrow()
    expect(() =>
      invokeContract['tasks:decideSuggestion'].input.parse({ threadKey: long, accept: true })
    ).toThrow()
    expect(() =>
      invokeContract['threads:get'].input.parse({ threadKey: 'x'.repeat(512) })
    ).not.toThrow()
  })

  it('Kanal-Listen und Contract-Keys stimmen überein', () => {
    expect(INVOKE_CHANNELS.sort()).toEqual(Object.keys(invokeContract).sort())
    expect(PUSH_CHANNELS.sort()).toEqual(Object.keys(pushContract).sort())
  })
})
