import { domainToUnicode } from 'node:url'
import { linkHostMismatch } from '@shared/link-check'
import {
  countInvisibleChars,
  domainSkeleton,
  findMixedScriptWords,
  hasBidiControls,
  scriptOf,
  skeleton
} from '@shared/confusables'
import type { MailAuthenticationStatus } from '@shared/types'

// Lokale, regelbasierte Spam- und Phishing-Signale (ohne KI). Jedes Signal hat
// ein Gewicht für Phishing und für Spam; die Summen ergeben die lokalen Scores.
// Sie gehen außerdem als Kontext in den `state` des Entscheidungsmodells (das
// Modell urteilt mit) und werden in der Mail-Ansicht als Warnzeichen gezeigt.
// Alles läuft rein lokal auf Daten, die ohnehin in der Datenbank liegen.

export interface MailSignal {
  /** maschinenlesbar, ohne Zähler (z. B. "link_mismatch") */
  name: string
  count: number
  phishing: number
  spam: number
  /** deutsche Zeile für den state-Text des Entscheidungsmodells */
  line: string
}

export interface MailSignals {
  signals: MailSignal[]
  /** z. B. ["reply_to_differs", "link_mismatch:2"] – Zähler nur bei Mengen-Signalen */
  codes: string[]
  lines: string[]
  phishingScore: number
  spamScore: number
}

export interface MailSignalInput {
  fromName: string | null
  fromAddr: string | null
  /** JSON-Array [{name, address}] aus messages.reply_to */
  replyToJson: string | null
  html: string | null
  subject?: string | null
  /** Klartext der Mail (text/plain oder aus HTML gewonnen) */
  text?: string | null
  attachments?: Array<{ filename: string | null; mimeType: string | null }>
  /** Ergebnis aus Authentication-Results (nur wenn die Kopfzeilen vorliegen) */
  auth?: {
    spf: MailAuthenticationStatus
    dkim: MailAuthenticationStatus
    dmarc: MailAuthenticationStatus
  } | null
  /** Der Mailserver hat die Mail selbst als Spam markiert (X-Spam-Flag/-Status) */
  serverSpamFlag?: boolean
  /** Der Kontoinhaber hat diesem Absender schon geschrieben */
  knownSender?: boolean
}

/** Mengen-Signale tragen immer einen Zähler im Code ("ip_link:1"), Einzel-Signale nie. */
const COUNTED = new Set([
  'link_mismatch',
  'ip_link',
  'punycode_link',
  'homoglyph_link',
  'lookalike_link',
  'userinfo_link',
  'script_link',
  'shortener_link',
  'mixed_script',
  'dangerous_attachment',
  'macro_attachment',
  'html_attachment',
  'double_extension',
  'spam_phrases'
])

/** Max. Zeichen Mailtext, die die Text-Heuristiken ansehen (Kosten begrenzen). */
const MAX_TEXT_SCAN = 20_000
const MAX_HTML_SCAN = 400_000

// --- Domains -----------------------------------------------------------------------------------

