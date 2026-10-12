import { describe, it, expect } from 'vitest'
import {
  recipientPlacement,
  salutationTarget,
  namesMatchOwner,
  taskAddresseeVerdict
} from '@main/ai/addressee'

const list = (...addrs: string[]): string =>
  JSON.stringify(addrs.map((address) => ({ name: null, address })))

describe('recipientPlacement (Stufe 1 — Envelope)', () => {
  it("'to', wenn die Konto-Adresse im An steht (case-insensitiv)", () => {
    expect(recipientPlacement('tim@volt.org', list('TIM@VOLT.ORG'), '[]')).toBe('to')
    expect(recipientPlacement('tim@volt.org', list('a@b.c', 'tim@volt.org'), null)).toBe('to')
  })

  it("'to' schlägt CC: Adresse in beiden ⇒ 'to'", () => {
    expect(recipientPlacement('tim@volt.org', list('tim@volt.org'), list('tim@volt.org'))).toBe(
      'to'
    )
  })

  it("'cc', wenn die Adresse nur im CC steht", () => {
    expect(
      recipientPlacement('lena@example.eu', list('finanzen@example.eu'), list('Lena@Example.eu'))
    ).toBe('cc')
  })

  it("'absent' bei Verteiler-/Bcc-Zustellung (weder An noch CC)", () => {
    expect(recipientPlacement('tim@volt.org', list('liste@volt.org'), '[]')).toBe('absent')
    expect(recipientPlacement('tim@volt.org', list('liste@volt.org'), null)).toBe('absent')
    expect(recipientPlacement('tim@volt.org', '[]', null)).toBe('absent')
  })

  it('neutral (to) ohne Konto-Adresse oder ohne verwertbare Envelope-Daten', () => {
    expect(recipientPlacement(null, list('a@b.c'), null)).toBe('to')
    expect(recipientPlacement('', list('a@b.c'), null)).toBe('to')
    expect(recipientPlacement('tim@volt.org', null, null)).toBe('to')
    expect(recipientPlacement('tim@volt.org', 'kein json', 'auch nicht')).toBe('to')
  })
})

describe('salutationTarget (Stufe 2 — Anrede)', () => {
  it('erkennt einen einzelnen Namen („Hallo Jannik")', () => {
    expect(salutationTarget('Hallo Jannik,\nanbei die Plakate.')).toEqual({
      kind: 'named',
      names: ['Jannik']
    })
  })

  it('erkennt mehrere Namen mit und/Komma', () => {
    expect(salutationTarget('Hallo Jonas und Anna,\nwie besprochen.')).toEqual({
      kind: 'named',
      names: ['Jonas', 'Anna']
    })
    expect(salutationTarget('Liebe Marie, lieber Tom,\nhier der Plan.')).toEqual({
      kind: 'named',
      names: ['Marie', 'Tom']
    })
  })

  it('erkennt Umlaute, Bindestrich- und Doppelnamen', () => {
    expect(salutationTarget('Hallo Jörg,')).toEqual({ kind: 'named', names: ['Jörg'] })
    expect(salutationTarget('Liebe Ann-Kathrin,')).toEqual({
      kind: 'named',
      names: ['Ann-Kathrin']
    })
    expect(salutationTarget('Guten Tag Lena Hartmann,')).toEqual({
      kind: 'named',
      names: ['Lena Hartmann']
    })
  })

  it('entfernt Titel („Sehr geehrte Frau Dr. Hartmann")', () => {
    expect(salutationTarget('Sehr geehrte Frau Dr. Hartmann,\n…')).toEqual({
      kind: 'named',
      names: ['Hartmann']
    })
    expect(salutationTarget('Sehr geehrte Frau Müller-Lüdenscheidt,')).toEqual({
      kind: 'named',
      names: ['Müller-Lüdenscheidt']
    })
  })

  it('Gruppenanreden ⇒ group', () => {
    for (const line of [
      'Hallo zusammen,',
      'Hallo Zusammen!',
      'Hi alle,',
      'Moin allerseits,',
      'Hallo Team,',
      'Hallo alle miteinander,',
      'Hey everyone,',
      'Dear all,',
      'Sehr geehrte Damen und Herren,',
      'Liebe Kolleginnen und Kollegen,',
      'Guten Morgen zusammen'
    ]) {
      expect(salutationTarget(line).kind, line).toBe('group')
    }
  })

  it('keine oder unbrauchbare Anrede ⇒ none', () => {
    expect(salutationTarget('anbei der Bericht zum Quartal.')).toEqual({ kind: 'none' })
    expect(salutationTarget('Hallo,\nkurze Frage:')).toEqual({ kind: 'none' })
    expect(salutationTarget('')).toEqual({ kind: 'none' })
    expect(salutationTarget(null)).toEqual({ kind: 'none' })
    // Kleingeschriebenes nach dem Gruß ist kein Name — lieber neutral
    expect(salutationTarget('Hallo erstmal vielen Dank für alles')).toEqual({ kind: 'none' })
  })

  it('Namen enden am Satzbeginn („Hallo Jannik, anbei die Infos")', () => {
    expect(salutationTarget('Hallo Jannik, anbei die Infos zum Sponsor.')).toEqual({
      kind: 'named',
      names: ['Jannik']
    })
  })

  it('zitierte Zeilen zählen nicht — erste eigene Zeile entscheidet', () => {
    expect(salutationTarget('> Hallo Jonas,\n> alte Nachricht\nHallo Marie,\ndanke dir!')).toEqual({
      kind: 'named',
      names: ['Marie']
    })
  })
})

