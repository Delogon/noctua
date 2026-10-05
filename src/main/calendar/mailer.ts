import type { Partstat } from './itip'

/**
 * Versand von iMIP-Nachrichten (RFC 6047) über die Outbox. Die Outbox wird vom
 * Main-Bootstrap eingehängt (`setItipMailer`) — so bleibt das Kalendermodul
 * ohne SMTP/Electron testbar. Jede Nachricht ist multipart/alternative
 * (Text + text/calendar; method=…) plus .ics-Anhang (nodemailer `icalEvent`).
 */

export interface ItipMail {
  to: string[]
  subject: string
  text: string
  method: 'REPLY' | 'REQUEST' | 'CANCEL'
  ics: string
}

export type ItipMailer = (mailAccountId: number, mail: ItipMail) => void

let mailer: ItipMailer | null = null

export function setItipMailer(fn: ItipMailer | null): void {
  mailer = fn
}

export function itipMailerReady(): boolean {
  return mailer !== null
}

export function sendItipMail(mailAccountId: number, mail: ItipMail): void {
  if (!mailer) throw new Error('iMIP-Versand ist nicht eingerichtet')
  mailer(mailAccountId, mail)
}

// --- Texte ----------------------------------------------------------------------------------

export type MailLang = 'de' | 'en'

const SUBJECT_PREFIX: Record<MailLang, Record<string, string>> = {
  en: {
    ACCEPTED: 'Accepted',
    TENTATIVE: 'Tentatively accepted',
    DECLINED: 'Declined',
    REQUEST: 'Invitation',
    UPDATE: 'Updated invitation',
    CANCEL: 'Canceled event'
  },
  de: {
    ACCEPTED: 'Zugesagt',
    TENTATIVE: 'Vorläufig zugesagt',
    DECLINED: 'Abgesagt',
    REQUEST: 'Einladung',
    UPDATE: 'Aktualisierte Einladung',
    CANCEL: 'Termin abgesagt'
  }
}

export function itipSubject(
  lang: MailLang,
  kind: Partstat | 'REQUEST' | 'UPDATE' | 'CANCEL',
  summary: string | null
): string {
  const clean = (summary ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200)
  return `${SUBJECT_PREFIX[lang][kind]}: ${clean || (lang === 'de' ? '(ohne Titel)' : '(no title)')}`
}

export interface WhenInfo {
  startUtc: number | null
  endUtc: number | null
  allDay: boolean
  tzid: string | null
}

/** Lesbare Zeitangabe für Mailtexte (Zeitzone des Termins, sonst UTC). */
export function formatWhen(lang: MailLang, when: WhenInfo): string {
  if (when.startUtc === null) return ''
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  let zone = when.tzid && when.tzid !== 'UTC' ? when.tzid : 'UTC'
  try {
    new Intl.DateTimeFormat(locale, { timeZone: zone })
  } catch {
    zone = 'UTC'
  }
  if (when.allDay) {
    const f = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
    const start = f.format(when.startUtc)
    const last =
      when.endUtc !== null && when.endUtc - when.startUtc > 86_400_000
        ? f.format(when.endUtc - 86_400_000)
        : null
    return last ? `${start} – ${last}` : start
  }
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: zone })
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
    timeZoneName: 'short'
  })
  const end = when.endUtc !== null && when.endUtc > when.startUtc ? when.endUtc : null
  return end
    ? `${date.format(when.startUtc)}, ${time.format(when.startUtc)} – ${time.format(end)}`
    : `${date.format(when.startUtc)}, ${time.format(when.startUtc)}`
}

export function replyBody(
  lang: MailLang,
  opts: { who: string; partstat: Partstat; summary: string | null; comment?: string | null }
): string {
  const line =
    lang === 'de'
      ? {
          ACCEPTED: `${opts.who} hat die Einladung angenommen.`,
          TENTATIVE: `${opts.who} hat die Einladung vorläufig angenommen.`,
          DECLINED: `${opts.who} hat die Einladung abgelehnt.`
        }[opts.partstat]
      : {
          ACCEPTED: `${opts.who} has accepted this invitation.`,
          TENTATIVE: `${opts.who} has tentatively accepted this invitation.`,
          DECLINED: `${opts.who} has declined this invitation.`
        }[opts.partstat]
  const parts = [line]
  if (opts.summary) parts.push(opts.summary)
  const comment = opts.comment?.trim()
  if (comment) parts.push('', comment)
  return parts.join('\n')
}

export function inviteBody(
  lang: MailLang,
  opts: {
    kind: 'REQUEST' | 'UPDATE' | 'CANCEL'
    organizer: string
    summary: string | null
    when: WhenInfo
    location: string | null
  }
): string {
  const head =
    lang === 'de'
      ? {
          REQUEST: `${opts.organizer} lädt Sie zu einem Termin ein.`,
          UPDATE: `${opts.organizer} hat einen Termin geändert.`,
          CANCEL: `${opts.organizer} hat einen Termin abgesagt.`
        }[opts.kind]
      : {
          REQUEST: `${opts.organizer} invites you to an event.`,
          UPDATE: `${opts.organizer} has updated an event.`,
          CANCEL: `${opts.organizer} has canceled an event.`
        }[opts.kind]
  const lines = [head, '']
  if (opts.summary) lines.push(opts.summary)
  const when = formatWhen(lang, opts.when)
  if (when) lines.push(`${lang === 'de' ? 'Wann' : 'When'}: ${when}`)
  if (opts.location) lines.push(`${lang === 'de' ? 'Wo' : 'Where'}: ${opts.location}`)
  return lines.join('\n')
}
