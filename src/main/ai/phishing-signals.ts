import { linkHostMismatch } from '@shared/link-check'

// Billige lokale Phishing-Signale. Sie gehen als Kontext in den `state` der
// Entscheidungsfrage (das Modell urteilt mit), sind für sich genommen aber kein
// Urteil und lösen nichts aus.

export type PhishingSignalCode =
  'display_name_domain' | 'reply_to_differs' | 'link_mismatch' | 'ip_link' | 'punycode_link'

export interface PhishingSignals {
  /** maschinenlesbar, z. B. "link_mismatch:2" – wird in ai_decisions gespeichert */
  codes: string[]
  /** deutsche Zeilen für den state-Text des Entscheidungsmodells */
  lines: string[]
}

export interface PhishingSignalInput {
  fromName: string | null
  fromAddr: string | null
  /** JSON-Array [{name, address}] aus messages.reply_to */
  replyToJson: string | null
  html: string | null
}

/** Grobe „registrierbare Domain": letzte zwei Labels (co.uk & Co. bewusst nicht gepflegt). */
function baseDomain(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean)
  const last = parts.slice(-2).join('.')
  // eine Handvoll gängiger Zwei-Label-TLDs, sonst gäbe es Fehlalarme bei *.co.uk
  if (/^(?:co|com|org|net|ac|gov)\.[a-z]{2}$/.test(last) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return last
}

function domainOfAddr(addr: string | null | undefined): string | null {
  const at = (addr ?? '').lastIndexOf('@')
  if (at < 0) return null
  const d = (addr ?? '')
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return d || null
}

function sameDomain(a: string, b: string): boolean {
  return baseDomain(a) === baseDomain(b)
}

const DOMAIN_IN_NAME = /(?:[a-z0-9][a-z0-9-]*\.)+(?:[a-z]{2,})\b/gi

/** href/Linktext-Paare aus HTML (regex, kein DOM im Main-Prozess). */
export function extractLinks(html: string): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  const re = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 300) {
    const href = (m[1] ?? m[2] ?? '').trim()
    const text = m[3]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({ text, href })
  }
  return out
}

export function computePhishingSignals(input: PhishingSignalInput): PhishingSignals {
  const codes: string[] = []
  const lines: string[] = []
  const fromDomain = domainOfAddr(input.fromAddr)

  // 1. Domain/Adresse im Anzeigenamen weicht von der echten Absenderdomain ab
  if (fromDomain && input.fromName) {
    const found = input.fromName.match(DOMAIN_IN_NAME) ?? []
    const other = found.map((d) => d.toLowerCase()).find((d) => !sameDomain(d, fromDomain))
    if (other) {
      codes.push('display_name_domain')
      lines.push(
        `Der Anzeigename nennt „${other}“, die echte Absenderadresse gehört aber zu ${fromDomain}`
      )
    }
  }

  // 2. Reply-To zeigt auf eine andere Domain
  if (fromDomain && input.replyToJson) {
    try {
      const list = JSON.parse(input.replyToJson) as Array<{ address?: string }>
      const other = list
        .map((r) => domainOfAddr(r.address))
        .find((d): d is string => !!d && !sameDomain(d, fromDomain))
      if (other) {
        codes.push('reply_to_differs')
        lines.push(`Antworten gehen an ${other}, der Absender ist aber ${fromDomain}`)
      }
    } catch {
      // kaputtes JSON: kein Signal
    }
  }

  // 3. Links: sichtbarer Host ≠ Ziel-Host, IP-Hosts, Punycode
  if (input.html) {
    let mismatches = 0
    let ipLinks = 0
    let puny = 0
    for (const link of extractLinks(input.html)) {
      if (linkHostMismatch(link.text, link.href)) mismatches += 1
      let host = ''
      try {
        host = new URL(link.href).hostname
      } catch {
        continue
      }
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) ipLinks += 1
      if (/(?:^|\.)xn--/.test(host)) puny += 1
    }
    if (mismatches > 0) {
      codes.push(`link_mismatch:${mismatches}`)
      lines.push(
        `${mismatches} Link${mismatches === 1 ? '' : 's'}: sichtbarer Linktext zeigt einen anderen Host als das tatsächliche Ziel`
      )
    }
    if (ipLinks > 0) {
      codes.push(`ip_link:${ipLinks}`)
      lines.push(`${ipLinks} Link${ipLinks === 1 ? '' : 's'} führen auf eine rohe IP-Adresse`)
    }
    if (puny > 0) {
      codes.push(`punycode_link:${puny}`)
      lines.push(`${puny} Link${puny === 1 ? '' : 's'} nutzen eine Punycode-Domain (xn--)`)
    }
  }
  return { codes, lines }
}