/** Grobe „registrierbare Domain": letzte zwei Labels (co.uk & Co. bewusst nicht gepflegt). */
export function baseDomain(host: string): string {
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

/** Punycode (xn--) in Unicode zurückverwandeln; bei Fehlern der Eingabewert. */
function unicodeHost(host: string): string {
  try {
    return domainToUnicode(host) || host
  } catch {
    return host
  }
}

/**
 * Host, dessen Labels aus Ersatzzeichen bestehen, die wie Latein aussehen
 * („pаypal.com" mit kyrillischem а, „аррӏе.com" ganz aus Kyrillisch).
 * Rein kyrillische Domains (пример.рф, яндекс.ru) sind unauffällig.
 */
export function isHomoglyphHost(host: string): boolean {
  const decoded = unicodeHost(host.toLowerCase())
  let hasLatin = false
  let hasLookalike = false
  for (const char of decoded) {
    const script = scriptOf(char)
    if (script === 'latin') hasLatin = true
    else if (script === 'cyrillic' || script === 'greek') hasLookalike = true
  }
  if (!hasLookalike || !hasLatin) return false
  // Mindestens ein Label mit Fremdschrift wird im Skelett zu reinem ASCII:
  // es ist gebaut, um wie ein lateinisches Wort auszusehen.
  return decoded
    .split('.')
    .some((label) => /[^ -~]/.test(label) && /^[ -~]+$/.test(skeleton(label)))
}

/** Marken, die häufig gefälscht werden → ihre echten (Basis-)Domains. */
const BRANDS: Record<string, string[]> = {
  paypal: ['paypal.com', 'paypal.de', 'paypal.me'],
  apple: ['apple.com', 'icloud.com', 'me.com'],
  icloud: ['icloud.com', 'apple.com'],
  microsoft: ['microsoft.com', 'outlook.com', 'live.com', 'office.com', 'hotmail.com'],
  outlook: ['outlook.com', 'microsoft.com', 'live.com', 'office.com'],
  office365: ['office.com', 'microsoft.com', 'office365.com'],
  google: ['google.com', 'gmail.com', 'google.de', 'youtube.com'],
  gmail: ['gmail.com', 'google.com'],
  amazon: ['amazon.com', 'amazon.de', 'amazon.co.uk', 'amazon.fr', 'amazon.it', 'amazon.es'],
  netflix: ['netflix.com'],
  facebook: ['facebook.com', 'facebookmail.com', 'meta.com'],
  instagram: ['instagram.com', 'facebookmail.com', 'meta.com'],
  whatsapp: ['whatsapp.com', 'meta.com'],
  linkedin: ['linkedin.com'],
  dhl: ['dhl.com', 'dhl.de'],
  fedex: ['fedex.com'],
  docusign: ['docusign.com', 'docusign.net'],
  dropbox: ['dropbox.com', 'dropboxmail.com'],
  ebay: ['ebay.com', 'ebay.de'],
  sparkasse: ['sparkasse.de'],
  postbank: ['postbank.de'],
  commerzbank: ['commerzbank.de', 'commerzbank.com'],
  coinbase: ['coinbase.com'],
  binance: ['binance.com'],
  adobe: ['adobe.com'],
  telekom: ['telekom.de', 't-online.de'],
  vodafone: ['vodafone.de', 'vodafone.com']
}

/** Freemail-Anbieter: eine Bank/ein Dienst schreibt nie von hier. */
const FREEMAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.de',
  'icloud.com',
  'me.com',
  'aol.com',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'web.de',
  't-online.de',
  'mail.ru',
  'yandex.ru',
  'proton.me',
  'protonmail.com'
])

function isOfficial(brand: string, domain: string): boolean {
  return (BRANDS[brand] ?? []).some((d) => sameDomain(d, domain))
}

/**
 * Lookalike-Domain: ein Label wird erst durch Ziffer-/Zeichentricks zur Marke
 * („paypa1.com", „rnicrosoft-login.net", „g00gle.de"). Nur echte Verschleierung
 * zählt — „paypal-community.com" ist unverschleiert und bleibt unauffällig.
 */
export function lookalikeBrand(host: string): string | null {
  const domain = unicodeHost(host.toLowerCase())
  const base = baseDomain(domain)
  const labels = base
    .split('.')
    .slice(0, -1)
    .flatMap((label) => label.split('-'))
  for (const label of labels) {
    if (!label) continue
    const skel = domainSkeleton(label)
    if (skel === label) continue
    for (const brand of Object.keys(BRANDS)) {
      if (skel === brand && !isOfficial(brand, domain)) return brand
    }
  }
  return null
}

/** Marke im Anzeigenamen (ganzes Wort, Homoglyphen aufgelöst). */
function brandInName(name: string): string | null {
  const words: string[] = skeleton(name).match(/[a-z0-9]+/g) ?? []
  return Object.keys(BRANDS).find((brand) => words.includes(brand)) ?? null
}

const SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'rb.gy',
  'tiny.cc',
  't.ly',
  'v.gd',
  's.id',
  'shorte.st',
  'adf.ly',
  'qrco.de'
])

// --- Links -------------------------------------------------------------------------------------

/** href/Linktext-Paare aus HTML (regex, kein DOM im Main-Prozess). */
export function extractLinks(html: string): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  const re = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 300) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/&amp;/g, '&')
    const text = m[4]
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({ text, href })
  }
  return out
}

