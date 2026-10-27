import { domainToUnicode } from 'node:url'
import type { OrgConfig } from '@shared/org-config'
import { getOrgConfig } from '../org-config'
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

// Local, rule-based spam and phishing signals (without AI). Each signal has
// a weight for phishing and for spam; the sums yield the local scores.
// They also go as context into the decision model's `state` (the
// model weighs in) and are shown as warning signs in the mail view.
// Everything runs purely locally on data that is in the database anyway.

export interface MailSignal {
  /** machine-readable, without counter (e.g. "link_mismatch") */
  name: string
  count: number
  phishing: number
  spam: number
  /** English line for the decision model's state text */
  line: string
}

export interface MailSignals {
  signals: MailSignal[]
  /** e.g. ["reply_to_differs", "link_mismatch:2"] – counter only for count signals */
  codes: string[]
  lines: string[]
  phishingScore: number
  spamScore: number
}

export interface MailSignalInput {
  fromName: string | null
  fromAddr: string | null
  /** JSON array [{name, address}] from messages.reply_to */
  replyToJson: string | null
  html: string | null
  subject?: string | null
  /** Plain text of the mail (text/plain or derived from HTML) */
  text?: string | null
  attachments?: Array<{ filename: string | null; mimeType: string | null }>
  /** Result from Authentication-Results (only if the header lines are present) */
  auth?: {
    spf: MailAuthenticationStatus
    dkim: MailAuthenticationStatus
    dmarc: MailAuthenticationStatus
  } | null
  /** The mail server itself flagged the mail as spam (X-Spam-Flag/-Status) */
  serverSpamFlag?: boolean
  /** The account owner has written to this sender before */
  knownSender?: boolean
}

/** Count signals always carry a counter in the code ("ip_link:1"), single signals never. */
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

/** Max. characters of mail text the text heuristics look at (limits cost). */
const MAX_TEXT_SCAN = 20_000
const MAX_HTML_SCAN = 400_000

// --- Domains -----------------------------------------------------------------------------------

/** Rough "registrable domain": last two labels (co.uk & co. deliberately not maintained). */
export function baseDomain(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean)
  const last = parts.slice(-2).join('.')
  // a handful of common two-label TLDs, otherwise *.co.uk would cause false alarms
  if (/^(?:co|com|org|net|ac|gov)\.[a-z]{2}$/.test(last) && parts.length >= 3) {
    return parts.slice(-3).join('.')
  }
  return last
}

