import type { StringKey } from '@renderer/i18n/strings'

// Lokale Signal-Codes (src/main/mail/threat-signals.ts) → Texte der Warnung.
const REASON_KEY: Record<string, StringKey> = {
  display_name_domain: 'phishReasonDisplayName',
  reply_to_differs: 'phishReasonReplyTo',
  link_mismatch: 'phishReasonLinkMismatch',
  ip_link: 'phishReasonIpLink',
  punycode_link: 'phishReasonPunycode',
  homoglyph_sender: 'threatReasonHomoglyphSender',
  lookalike_sender: 'threatReasonLookalikeSender',
  brand_freemail: 'threatReasonBrandFreemail',
  dmarc_fail: 'threatReasonDmarcFail',
  auth_fail: 'threatReasonAuthFail',
  server_spam: 'threatReasonServerSpam',
  mixed_script: 'threatReasonMixedScript',
  invisible_chars: 'threatReasonInvisible',
  bidi_control: 'threatReasonBidi',
  homoglyph_link: 'threatReasonHomoglyphLink',
  lookalike_link: 'threatReasonLookalikeLink',
  userinfo_link: 'threatReasonUserinfoLink',
  script_link: 'threatReasonScriptLink',
  shortener_link: 'threatReasonShortener',
  credential_form: 'threatReasonForm',
  urgency_language: 'threatReasonUrgency',
  dangerous_attachment: 'threatReasonDangerousAttachment',
  macro_attachment: 'threatReasonMacroAttachment',
  html_attachment: 'threatReasonHtmlAttachment',
  double_extension: 'threatReasonDoubleExtension',
  spam_phrases: 'threatReasonSpamPhrases',
  shouting_subject: 'threatReasonShouting',
  image_only: 'threatReasonImageOnly',
  hidden_text: 'threatReasonHiddenText'
}

/** "link_mismatch:2" → { key: 'link_mismatch', n: 2 }; unbekannte Codes entfallen. */
export function parseSignal(code: string): { key: StringKey; n: number } | null {
  const [name, count] = code.split(':')
  const key = REASON_KEY[name]
  return key ? { key, n: Math.max(1, Number(count) || 1) } : null
}

export type ThreatLevel = 'none' | 'suspicious' | 'high'

export interface BannerInput {
  phishing: { level: ThreatLevel; ai: number | null }
  spam: { level: ThreatLevel; ai: number | null }
  inJunk: boolean
}

/**
 * Welche Warnung zeigt die Mail-Ansicht? Phishing geht vor Spam; „verdächtig"
 * ist ein leiser Hinweis. Im Spam-Ordner keine Spam-Meldung (dort ist sie schon).
 */
export function bannerKind(
  s: BannerInput
): 'phishing-high' | 'phishing-suspicious' | 'spam-high' | 'spam-suspicious' | null {
  if (s.phishing.level === 'high') return 'phishing-high'
  if (!s.inJunk && s.spam.level === 'high') return 'spam-high'
  if (s.phishing.level === 'suspicious') return 'phishing-suspicious'
  if (!s.inJunk && s.spam.level === 'suspicious') return 'spam-suspicious'
  return null
}
