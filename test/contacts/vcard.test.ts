import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  parseVCard,
  parseVCards,
  stripBinaryProperties
} from '@main/contacts/vcard'

const crlf = (lines: string[]): string => lines.join('\r\n') + '\r\n'

describe('vCard-Parser', () => {
  it('Nextcloud 3.0: Name, Organisation, E-Mail mit TYPE/PREF, Telefon', () => {
    const card = parseVCard(
      crlf([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'PRODID:-//Sabre//Sabre VObject 4.5.0//EN',
        'UID:3b7e1c2a-0001',
        'FN:Anna Beispiel',
        'N:Beispiel;Anna;;;',
        'ORG:Beispiel GmbH;Vertrieb',
        'EMAIL;TYPE=WORK,pref:Anna@Beispiel.de',
        'EMAIL;TYPE=HOME:anna.privat@web.de',
        'TEL;TYPE=CELL:+49 170 1234567',
        'END:VCARD'
      ])
    )!
    expect(card.version).toBe('3.0')
    expect(card.uid).toBe('3b7e1c2a-0001')
    expect(card.fullName).toBe('Anna Beispiel')
    expect(card.givenName).toBe('Anna')
    expect(card.familyName).toBe('Beispiel')
    expect(card.org).toBe('Beispiel GmbH')
    expect(card.emails).toEqual([
      { value: 'anna@beispiel.de', type: 'work', pref: true },
      { value: 'anna.privat@web.de', type: 'home', pref: false }
    ])
    expect(card.phones).toEqual([{ value: '+49 170 1234567', type: 'cell', pref: false }])
  })

  it('Apple 3.0 mit item-Gruppen und Foto', () => {
    const photo = 'A'.repeat(300)
    const text = crlf([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Muster;Max;;;',
      'FN:Max Muster',
      'item1.EMAIL;type=INTERNET;type=pref:max@muster.example',
      'item1.X-ABLabel:_$!<Other>!$_',
      'item2.EMAIL;type=INTERNET:max2@muster.example',
      'PHOTO;ENCODING=b;TYPE=JPEG:' + photo,
      'END:VCARD'
    ])
    const card = parseVCard(text)!
    expect(card.emails.map((e) => e.value)).toEqual(['max@muster.example', 'max2@muster.example'])
    expect(card.emails[0].pref).toBe(true)
    expect(card.emails[0].type).toBeNull()
    expect(stripBinaryProperties(text)).not.toContain('PHOTO')
    expect(stripBinaryProperties(text)).not.toContain('AAAA')
  })

  it('4.0: PREF=1, mailto:-Telefon-URIs, ORG als Fallback für den Namen', () => {
    const card = parseVCard(
      crlf([
        'BEGIN:VCARD',
        'VERSION:4.0',
        'UID:urn:uuid:abc-123',
        'ORG:Firma AG',
        'EMAIL;PREF=1;TYPE=work:info@firma.example',
        'EMAIL;PREF=2:sales@firma.example',
        'TEL;VALUE=uri;TYPE="voice,work":tel:+41-44-555-00-00',
        'PHOTO:https://tracker.example/pixel.png',
        'END:VCARD'
      ])
    )!
    expect(card.uid).toBe('abc-123')
    expect(card.fullName).toBe('Firma AG')
    expect(card.emails).toEqual([
      { value: 'info@firma.example', type: 'work', pref: true },
      { value: 'sales@firma.example', type: null, pref: false }
    ])
    expect(card.phones[0]).toEqual({ value: '+41-44-555-00-00', type: 'work', pref: false })
  })

  it('entfaltet gefaltete Zeilen (auch mitten in Mehrbyte-Text und Adresse)', () => {
    const card = parseVCard(
      'BEGIN:VCARD\nVERSION:3.0\nFN:Sehr Lang\n er Name Mit Faltung\nEMAIL:lang\n er@bei\n spiel.example\nEND:VCARD\n'
    )!
    expect(card.fullName).toBe('Sehr Langer Name Mit Faltung')
    expect(card.emails[0].value).toBe('langer@beispiel.example')
  })

  it('löst maskierte Kommas, Semikolons, Backslashes und Zeilenumbrüche auf', () => {
    const card = parseVCard(
      crlf([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Meier\\, Hans\\; Dr.',
        'N:Meier\\;Schmidt;Hans\\,Peter;;;',
        'ORG:Müller \\& Söhne\\; Co.;Abteilung',
        'END:VCARD'
      ])
    )!
    expect(card.fullName).toBe('Meier, Hans; Dr.')
    expect(card.familyName).toBe('Meier;Schmidt')
    expect(card.givenName).toBe('Hans,Peter')
    expect(card.org).toBe('Müller & Söhne; Co.')
  })

  it('ohne FN: Name aus N zusammengesetzt, sonst Adresse', () => {
    expect(parseVCard('BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane;;Dr.;\nEND:VCARD')!.fullName).toBe(
      'Dr. Jane Doe'
    )
    expect(parseVCard('BEGIN:VCARD\nVERSION:3.0\nEMAIL:x@y.example\nEND:VCARD')!.fullName).toBe(
      'x@y.example'
    )
  })

  it('2.1 legacy: nackte TYPE-Token und Quoted-Printable mit Soft-Break', () => {
    const card = parseVCard(
      'BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:J=C3=BCrgen =\nM=C3=BCller\nEMAIL;INTERNET;WORK;PREF:jm@example.org\nEND:VCARD'
    )!
    expect(card.fullName).toBe('Jürgen Müller')
    expect(card.emails[0]).toEqual({ value: 'jm@example.org', type: 'work', pref: true })
  })

  it('ungültige Adressen und Karten ohne Inhalt werden verworfen; mehrere Karten pro Text', () => {
    const cards = parseVCards(
      crlf([
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:A',
        'EMAIL:kein-at-zeichen',
        'EMAIL:a@a.example',
        'END:VCARD',
        'BEGIN:VCARD',
        'VERSION:3.0',
        'NOTE:nur eine Notiz',
        'END:VCARD',
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:B',
        'END:VCARD'
      ])
    )
    expect(cards.map((c) => c.fullName)).toEqual(['A', 'B'])
    expect(cards[0].emails).toHaveLength(1)
    expect(parseVCard('kein vcard')).toBeNull()
  })

  it('begrenzt die Anzahl der Werte', () => {
    const emails = Array.from({ length: 50 }, (_, i) => `EMAIL:u${i}@x.example`)
    const card = parseVCard(crlf(['BEGIN:VCARD', 'FN:Viele', ...emails, 'END:VCARD']))!
    expect(card.emails).toHaveLength(20)
  })

  it('normalizeEmail', () => {
    expect(normalizeEmail('mailto:A@B.de')).toBe('a@b.de')
    expect(normalizeEmail('Anna <Anna@B.de>')).toBe('anna@b.de')
    expect(normalizeEmail('nope')).toBeNull()
  })
})