function domainOfAddr(addr: string | null | undefined): string | null {
  const at = (addr ?? '').lastIndexOf('@')
  if (at < 0) return null
  // Only the host part counts: everything from the first whitespace or
  // structuring character on is trailing garbage from a malformed address and
  // must never become "domain" text that flows into the decision model's
  // security block (prompt-injection hardening, SEC-15).
  const d = (addr ?? '')
    .slice(at + 1)
    .trim()
    .split(/[\s<>()"';\\,]/)[0]
    .toLowerCase()
  return d || null
}

function sameDomain(a: string, b: string): boolean {
  return baseDomain(a) === baseDomain(b)
}

/** Convert punycode (xn--) back to Unicode; on errors the input value. */
function unicodeHost(host: string): string {
  try {
    return domainToUnicode(host) || host
  } catch {
    return host
  }
}

/**
 * Host whose labels consist of substitute characters that look like Latin
 * ("pаypal.com" with Cyrillic а, "аррӏе.com" entirely in Cyrillic).
 * Purely Cyrillic domains (пример.рф, яндекс.ru) are inconspicuous.
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
  // At least one label in a foreign script becomes pure ASCII in the skeleton:
  // it is built to look like a Latin word.
  return decoded
    .split('.')
    .some((label) => /[^ -~]/.test(label) && /^[ -~]+$/.test(skeleton(label)))
}

/** Brands that are often spoofed → their real (base) domains. */
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
  vodafone: ['vodafone.de', 'vodafone.com'],
  // Banks and payment (DE/AT/CH and international)
  volksbank: ['volksbank.de', 'vr.de'],
  raiffeisen: ['raiffeisen.de', 'raiffeisen.at', 'raiffeisen.ch'],
  comdirect: ['comdirect.de'],
  consorsbank: ['consorsbank.de'],
  dkb: ['dkb.de'],
  targobank: ['targobank.de'],
  hypovereinsbank: ['hypovereinsbank.de', 'unicredit.de'],
  santander: ['santander.de', 'santander.com'],
  postfinance: ['postfinance.ch'],
  revolut: ['revolut.com'],
  klarna: ['klarna.com', 'klarna.de'],
  visa: ['visa.com', 'visa.de'],
  mastercard: ['mastercard.com', 'mastercard.de'],
  americanexpress: ['americanexpress.com', 'aexp.com'],
  // Parcel carriers
  dpd: ['dpd.de', 'dpd.com'],
  hermes: ['myhermes.de', 'hermesworld.com', 'hermes-europe.eu'],
  gls: ['gls-group.eu', 'gls-group.com', 'gls-pakete.de'],
  ups: ['ups.com'],
  usps: ['usps.com'],
  // Tax and government
  elster: ['elster.de'],
  irs: ['irs.gov'],
  // Services commonly imitated
  spotify: ['spotify.com'],
  zoom: ['zoom.us', 'zoom.com'],
  wetransfer: ['wetransfer.com'],
  airbnb: ['airbnb.com', 'airbnb.de'],
  zalando: ['zalando.de', 'zalando.com'],
  ionos: ['ionos.de', 'ionos.com'],
  strato: ['strato.de']
}

/** Freemail providers: a bank/service never writes from here. */
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
  'protonmail.com',
  'gmx.ch',
  'gmx.com',
  'mail.com',
  'outlook.de',
  'hotmail.de',
  'live.de',
  'msn.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'freenet.de',
  'arcor.de',
  'posteo.de',
  'posteo.net',
  'mailbox.org',
  'tutanota.com',
  'tuta.io',
  'zoho.com',
  'yandex.com',
  'qq.com',
  '163.com'
])

interface ThreatPolicy {
  brands: Record<string, string[]>
  trustedDomains: string[]
}

let policyCache: { config: OrgConfig | null; policy: ThreatPolicy } | null = null

/** Built-in brands plus the org configuration's brands and trusted domains. */
function threatPolicy(): ThreatPolicy {
  const config = getOrgConfig()
  if (policyCache?.config === config) return policyCache.policy
  const brands: Record<string, string[]> = { ...BRANDS }
  for (const [brand, domains] of Object.entries(config?.security?.brands ?? {})) {
    brands[brand] = [...new Set([...(brands[brand] ?? []), ...domains])]
  }
  const policy = { brands, trustedDomains: config?.security?.trustedDomains ?? [] }
  policyCache = { config, policy }
  return policy
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).hostname
  } catch {
    return null
  }
}

/** Trusted by the organisation: the domain itself or a subdomain of it. */
function isTrusted(host: string | null | undefined): boolean {
  if (!host) return false
  const h = host.toLowerCase()
  return threatPolicy().trustedDomains.some((d) => h === d || h.endsWith(`.${d}`))
}

function isOfficial(brand: string, domain: string): boolean {
  return (threatPolicy().brands[brand] ?? []).some((d) => sameDomain(d, domain))
}

/**
 * Lookalike domain: a label only becomes the brand through digit/character tricks
 * ("paypa1.com", "rnicrosoft-login.net", "g00gle.de"). Only real obfuscation
 * counts — "paypal-community.com" is not obfuscated and stays inconspicuous.
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
    for (const brand of Object.keys(threatPolicy().brands)) {
      if (skel === brand && !isOfficial(brand, domain)) return brand
    }
  }
  return null
}

/** Brand in the display name (whole word, homoglyphs resolved). */
function brandInName(name: string): string | null {
  const words: string[] = skeleton(name).match(/[a-z0-9]+/g) ?? []
  return Object.keys(threatPolicy().brands).find((brand) => words.includes(brand)) ?? null
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
  'qrco.de',
  'bit.do',
  'tr.im',
  'clck.ru',
  'urlz.fr',
  'cutt.us'
])