/** Nackte URLs aus Klartext (für reine Text-Mails). */
function extractTextUrls(text: string): string[] {
  return (text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? []).slice(0, 300)
}

// --- Texte -------------------------------------------------------------------------------------

const URGENCY_PHRASES = [
  /verify your (?:account|identity|email)/i,
  /confirm your (?:account|identity|details|payment)/i,
  /account (?:has been |will be |is )?(?:suspended|locked|limited|disabled|closed)/i,
  /unusual (?:sign[- ]?in )?activity/i,
  /password (?:will )?expire/i,
  /update your (?:payment|billing)/i,
  /within 24 hours/i,
  /bestätigen sie (?:ihr(?:e|en)?|jetzt) (?:konto|identität|daten|zahlung)/i,
  /(?:konto|zugang|karte) (?:wurde |wird )?(?:gesperrt|eingeschränkt|deaktiviert)/i,
  /(?:ungewöhnliche|verdächtige) (?:anmelde)?aktivität/i,
  /passwort läuft (?:bald )?ab/i,
  /(?:zahlungs|konto)(?:informationen|daten) (?:aktualisieren|bestätigen|verifizieren)/i,
  /innerhalb von (?:24|48) stunden/i,
  /letzte mahnung/i
]

const SPAM_PHRASES = [
  /\b(?:viagra|cialis|levitra)\b/i,
  /\bcasino\b/i,
  /\b(?:lottery|lotto)\b/i,
  /\byou(?:'ve| have)? won\b/i,
  /\bsie haben (?:\w+ )?gewonnen\b/i,
  /\bjackpot\b/i,
  /\b(?:bitcoin|crypto(?:currency)?|krypto)\b.{0,40}\b(?:profit|investment|invest|rendite|gewinn)/i,
  /\bmake money (?:fast|online|from home)\b/i,
  /\b100\s?% (?:free|kostenlos|gratis)\b/i,
  /\brisk[- ]free\b/i,
  /\bno credit check\b/i,
  /\b(?:hot )?singles in (?:your|ihrer) (?:area|nähe)\b/i,
  /\b(?:inheritance|erbschaft|beneficiary|begünstigter)\b/i,
  /\b\d+(?:[.,]\d+)? million (?:dollars|usd|euro)\b|\bmillionen (?:euro|dollar)\b/i,
  /\b(?:dear friend|lieber freund)\b/i,
  /\b(?:act now|jetzt handeln)\b/i,
  /\blimited[- ]time offer\b/i,
  /\b(?:weight loss|abnehmen ohne)\b/i,
  /\bwire transfer\b|\bwestern union\b|\bmoneygram\b/i
]

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((re) => re.test(text)).length
}

/** Betreff in Großbuchstaben oder mit !!!/$$$ — klassisches Spam-Muster. */
function isShoutingSubject(subject: string): boolean {
  const letters = subject.match(/\p{L}/gu) ?? []
  const upper = subject.match(/\p{Lu}/gu) ?? []
  const caps = letters.length >= 8 && upper.length / letters.length >= 0.7
  return caps || /[!?]{3,}|[$€£]{2,}/.test(subject)
}