describe('namesMatchOwner (Stufe 2b — Inhaber-Abgleich)', () => {
  it('matcht gegen display_name (Vorname reicht)', () => {
    expect(namesMatchOwner(['Lena'], { displayName: 'Lena Hartmann' })).toBe(true)
    expect(namesMatchOwner(['Jannik'], { displayName: 'Lena Hartmann' })).toBe(false)
  })

  it('matcht gegen den Local-Part der Adresse (lena.hartmann → lena, hartmann)', () => {
    expect(namesMatchOwner(['Lena'], { email: 'lena.hartmann@example.org' })).toBe(true)
    expect(namesMatchOwner(['Hartmann'], { email: 'lena.hartmann@example.org' })).toBe(true)
    expect(namesMatchOwner(['Hartmann'], { email: 'lena.hartmann12@example.org' })).toBe(true)
    expect(namesMatchOwner(['Marie'], { email: 'lena.hartmann@example.org' })).toBe(false)
  })

  it('matcht gegen account_name', () => {
    expect(namesMatchOwner(['Lena'], { accountName: 'Lena Privat' })).toBe(true)
  })

  it('case- und diakritik-tolerant (Jörg/joerg? nein — jorg; Groß→gross)', () => {
    expect(namesMatchOwner(['JÖRG'], { displayName: 'Jörg Groß' })).toBe(true)
    expect(namesMatchOwner(['Jorg'], { displayName: 'Jörg Groß' })).toBe(true)
    expect(namesMatchOwner(['Gross'], { displayName: 'Jörg Groß' })).toBe(true)
  })

  it('Bindestrich-Namen matchen über Teil-Tokens', () => {
    expect(namesMatchOwner(['Ann-Kathrin'], { displayName: 'Ann-Kathrin Meyer' })).toBe(true)
    expect(namesMatchOwner(['Kathrin'], { displayName: 'Ann-Kathrin Meyer' })).toBe(true)
  })

  it('false ohne Inhaber-Daten', () => {
    expect(namesMatchOwner(['Lena'], {})).toBe(false)
  })
})