// --- Links -------------------------------------------------------------------------------------

/** Max. characters scanned per anchor's inner text (quadratic-scan guard). */
const MAX_LINK_TEXT_SCAN = 2_000

/** href/link text pairs from HTML (index scan, no DOM in the main process). */
export function extractLinks(html: string): Array<{ text: string; href: string }> {
  const out: Array<{ text: string; href: string }> = []
  const lower = html.toLowerCase()
  let pos = 0
  while (out.length < 300) {
    const open = lower.indexOf('<a', pos)
    if (open < 0) break
    // only real anchor tags (`<a `, `<a>`, `<a/`) — not `<abbr>`, `<article>`…
    const after = html[open + 2]
    if (after !== undefined && !/[\s/>]/.test(after)) {
      pos = open + 2
      continue
    }
    const tagEnd = html.indexOf('>', open)
    if (tagEnd < 0) break
    const tag = html.slice(open, tagEnd)
    const hrefMatch = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const close = lower.indexOf('</a', tagEnd)
    pos = close < 0 ? html.length : close + 3
    if (!hrefMatch) continue
    const href = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim().replace(/&amp;/g, '&')
    const rawText = html.slice(
      tagEnd + 1,
      close < 0 ? Math.min(html.length, tagEnd + 1 + MAX_LINK_TEXT_SCAN) : close
    )
    const text = rawText
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    out.push({ text, href })
  }
  return out
}