/** Unsichtbare Zeichen auch dann finden, wenn sie als HTML-Entity im Quelltext stehen. */
function decodeInvisibleEntities(html: string): string {
  return html
    .replace(/&#8203;|&#x200b;/gi, '​')
    .replace(/&zwnj;|&#8204;|&#x200c;/gi, '‌')
    .replace(/&zwj;|&#8205;|&#x200d;/gi, '‍')
    .replace(/&#8288;|&#x2060;/gi, '⁠')
    .replace(/&#65279;|&#xfeff;/gi, '﻿')
    .replace(/<[^>]*>/g, '')
}

// --- Anhänge -----------------------------------------------------------------------------------

const DANGEROUS_EXT =
  /\.(?:exe|scr|com|pif|bat|cmd|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|jar|lnk|ps1|reg|cpl|iso|img|vhdx?|apk|xll|appx|msix)$/i
const MACRO_EXT = /\.(?:docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam)$/i
const HTML_EXT = /\.(?:html?|shtml|xhtml|svg|mht)$/i
const DOUBLE_EXT =
  /\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|rtf|zip|csv)\s*\.(?:[a-z0-9]{2,5})$/i

// --- Hauptfunktion -----------------------------------------------------------------------------

export function computeMailSignals(input: MailSignalInput): MailSignals {
  const signals: MailSignal[] = []
  const add = (name: string, count: number, phishing: number, spam: number, line: string): void => {
    signals.push({ name, count, phishing, spam, line })
  }
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

  const fromDomain = domainOfAddr(input.fromAddr)
  const fromName = input.fromName ?? ''
  const subject = input.subject ?? ''
  const html = (input.html ?? '').slice(0, MAX_HTML_SCAN)
  const text = (input.text ?? '').slice(0, MAX_TEXT_SCAN)

  // --- Absender ---
  if (fromDomain && fromName) {
    const found = fromName.match(/(?:[a-z0-9][a-z0-9-]*\.)+(?:[a-z]{2,})\b/gi) ?? []
    const other = found.map((d) => d.toLowerCase()).find((d) => !sameDomain(d, fromDomain))
    if (other) {
      add(
        'display_name_domain',
        1,
        2,
        1,
        `Der Anzeigename nennt „${other}“, die echte Absenderadresse gehört aber zu ${fromDomain}`
      )
    }
  }

  if (fromDomain && input.replyToJson) {
    try {
      const list = JSON.parse(input.replyToJson) as Array<{ address?: string }>
      const other = list
        .map((r) => domainOfAddr(r.address))
        .find((d): d is string => !!d && !sameDomain(d, fromDomain))
      if (other) {
        add(
          'reply_to_differs',
          1,
          1,
          0,
          `Antworten gehen an ${other}, der Absender ist aber ${fromDomain}`
        )
      }
    } catch {
      // kaputtes JSON: kein Signal
    }
  }

  let senderHomoglyph = false
  if (fromDomain && isHomoglyphHost(fromDomain)) {
    senderHomoglyph = true
    add(
      'homoglyph_sender',
      1,
      4,
      2,
      `Die Absenderdomain ${unicodeHost(fromDomain)} enthält Ersatzzeichen aus einem anderen Alphabet (z. B. kyrillisch), die wie lateinische Buchstaben aussehen`
    )
  }
  const senderLookalike = fromDomain && !senderHomoglyph ? lookalikeBrand(fromDomain) : null
  if (senderLookalike) {
    add(
      'lookalike_sender',
      1,
      4,
      1,
      `Die Absenderdomain ${fromDomain} imitiert „${senderLookalike}“ mit vertauschten Zeichen`
    )
  }
  const nameBrand = fromName ? brandInName(fromName) : null
  if (
    nameBrand &&
    fromDomain &&
    FREEMAIL.has(baseDomain(fromDomain)) &&
    !isOfficial(nameBrand, fromDomain)
  ) {
    add(
      'brand_freemail',
      1,
      3,
      1,
      `Der Anzeigename gibt sich als „${nameBrand}“ aus, die Mail kommt aber von einer Freemail-Adresse (${fromDomain})`
    )
  }

  // --- Authentifizierung (Kopfzeilen) ---
  if (input.auth) {
    if (input.auth.dmarc === 'fail') {
      add(
        'dmarc_fail',
        1,
        3,
        2,
        'DMARC-Prüfung fehlgeschlagen: die Absenderdomain hat die Mail nicht autorisiert'
      )
    } else if (
      input.auth.spf === 'fail' ||
      input.auth.spf === 'softfail' ||
      input.auth.dkim === 'fail'
    ) {
      add('auth_fail', 1, 1, 1, 'SPF- oder DKIM-Prüfung des Absenders fehlgeschlagen')
    }
  }
  if (input.serverSpamFlag) {
    add('server_spam', 1, 0, 4, 'Der Mailserver hat die Mail als Spam markiert')
  }

  // --- Schrift-Tricks in Betreff, Name und Text ---
  const mixed = new Set([
    ...findMixedScriptWords(`${fromName} ${subject}`),
    ...findMixedScriptWords(text, 10)
  ])
  if (mixed.size > 0) {
    add(
      'mixed_script',
      mixed.size,
      2,
      2,
      `${plural(mixed.size, 'Wort mischt', 'Wörter mischen')} lateinische mit kyrillischen/griechischen Buchstaben (Täuschung oder Filter-Umgehung)`
    )
  }
  const headerInvisible = countInvisibleChars(`${fromName}${subject}`)
  const bodyInvisible = countInvisibleChars(
    input.text ? text : decodeInvisibleEntities(html).slice(0, MAX_TEXT_SCAN),
    true
  )
  if (headerInvisible > 0 || bodyInvisible >= 2) {
    add(
      'invisible_chars',
      1,
      1,
      2,
      'Unsichtbare Zeichen (Nullbreiten-Leerzeichen) zwischen Buchstaben – typisch, um Spamfilter zu umgehen'
    )
  }
  const filenames = (input.attachments ?? []).map((a) => a.filename ?? '')
  if (hasBidiControls(`${fromName}${subject}${filenames.join('')}`)) {
    add(
      'bidi_control',
      1,
      3,
      1,
      'Steuerzeichen für die Schreibrichtung in Betreff, Name oder Dateiname (verschleiert z. B. „.exe“)'
    )
  }

  // --- Links ---
  const anchors = html ? extractLinks(html) : []
  const hrefs = anchors.length > 0 ? anchors.map((a) => a.href) : extractTextUrls(text)
  let mismatches = 0
  for (const link of anchors) if (linkHostMismatch(link.text, link.href)) mismatches += 1
  let ipLinks = 0
  let puny = 0
  let homoglyph = 0
  let lookalike = 0
  let userinfo = 0
  let script = 0
  let shortener = 0
  for (const href of hrefs) {
    if (/^\s*(?:javascript|vbscript|data):/i.test(href)) {
      script += 1
      continue
    }
    let url: URL
    try {
      url = new URL(href)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    const host = url.hostname.toLowerCase()
    if (url.username) userinfo += 1
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) ipLinks += 1
    // Homoglyph schließt Lookalike/Punycode aus – ein Link, eine Täuschung
    if (isHomoglyphHost(host)) homoglyph += 1
    else if (lookalikeBrand(host)) lookalike += 1
    else if (/(?:^|\.)xn--/.test(host)) puny += 1
    if (SHORTENERS.has(host.replace(/^www\./, ''))) shortener += 1
  }
  if (mismatches > 0) {
    add(
      'link_mismatch',
      mismatches,
      3,
      1,
      `${plural(mismatches, 'Link', 'Links')}: sichtbarer Linktext zeigt einen anderen Host als das tatsächliche Ziel`
    )
  }
  if (homoglyph > 0) {
    add(
      'homoglyph_link',
      homoglyph,
      4,
      1,
      `${plural(homoglyph, 'Link führt', 'Links führen')} auf eine Domain mit Ersatzzeichen aus einem anderen Alphabet`
    )
  }
  if (lookalike > 0) {
    add(
      'lookalike_link',
      lookalike,
      3,
      1,
      `${plural(lookalike, 'Link führt', 'Links führen')} auf eine Domain, die eine bekannte Marke mit vertauschten Zeichen imitiert`
    )
  }
  if (ipLinks > 0) {
    add(
      'ip_link',
      ipLinks,
      2,
      1,
      `${plural(ipLinks, 'Link führt', 'Links führen')} auf eine rohe IP-Adresse`
    )
  }
  if (puny > 0) {
    add(
      'punycode_link',
      puny,
      1,
      0,
      `${plural(puny, 'Link nutzt', 'Links nutzen')} eine Punycode-Domain (xn--)`
    )
  }
  if (userinfo > 0) {
    add(
      'userinfo_link',
      userinfo,
      3,
      0,
      `${plural(userinfo, 'Link versteckt', 'Links verstecken')} das echte Ziel hinter einem „@“ (https://bank.de@fremd.example)`
    )
  }
  if (script > 0) {
    add(
      'script_link',
      script,
      3,
      0,
      `${plural(script, 'Link enthält', 'Links enthalten')} Skript- oder Daten-URLs`
    )
  }
  if (shortener > 0) {
    add(
      'shortener_link',
      shortener,
      1,
      1,
      `${plural(shortener, 'Link nutzt', 'Links nutzen')} einen URL-Kürzer, der das Ziel verbirgt`
    )
  }

  // --- Formulare und Druck ---
  if (/<form\b/i.test(html) || /<input\b[^>]*type\s*=\s*["']?password/i.test(html)) {
    add(
      'credential_form',
      1,
      3,
      0,
      'Die Mail enthält ein Eingabeformular (mögliche Abfrage von Zugangsdaten)'
    )
  }
  const urgency = countMatches(`${subject}\n${text}`, URGENCY_PHRASES)
  if (urgency > 0 && hrefs.length > 0) {
    add(
      'urgency_language',
      1,
      urgency >= 2 ? 2 : 1,
      0,
      'Typische Druck-Formulierungen (Konto gesperrt, Daten bestätigen, Frist in Stunden) zusammen mit Links'
    )
  }

  // --- Anhänge ---
  let dangerous = 0
  let macro = 0
  let htmlAtt = 0
  let doubleExt = 0
  for (const name of filenames) {
    const clean = name.trim().replace(/[‎‏‪-‮⁦-⁩]/g, '')
    if (DANGEROUS_EXT.test(clean)) dangerous += 1
    else if (MACRO_EXT.test(clean)) macro += 1
    else if (HTML_EXT.test(clean)) htmlAtt += 1
    if (DOUBLE_EXT.test(clean) && (DANGEROUS_EXT.test(clean) || HTML_EXT.test(clean)))
      doubleExt += 1
  }
  if (dangerous > 0) {
    add(
      'dangerous_attachment',
      dangerous,
      3,
      1,
      `${plural(dangerous, 'Anhang ist', 'Anhänge sind')} ausführbar (Programm, Skript oder Disk-Image)`
    )
  }
  if (macro > 0) {
    add(
      'macro_attachment',
      macro,
      2,
      0,
      `${plural(macro, 'Anhang enthält', 'Anhänge enthalten')} Office-Makros`
    )
  }
  if (htmlAtt > 0) {
    add(
      'html_attachment',
      htmlAtt,
      2,
      0,
      `${plural(htmlAtt, 'Anhang ist', 'Anhänge sind')} eine HTML-/SVG-Datei (beliebter Weg für gefälschte Login-Seiten)`
    )
  }
  if (doubleExt > 0) {
    add(
      'double_extension',
      doubleExt,
      2,
      0,
      `${plural(doubleExt, 'Anhang tarnt', 'Anhänge tarnen')} sich mit doppelter Dateiendung (z. B. „rechnung.pdf.exe“)`
    )
  }

  // --- Spam-Muster ---
  const spamPhrases = countMatches(`${subject}\n${text}`, SPAM_PHRASES)
  if (spamPhrases > 0) {
    add(
      'spam_phrases',
      spamPhrases,
      0,
      Math.min(3, spamPhrases),
      `${plural(spamPhrases, 'typische Spam-Formulierung', 'typische Spam-Formulierungen')} (Gewinne, Krypto-Rendite, Erbschaft …)`
    )
  }
  if (subject && isShoutingSubject(subject)) {
    add('shouting_subject', 1, 0, 1, 'Betreff in Großbuchstaben oder mit gehäuften !!!/$$$')
  }
  if (html && /<img\b/i.test(html) && text.replace(/\s+/g, ' ').trim().length < 120) {
    add('image_only', 1, 0, 1, 'Die Mail besteht fast nur aus Bildern (Text für Filter unlesbar)')
  }
  const hidden = (
    html.match(/font-size\s*:\s*0(?:px|pt|em)?\s*[;"']|visibility\s*:\s*hidden/gi) ?? []
  ).length
  if (hidden >= 5) {
    add('hidden_text', 1, 0, 1, 'Viel versteckter Text im HTML (Filter-Umgehung)')
  }

  let phishingScore = signals.reduce((sum, s) => sum + s.phishing, 0)
  let spamScore = signals.reduce((sum, s) => sum + s.spam, 0)
  // Bekannter Kontakt: Spam ist unwahrscheinlich (Phishing über gekaperte Konten bleibt möglich)
  if (input.knownSender) spamScore = Math.max(0, spamScore - 2)
  phishingScore = Math.min(phishingScore, 20)
  spamScore = Math.min(spamScore, 20)

  return {
    signals,
    codes: signals.map((s) => (COUNTED.has(s.name) ? `${s.name}:${s.count}` : s.name)),
    lines: signals.map((s) => s.line),
    phishingScore,
    spamScore
  }
}