describe('taskAddresseeVerdict (Gesamtpolitik)', () => {
  const owner = {
    accountEmail: 'lena.hartmann@example.org',
    displayName: 'Lena Hartmann',
    accountName: 'Hotmail'
  }

  it('Akzeptanzfall (Tims Screenshot): Verteiler + „Hallo Jannik" ⇒ none', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('verteiler@verein.de'),
        ccJson: '[]',
        bodyText: 'Hallo Jannik,\n\nanbei die Infos zu Plakaten und Sponsoren.',
        addressedToMe: true // selbst wenn das Modell irrt, greift Stufe 1+2
      })
    ).toBe('none')
  })

  it('„Hallo Lena" via Verteiler ⇒ create (Inhaber-Anrede überstimmt absent)', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('verteiler@verein.de'),
        ccJson: '[]',
        bodyText: 'Hallo Lena,\n\nkannst du die Plakate abholen?'
      })
    ).toBe('create')
  })

  it('fremde Anrede schlägt auch die An-Platzierung ⇒ none', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('lena.hartmann@example.org'),
        ccJson: '[]',
        bodyText: 'Hallo Jannik,\n\nbitte kümmere dich um die Plakate.'
      })
    ).toBe('none')
  })

  it('„Hallo zusammen" im An ⇒ create; via Verteiler ⇒ none', () => {
    const body = 'Hallo zusammen,\n\nbitte bis Freitag zurückmelden.'
    expect(
      taskAddresseeVerdict({ ...owner, toJson: list('lena.hartmann@example.org'), bodyText: body })
    ).toBe('create')
    expect(
      taskAddresseeVerdict({ ...owner, toJson: list('verteiler@verein.de'), bodyText: body })
    ).toBe('none')
  })

  it('CC-only bleibt ausgeschlossen (wie bisher) ⇒ none', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('finanzen@volt.org'),
        ccJson: list('lena.hartmann@example.org'),
        bodyText: 'Bitte um kurzfristige Freigabe.'
      })
    ).toBe('none')
  })

  it('1:1-Mail ohne Anrede im An ⇒ create', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('lena.hartmann@example.org'),
        ccJson: '[]',
        bodyText: 'kannst du mir bis morgen die Zahlen schicken?'
      })
    ).toBe('create')
  })

  it('mehrere Anrede-Namen inklusive Inhaber ⇒ create', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('verteiler@verein.de'),
        bodyText: 'Hallo Marie und Lena,\n\nbitte übernehmt ihr die Plakate?'
      })
    ).toBe('create')
  })

  it('addressed_to_me=false im An + neutrale Anrede ⇒ nur Vorschlag (suggest)', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('lena.hartmann@example.org'),
        bodyText: 'Hallo zusammen,\n\nJannik übernimmt die Plakate.',
        addressedToMe: false
      })
    ).toBe('suggest')
  })

  it('addressed_to_me=false ohne An-Platzierung ⇒ none', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('verteiler@verein.de'),
        bodyText: 'Hallo zusammen,\n\nJannik übernimmt die Plakate.',
        addressedToMe: false
      })
    ).toBe('none')
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('a@b.c'),
        ccJson: list('lena.hartmann@example.org'),
        bodyText: 'ohne Anrede',
        addressedToMe: false
      })
    ).toBe('none')
  })

  it('Inhaber-Anrede überstimmt auch addressed_to_me=false ⇒ create', () => {
    expect(
      taskAddresseeVerdict({
        ...owner,
        toJson: list('verteiler@verein.de'),
        bodyText: 'Hallo Lena,\n\nübernimmst du das?',
        addressedToMe: false
      })
    ).toBe('create')
  })

  it('ohne Envelope- und Anrede-Daten neutral ⇒ create (Alt-Verhalten)', () => {
    expect(taskAddresseeVerdict({})).toBe('create')
    expect(taskAddresseeVerdict({ accountEmail: 'lena.hartmann@example.org' })).toBe('create')
  })
})