/** Bare URLs from plain text (for text-only mails). */
function extractTextUrls(text: string): string[] {
  return (text.match(/\bhttps?:\/\/[^\s<>"')\]]+/gi) ?? []).slice(0, 300)
}

// --- Texts -------------------------------------------------------------------------------------

// Deliberately bilingual: the patterns recognize German AND English mail content
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

/**
 * Requests for credentials, payment data or a small fee. Only phrased as a
 * request ("send us your bank details"): invoices mention "Bankverbindung" or
 * IBANs all the time.
 */
const SENSITIVE_REQUEST_PHRASES = [
  /(?<!\p{L})(?:senden|schicken|übermitteln|bestätigen|nennen|geben) sie (?:uns )?(?:bitte )?(?:hier )?ihre (?:bankdaten|kontodaten|bankverbindung|kreditkarten(?:daten|nummer)|kartendaten|zugangsdaten|anmeldedaten|kennwort|passwort|pin|tan)(?!\p{L})/iu,
  /(?<!\p{L})(?:zahlen|begleichen|überweisen) sie (?:die|eine|den) (?:\p{L}+ )?(?:zollgebühr|nachgebühr|bearbeitungsgebühr|zustellgebühr|gebühr)(?!\p{L})/iu,
  /(?<!\p{L})(?:send|provide|confirm|enter|update|verify) (?:us )?(?:with )?your (?:bank (?:details|account(?: details)?)|(?:credit )?card (?:number|details)|login (?:details|credentials)|password|pin)(?!\p{L})/iu,
  /(?<!\p{L})pay (?:the|a) (?:small )?(?:customs|delivery|shipping|redelivery|release|handling) fee(?!\p{L})/iu
]

/** Executive titles that CEO fraud puts into the display name. */
const EXECUTIVE_TITLE =
  /(?<!\p{L})(?:ceo|cfo|coo|geschäftsführer(?:in)?|vorstand|vorstandsvorsitzende[rn]?|managing director|president|präsident(?:in)?)(?!\p{L})/iu

/** CEO fraud: a confidential payment or transfer. */
const PAYMENT_WORD = String.raw`(?:überweisung|wire transfer|bank transfer|zahlung|payment)`
const SECRECY_WORD = String.raw`(?:vertraulich|confidential|diskret|discreet)`
const CONFIDENTIAL_PAYMENT = new RegExp(
  String.raw`(?<!\p{L})(?:${PAYMENT_WORD}[\s\S]{0,120}${SECRECY_WORD}|${SECRECY_WORD}[\s\S]{0,120}${PAYMENT_WORD})(?!\p{L})`,
  'iu'
)

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((re) => re.test(text)).length
}

/** Subject in capitals or with !!!/$$$ — classic spam pattern. */
function isShoutingSubject(subject: string): boolean {
  const letters = subject.match(/\p{L}/gu) ?? []
  const upper = subject.match(/\p{Lu}/gu) ?? []
  const caps = letters.length >= 8 && upper.length / letters.length >= 0.7
  return caps || /[!?]{3,}|[$€£]{2,}/.test(subject)
}

/** Find invisible characters even when they appear as HTML entities in the source. */
function decodeInvisibleEntities(html: string): string {
  return html
    .replace(/&#8203;|&#x200b;/gi, '​')
    .replace(/&zwnj;|&#8204;|&#x200c;/gi, '‌')
    .replace(/&zwj;|&#8205;|&#x200d;/gi, '‍')
    .replace(/&#8288;|&#x2060;/gi, '⁠')
    .replace(/&#65279;|&#xfeff;/gi, '﻿')
    .replace(/<[^>]*>/g, '')
}

// --- Attachments -------------------------------------------------------------------------------

const DANGEROUS_EXT =
  /\.(?:exe|scr|com|pif|bat|cmd|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|jar|lnk|ps1|reg|cpl|iso|img|vhdx?|apk|xll|appx|msix)$/i
const MACRO_EXT = /\.(?:docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam)$/i
const HTML_EXT = /\.(?:html?|shtml|xhtml|svg|mht)$/i
const DOUBLE_EXT =
  /\.(?:pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|rtf|zip|csv)\s*\.(?:[a-z0-9]{2,5})$/i

// --- Main function -----------------------------------------------------------------------------

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

  // --- Sender ---
  // Domains the organisation trusts never count as impersonation
  const senderTrusted = isTrusted(fromDomain)
  if (fromDomain && fromName && !senderTrusted) {
    const found = fromName.match(/(?:[a-z0-9][a-z0-9-]*\.)+(?:[a-z]{2,})\b/gi) ?? []
    const other = found.map((d) => d.toLowerCase()).find((d) => !sameDomain(d, fromDomain))
    if (other) {
      add(
        'display_name_domain',
        1,
        2,
        1,
        `The display name mentions "${other}", but the real sender address belongs to ${fromDomain}`
      )
    }
  }

  if (fromDomain && input.replyToJson) {
    try {
      const list = JSON.parse(input.replyToJson) as Array<{ address?: string }>
      const other = list
        .map((r) => domainOfAddr(r.address))
        .find((d): d is string => !!d && !sameDomain(d, fromDomain) && !isTrusted(d))
      if (other) {
        add('reply_to_differs', 1, 1, 0, `Replies go to ${other}, but the sender is ${fromDomain}`)
      }
    } catch {
      // broken JSON: no signal
    }
  }

  let senderHomoglyph = false
  if (fromDomain && !senderTrusted && isHomoglyphHost(fromDomain)) {
    senderHomoglyph = true
    add(
      'homoglyph_sender',
      1,
      4,
      2,
      `The sender domain ${unicodeHost(fromDomain)} contains look-alike characters from another alphabet (e.g. Cyrillic) that resemble Latin letters`
    )
  }
  const senderLookalike =
    fromDomain && !senderHomoglyph && !senderTrusted ? lookalikeBrand(fromDomain) : null
  if (senderLookalike) {
    add(
      'lookalike_sender',
      1,
      4,
      1,
      `The sender domain ${fromDomain} imitates "${senderLookalike}" with swapped characters`
    )
  }
  const nameBrand = fromName && !senderTrusted ? brandInName(fromName) : null
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
      `The display name claims to be "${nameBrand}", but the email comes from a free email address (${fromDomain})`
    )
  }

  if (
    nameBrand &&
    fromDomain &&
    !FREEMAIL.has(baseDomain(fromDomain)) &&
    !isOfficial(nameBrand, fromDomain) &&
    !senderHomoglyph &&
    !senderLookalike
  ) {
    add(
      'brand_other_domain',
      1,
      2,
      0,
      `The display name claims to be "${nameBrand}", but the email comes from ${fromDomain}, which is not one of its known domains`
    )
  }
  if (
    fromName &&
    !senderTrusted &&
    EXECUTIVE_TITLE.test(fromName) &&
    fromDomain &&
    FREEMAIL.has(baseDomain(fromDomain))
  ) {
    add(
      'executive_freemail',
      1,
      3,
      0,
      `The display name carries an executive title, but the email comes from a free email address (${fromDomain})`
    )
  }

  // --- Authentication (header lines) ---
  if (input.auth) {
    if (input.auth.dmarc === 'fail') {
      add(
        'dmarc_fail',
        1,
        3,
        2,
        'DMARC check failed: the sender domain did not authorise this email'
      )
    } else if (
      input.auth.spf === 'fail' ||
      input.auth.spf === 'softfail' ||
      input.auth.dkim === 'fail'
    ) {
      add('auth_fail', 1, 1, 1, 'SPF or DKIM check of the sender failed')
    }
  }
  if (input.serverSpamFlag) {
    add('server_spam', 1, 0, 4, 'The mail server marked this email as spam')
  }

  // --- Script tricks in subject, name and text ---
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
      `${plural(mixed.size, 'word mixes', 'words mix')} Latin with Cyrillic/Greek letters (deception or filter evasion)`
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
      'Invisible characters (zero-width spaces) between letters, typically used to evade spam filters'
    )
  }
  const filenames = (input.attachments ?? []).map((a) => a.filename ?? '')
  if (hasBidiControls(`${fromName}${subject}${filenames.join('')}`)) {
    add(
      'bidi_control',
      1,
      3,
      1,
      'Text-direction control characters in subject, name or file name (e.g. hiding ".exe")'
    )
  }

  // --- Links ---
  const anchors = html ? extractLinks(html) : []
  const hrefs = anchors.length > 0 ? anchors.map((a) => a.href) : extractTextUrls(text)
  let mismatches = 0
  for (const link of anchors) {
    if (linkHostMismatch(link.text, link.href) && !isTrusted(hostOf(link.href))) mismatches += 1
  }
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
    // Link targets the organisation trusts (its own tools, tracking domains)
    if (isTrusted(host)) continue
    if (url.username) userinfo += 1
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) ipLinks += 1
    // Homoglyph rules out lookalike/punycode – one link, one deception
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
      `${plural(mismatches, 'link', 'links')}: the visible link text shows a different host than the actual target`
    )
  }
  if (homoglyph > 0) {
    add(
      'homoglyph_link',
      homoglyph,
      4,
      1,
      `${plural(homoglyph, 'link leads', 'links lead')} to a domain with look-alike characters from another alphabet`
    )
  }
  if (lookalike > 0) {
    add(
      'lookalike_link',
      lookalike,
      3,
      1,
      `${plural(lookalike, 'link leads', 'links lead')} to a domain imitating a well-known brand with swapped characters`
    )
  }
  if (ipLinks > 0) {
    add(
      'ip_link',
      ipLinks,
      2,
      1,
      `${plural(ipLinks, 'link leads', 'links lead')} to a raw IP address`
    )
  }
  if (puny > 0) {
    add(
      'punycode_link',
      puny,
      1,
      0,
      `${plural(puny, 'link uses', 'links use')} a punycode domain (xn--)`
    )
  }
  if (userinfo > 0) {
    add(
      'userinfo_link',
      userinfo,
      3,
      0,
      `${plural(userinfo, 'link hides', 'links hide')} the real target behind an "@" (https://bank.example@other.example)`
    )
  }
  if (script > 0) {
    add(
      'script_link',
      script,
      3,
      0,
      `${plural(script, 'link contains', 'links contain')} script or data URLs`
    )
  }
  if (shortener > 0) {
    add(
      'shortener_link',
      shortener,
      1,
      1,
      `${plural(shortener, 'link uses', 'links use')} a URL shortener that hides the target`
    )
  }

  // --- Forms and pressure ---
  if (/<form\b/i.test(html) || /<input\b[^>]*type\s*=\s*["']?password/i.test(html)) {
    add(
      'credential_form',
      1,
      3,
      0,
      'The email contains an input form (possible request for credentials)'
    )
  }
  const urgency = countMatches(`${subject}\n${text}`, URGENCY_PHRASES)
  if (urgency > 0 && hrefs.length > 0) {
    add(
      'urgency_language',
      1,
      urgency >= 2 ? 2 : 1,
      0,
      'Typical pressure phrases (account locked, confirm your data, deadline in hours) together with links'
    )
  }

  const requestText = `${subject}\n${text}`
  if (countMatches(requestText, SENSITIVE_REQUEST_PHRASES) > 0) {
    add('sensitive_request', 1, 2, 1, 'Asks for bank details, card data, credentials or a fee')
  }
  if (CONFIDENTIAL_PAYMENT.test(requestText)) {
    add(
      'confidential_payment',
      1,
      2,
      0,
      'Asks for a payment or transfer to be handled confidentially (typical of CEO fraud)'
    )
  }

  // --- Attachments ---
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
      `${plural(dangerous, 'attachment is', 'attachments are')} executable (program, script or disk image)`
    )
  }
  if (macro > 0) {
    add(
      'macro_attachment',
      macro,
      2,
      0,
      `${plural(macro, 'attachment contains', 'attachments contain')} Office macros`
    )
  }
  if (htmlAtt > 0) {
    add(
      'html_attachment',
      htmlAtt,
      2,
      0,
      `${plural(htmlAtt, 'attachment is', 'attachments are')} an HTML/SVG file (a common way to deliver fake login pages)`
    )
  }
  if (doubleExt > 0) {
    add(
      'double_extension',
      doubleExt,
      2,
      0,
      `${plural(doubleExt, 'attachment is', 'attachments are')} disguised with a double extension (e.g. "invoice.pdf.exe")`
    )
  }

  // --- Spam patterns ---
  const spamPhrases = countMatches(`${subject}\n${text}`, SPAM_PHRASES)
  if (spamPhrases > 0) {
    add(
      'spam_phrases',
      spamPhrases,
      0,
      Math.min(3, spamPhrases),
      `${plural(spamPhrases, 'typical spam phrase', 'typical spam phrases')} (prizes, crypto returns, inheritance …)`
    )
  }
  if (subject && isShoutingSubject(subject)) {
    add('shouting_subject', 1, 0, 1, 'Subject in capitals or with piled-up !!!/$$$')
  }
  if (html && /<img\b/i.test(html) && text.replace(/\s+/g, ' ').trim().length < 120) {
    add(
      'image_only',
      1,
      0,
      1,
      'The email consists almost entirely of images (text unreadable for filters)'
    )
  }
  const hidden = (
    html.match(/font-size\s*:\s*0(?:px|pt|em)?\s*[;"']|visibility\s*:\s*hidden/gi) ?? []
  ).length
  if (hidden >= 5) {
    add('hidden_text', 1, 0, 1, 'Lots of hidden text in the HTML (filter evasion)')
  }

  let phishingScore = signals.reduce((sum, s) => sum + s.phishing, 0)
  let spamScore = signals.reduce((sum, s) => sum + s.spam, 0)
  // Known contact: spam is unlikely (phishing via hijacked accounts remains possible)
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
