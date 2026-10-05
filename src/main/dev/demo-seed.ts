import type Database from 'better-sqlite3-multiple-ciphers'
import { ACCOUNT_COLORS } from '@shared/types'
import type { CalendarEventFields } from '@shared/calendar-types'
import { isDev } from '../dev-mode'
import { setLocalOnly } from '../privacy'
import { setSecret } from '../auth/secrets'
import { accountSecretKey } from '../auth/providers'
import { parseMail } from '../mail/parser'
import { storeBody, upsertEnvelope, type EnvelopeData } from '../mail/ingest'
import { createEventIcs, updateIcs, type EditContext } from '../calendar/edit'
import { setFreeBusyDeps } from '../calendar/freebusy'
import { calSecretKey, newObjectHref, upsertObject } from '../calendar/repo'
import { upsertContact } from '../contacts/repo'
import { buildTodoIcs, fieldsHash, taskUid } from '../tasks/todo'
import { createProfile, setProfileKey, setTaskAssignment } from '../ai/providers/registry'

/**
 * Dev-only Demo-Daten (NOCTUA_DEMO_SEED=1) für Screenshots und visuelles QA.
 * Läuft ausschließlich im Dev-Modus (isDev) und nur auf einer leeren DB; nichts
 * hiervon ist über das Produktions-Bundle erreichbar (Aufruf in index.ts hinter
 * `isDev`, dort per dynamischem import). Es werden keine Server kontaktiert:
 * der Aufrufer startet für Demo-Konten weder IMAP- noch CalDAV-Sync.
 *
 *   NOCTUA_DEMO_SEED=1        Daten anlegen (idempotent)
 *   NOCTUA_DEMO_LOCAL_ONLY=1  zusätzlich „Local only" einschalten (sonst aus)
 *   NOCTUA_DEMO_LANG=de|en    UI-Sprache (Standard en)
 *   NOCTUA_DEMO_ONBOARDING=1  Onboarding offen lassen (für die Org-Profile-Aufnahme)
 *
 * Möglichst über die echten Pfade (parseMail → upsertEnvelope → storeBody →
 * storeInvitations, createEventIcs/updateIcs → upsertObject, Profil-Registry),
 * damit die Daten so konsistent sind wie die echter Konten.
 */

export const DEMO_EMAIL = 'nora.brandt@acme-corp.example'

export function demoSeedRequested(): boolean {
  return isDev && process.env.NOCTUA_DEMO_SEED === '1'
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const pad = (n: number): string => String(n).padStart(2, '0')

/** Lokale Wandzeit (Prozess-TZ; der Launcher setzt TZ=Europe/Berlin). */
function wallOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}
const dayOf = (ms: number): string => wallOf(ms).slice(0, 10)

/** Montag 00:00 der aktuellen Woche. */
function weekStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7
  return d.getTime() - dow * DAY
}

const TZ = 'Europe/Berlin'

// --- Mail ------------------------------------------------------------------------------------

interface DemoMail {
  folder: 'inbox' | 'sent' | 'spam'
  /** Alter in Minuten (Datum = jetzt − ageMin) */
  ageMin: number
  from: [string, string]
  to?: string
  subject: string
  messageId: string
  inReplyTo?: string
  text?: string
  html?: string
  extraHeaders?: string[]
  /** komplette MIME-Teile (z. B. text/calendar) statt text/html */
  calendar?: string
  attachment?: { name: string; type: string; size: number }
  seen?: boolean
  flagged?: boolean
  ai?: {
    category: string
    priority: number
    summary: string
    needsReply?: boolean
    actions?: Array<{ title: string; due: string | null }>
  }
}

const rfcDate = (ms: number): string => new Date(ms).toUTCString().replace('GMT', '+0000')

/** Baut eine RFC-822-Nachricht; die Struktur entscheidet parseMail genauso wie beim echten Abruf. */
function buildMime(m: DemoMail, to: string, now: number): string {
  const head = [
    `From: "${m.from[0]}" <${m.from[1]}>`,
    `To: ${to}`,
    `Subject: ${m.subject}`,
    `Date: ${rfcDate(now - m.ageMin * 60_000)}`,
    `Message-ID: <${m.messageId}>`,
    ...(m.inReplyTo ? [`In-Reply-To: <${m.inReplyTo}>`, `References: <${m.inReplyTo}>`] : []),
    ...(m.extraHeaders ?? []),
    'MIME-Version: 1.0'
  ]
  const text = m.text ?? 'This message needs an HTML-capable mail client.'
  const alt = (parts: string[]): string[] => {
    const b = '=_alt_' + m.messageId.length
    return [
      `Content-Type: multipart/alternative; boundary="${b}"`,
      '',
      ...parts.flatMap((p) => [`--${b}`, p, '']),
      `--${b}--`
    ]
  }
  const plain = ['Content-Type: text/plain; charset=utf-8', '', text].join('\r\n')
  const htmlPart = m.html
    ? ['Content-Type: text/html; charset=utf-8', '', m.html].join('\r\n')
    : null
  const calPart = m.calendar
    ? [
        'Content-Type: text/calendar; charset=utf-8; method=REQUEST',
        'Content-Transfer-Encoding: 7bit',
        '',
        m.calendar
      ].join('\r\n')
    : null
  const alternatives = [plain, ...(htmlPart ? [htmlPart] : []), ...(calPart ? [calPart] : [])]
  let body: string[]
  if (m.attachment) {
    const outer = '=_mix_' + m.messageId.length
    const data = Buffer.alloc(Math.min(m.attachment.size, 2048), 'x').toString('base64')
    body = [
      `Content-Type: multipart/mixed; boundary="${outer}"`,
      '',
      `--${outer}`,
      ...alt(alternatives),
      '',
      `--${outer}`,
      `Content-Type: ${m.attachment.type}; name="${m.attachment.name}"`,
      `Content-Disposition: attachment; filename="${m.attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      data,
      `--${outer}--`
    ]
  } else if (alternatives.length > 1) {
    body = alt(alternatives)
  } else {
    body = ['Content-Type: text/plain; charset=utf-8', '', text]
  }
  return [...head, ...body].join('\r\n')
}

const NEWSLETTER_HTML = `<!DOCTYPE html>
<html><head><style>body{background:#ff00ff}</style></head>
<body style="margin:0;padding:0;background-color:#f3efe6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3efe6;">
 <tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #d9d2c3;">
   <tr><td style="padding:22px 28px 8px;font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#8a3b12;">The Weekly Dispatch &middot; Issue 214</td></tr>
   <tr><td style="padding:0 28px 14px;font-family:Georgia,serif;font-size:30px;line-height:1.15;color:#1b1b1b;"><strong>Why small teams ship faster than big ones</strong></td></tr>
   <tr><td style="padding:0 28px;"><img src="https://images.weeklydispatch.example/issue-214/hero.jpg" width="544" height="260" alt="A desk with a typewriter" style="display:block;width:100%;height:auto;border:0;background:#e5dfd1;"></td></tr>
   <tr><td style="padding:18px 28px 6px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#333333;">
     Good morning,<br><br>
     This week we look at <span style="color:#b8431e;font-weight:bold;">three habits</span> that keep product teams fast: short feedback loops, written decisions and boring infrastructure. We also visited a print shop that still sets type by hand.
   </td></tr>
   <tr><td style="padding:10px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#333333;">
     <a href="https://weeklydispatch.example/issue-214/feedback-loops" style="color:#0b57d0;">Read: Feedback loops, measured in hours</a><br>
     <a href="https://weeklydispatch.example/issue-214/decisions" style="color:#0b57d0;text-decoration:underline;">Read: The one-page decision record</a>
   </td></tr>
   <tr><td align="left" style="padding:12px 28px 22px;">
     <a href="https://weeklydispatch.example/subscribe/pro" style="display:inline-block;background:#1b1b1b;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:14px;padding:11px 20px;text-decoration:none;border-radius:4px;">Upgrade to Dispatch Pro</a>
   </td></tr>
   <tr><td style="padding:0 28px 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#555555;background:#faf7f0;">
     <p style="margin:12px 0;">Your reading list sync is waiting: <a href="https://tracking.weeklydispatch.example/r/8f2c" style="color:#0b57d0;">https://weeklydispatch.example/account</a></p>
   </td></tr>
   <tr><td style="padding:14px 28px 22px;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:#8a8a8a;border-top:1px solid #e6e0d2;">
     You receive this newsletter because you subscribed at weeklydispatch.example.<br>
     <a href="https://weeklydispatch.example/unsubscribe" style="color:#8a8a8a;">Unsubscribe</a> &middot; <a href="https://weeklydispatch.example/prefs" style="color:#8a8a8a;">Preferences</a>
   </td></tr>
  </table>
 </td></tr>
</table>
<img src="https://tracking.weeklydispatch.example/open.gif?u=8f2c" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">
</body></html>`

const PHISH_HTML = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5;">
<p>Dear customer,</p>
<p>we noticed an unusual sign-in to your account. Please confirm your details within 24 hours:</p>
<p><a href="https://login-secure.verify-account.example.net/session?id=4412">https://www.sparkasse.de/konto/bestaetigen</a></p>
<p>If you did not request this, you can safely ignore this message. For questions see our
<a href="https://www.sparkasse.de/hilfe">help centre</a>.</p>
<p>Regards,<br>Customer Service</p></div>`

const SHIPPING_HTML = `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;color:#222;">
<h2 style="font-weight:600;margin:0 0 8px;">Your order is on its way</h2>
<p style="margin:0 0 14px;color:#555;">Order #A-20931 &middot; Arrives Thursday</p>
<img src="https://cdn.parcelhub.example/orders/20931/item.jpg" width="160" height="160" alt="Notebook, A5 dotted" style="float:left;margin:0 14px 8px 0;border-radius:6px;">
<p style="margin:0 0 6px;"><strong>Notebook, A5 dotted</strong> &times; 3</p>
<p style="margin:0 0 6px;">Carrier: ParcelHub Express</p>
<p style="clear:both;margin:14px 0;"><a href="https://parcelhub.example/track/PH88123" style="color:#0b57d0;">Track your parcel</a></p>
</div>`

function inviteIcs(now: number): string {
  const ws = weekStart(now)
  const start = ws + 3 * DAY + 15 * HOUR // Do 15:00
  const end = start + HOUR
  const f = (ms: number): string => wallOf(ms).replace(/[-:]/g, '')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Acme Partners//Calendar//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:kickoff-2026-demo@acme-partners.example',
    `DTSTAMP:${new Date(now - 3 * HOUR).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;TZID=${TZ}:${f(start)}`,
    `DTEND;TZID=${TZ}:${f(end)}`,
    'SEQUENCE:0',
    'SUMMARY:Project kickoff: Harbour redesign',
    'LOCATION:Acme Partners HQ\\, Room 4.12 (or Zoom)',
    'DESCRIPTION:Agenda: goals and scope\\, timeline\\, roles. Please bring your\\n questions about the budget draft.',
    'ORGANIZER;CN=Marta Lindqvist:mailto:marta.lindqvist@acme-partners.example',
    `ATTENDEE;CN=Nora Brandt;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${DEMO_EMAIL}`,
    'ATTENDEE;CN=Jonas Weber;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:jonas.weber@acme-corp.example',
    'ATTENDEE;CN=Priya Nair;ROLE=OPT-PARTICIPANT;PARTSTAT=TENTATIVE:mailto:priya.nair@acme-partners.example',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

function demoMails(now: number): DemoMail[] {
  return [
    {
      folder: 'inbox',
      ageMin: 25,
      from: ['The Weekly Dispatch', 'news@weeklydispatch.example'],
      subject: 'Why small teams ship faster than big ones',
      messageId: 'dispatch-214@weeklydispatch.example',
      text: 'The Weekly Dispatch, Issue 214. Why small teams ship faster than big ones. Read online: https://weeklydispatch.example/issue-214',
      html: NEWSLETTER_HTML,
      extraHeaders: [
        'List-Unsubscribe: <https://weeklydispatch.example/unsubscribe>',
        'List-Unsubscribe-Post: List-Unsubscribe=One-Click'
      ],
      ai: {
        category: 'newsletter',
        priority: 1,
        summary: 'Weekly essay on why small teams ship faster: feedback loops, written decisions.'
      }
    },
    {
      folder: 'inbox',
      ageMin: 70,
      from: ['Marta Lindqvist', 'marta.lindqvist@acme-partners.example'],
      subject: 'Invitation: Project kickoff: Harbour redesign',
      messageId: 'kickoff-invite@acme-partners.example',
      text: 'Marta Lindqvist invited you to Project kickoff: Harbour redesign on Thursday at 15:00.',
      calendar: inviteIcs(now),
      ai: {
        category: 'work',
        priority: 4,
        summary: 'Marta invites you to the Harbour redesign kickoff on Thursday 15:00.'
      }
    },
    {
      folder: 'inbox',
      ageMin: 140,
      from: ['Jonas Weber', 'jonas.weber@acme-corp.example'],
      subject: 'Q4 budget draft: please review by Friday',
      messageId: 'budget-q4-1@acme-corp.example',
      text: 'Hi Nora,\n\nattached is the first draft of the Q4 budget. Could you check the marketing lines and the contractor estimates before Friday noon? I need your sign-off to send it to finance.\n\nThe open points are on page 3.\n\nThanks,\nJonas',
      attachment: { name: 'Q4-budget-draft.pdf', type: 'application/pdf', size: 482_113 },
      flagged: true,
      ai: {
        category: 'work',
        priority: 5,
        summary: 'Jonas needs your review of the Q4 budget draft by Friday noon.',
        needsReply: true,
        actions: [
          { title: 'Review Q4 budget draft (marketing + contractors)', due: dayOf(now + 3 * DAY) }
        ]
      }
    },
    {
      folder: 'inbox',
      ageMin: 260,
      from: ['Sparkasse Service', 'service@sparkasse-alerts.example'],
      subject: 'Action required: confirm your account details',
      messageId: 'alert-4412@sparkasse-alerts.example',
      text: 'Please confirm your account details: https://www.sparkasse.de/konto/bestaetigen',
      html: PHISH_HTML,
      ai: {
        category: 'notifications',
        priority: 2,
        summary: 'Account confirmation request; the link text does not match its target.'
      }
    },
    {
      folder: 'inbox',
      ageMin: 330,
      from: ['Lena Fischer', 'lena.fischer@acme-corp.example'],
      subject: 'Offsite logistics',
      messageId: 'offsite-1@acme-corp.example',
      text: 'Hi all,\n\nI booked the venue for the offsite (Thu to Sat). Can everyone tell me about dietary requirements by Wednesday?\n\nLena',
      seen: true,
      ai: {
        category: 'work',
        priority: 3,
        summary: 'Lena asks for dietary requirements for the offsite by Wednesday.'
      }
    },
    {
      folder: 'inbox',
      ageMin: 300,
      from: ['Jonas Weber', 'jonas.weber@acme-corp.example'],
      subject: 'Re: Offsite logistics',
      messageId: 'offsite-2@acme-corp.example',
      inReplyTo: 'offsite-1@acme-corp.example',
      text: 'Vegetarian for me, thanks! Also: can we start an hour later on Thursday? The train gets in at 10.',
      seen: true,
      ai: {
        category: 'work',
        priority: 2,
        summary: 'Jonas is vegetarian and asks for a later start on Thursday.'
      }
    },
    {
      folder: 'sent',
      ageMin: 280,
      from: ['Nora Brandt', DEMO_EMAIL],
      to: 'Lena Fischer <lena.fischer@acme-corp.example>',
      subject: 'Re: Offsite logistics',
      messageId: 'offsite-3@acme-corp.example',
      inReplyTo: 'offsite-2@acme-corp.example',
      text: 'Hi Lena,\n\nno dietary requirements on my side. A later start on Thursday works for me too.\n\nNora',
      seen: true
    },
    {
      folder: 'inbox',
      ageMin: 600,
      from: ['ParcelHub', 'orders@parcelhub.example'],
      subject: 'Your order #A-20931 has shipped',
      messageId: 'ship-20931@parcelhub.example',
      text: 'Your order #A-20931 has shipped. Track: https://parcelhub.example/track/PH88123',
      html: SHIPPING_HTML,
      ai: {
        category: 'transactional',
        priority: 2,
        summary: 'Order #A-20931 shipped, arriving Thursday.'
      }
    },
    {
      folder: 'inbox',
      ageMin: 900,
      from: ['Sven Aaltonen', 'sven@aaltonen.example'],
      subject: 'Weekend plans?',
      messageId: 'weekend-1@aaltonen.example',
      text: 'Hey Nora,\n\nare you around on Saturday? We could finally try the new climbing hall. Bring your harness, I can lend shoes.\n\nSven',
      ai: {
        category: 'personal',
        priority: 3,
        summary: 'Sven asks if you want to go climbing on Saturday.',
        needsReply: true
      }
    },
    {
      folder: 'inbox',
      ageMin: 1700,
      from: ['GitHub', 'notifications@github.example'],
      subject: '[harbour/web] CI failed on main (build #4821)',
      messageId: 'gh-4821@github.example',
      text: 'The build for commit 3f9a1c2 on main failed. See the logs: https://github.example/harbour/web/actions/runs/4821',
      seen: true,
      ai: { category: 'notifications', priority: 2, summary: 'CI build #4821 failed on main.' }
    }
  ]
}

async function seedMail(db: Database.Database, now: number): Promise<number> {
  const color = ACCOUNT_COLORS[0]
  const acc = Number(
    db
      .prepare(
        `INSERT INTO accounts (email, account_name, display_name, provider, credential_type,
           imap_host, imap_port, smtp_host, smtp_port, ai_enabled, color, created_at)
         VALUES (?, 'Work', 'Nora Brandt', 'imap', 'password', 'imap.acme-corp.example', 993,
           'smtp.acme-corp.example', 465, 1, ?, ?)`
      )
      .run(DEMO_EMAIL, color, now).lastInsertRowid
  )
  setSecret(accountSecretKey(acc), 'demo-password')

  const folderIds: Record<string, number> = {}
  const mkFolder = db.prepare(
    `INSERT INTO folders (account_id, path, special_use, uidvalidity, uidnext, sync_mode, last_synced_at)
     VALUES (?, ?, ?, 1, 100, 'full', ?)`
  )
  for (const [key, path, use] of [
    ['inbox', 'INBOX', '\\Inbox'],
    ['sent', 'Sent', '\\Sent'],
    ['drafts', 'Drafts', '\\Drafts'],
    ['spam', 'Junk', '\\Junk'],
    ['trash', 'Trash', '\\Trash'],
    ['archive', 'Archive', '\\Archive']
  ] as const) {
    folderIds[key] = Number(mkFolder.run(acc, path, use, now).lastInsertRowid)
  }

  const insAnn = db.prepare(
    `INSERT INTO ai_annotations (message_id, category, priority, summary, action_items_json,
       needs_reply, confidence, model, prompt_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0.9, 'demo', 1, ?)`
  )
  let uid = 1
  for (const m of demoMails(now)) {
    const to = m.to ?? `Nora Brandt <${DEMO_EMAIL}>`
    const parsed = await parseMail(Buffer.from(buildMime(m, to, now), 'utf8'))
    const date = now - m.ageMin * 60_000
    const env: EnvelopeData = {
      uid: uid++,
      gmMsgid: null,
      gmThrid: null,
      messageId: `<${m.messageId}>`,
      inReplyTo: m.inReplyTo ? `<${m.inReplyTo}>` : null,
      references: m.inReplyTo ? [`<${m.inReplyTo}>`] : [],
      subject: m.subject,
      fromAddr: m.from[1],
      fromName: m.from[0],
      to: parsed.to,
      cc: [],
      replyTo: [],
      date,
      internalDate: date,
      size: 4000,
      flags: new Set([
        ...(m.seen || m.folder === 'sent' ? ['\\Seen'] : []),
        ...(m.flagged ? ['\\Flagged'] : [])
      ]),
      hasAttachments: !!m.attachment,
      listUnsubscribe: !!m.extraHeaders?.some((h) => h.startsWith('List-Unsubscribe:')),
      listUnsubscribeUrl: m.extraHeaders?.some((h) => h.startsWith('List-Unsubscribe:'))
        ? 'https://weeklydispatch.example/unsubscribe'
        : null,
      listUnsubscribePost: !!m.extraHeaders?.some((h) => h.startsWith('List-Unsubscribe-Post'))
    }
    const res = upsertEnvelope(db, acc, folderIds[m.folder], env)
    if (!res) continue
    // storeBody legt auch die Einladung an (storeInvitations) — echter Ingest-Pfad
    storeBody(db, res.messageId, parsed)
    if (m.ai) {
      insAnn.run(
        res.messageId,
        m.ai.category,
        m.ai.priority,
        m.ai.summary,
        JSON.stringify(m.ai.actions ?? []),
        m.ai.needsReply ? 1 : 0,
        now
      )
    }
  }
  return acc
}

// --- Kalender --------------------------------------------------------------------------------

interface Ev {
  summary: string
  /** Tag relativ zum Wochenstart (0 = Montag) */
  day: number
  from?: string
  to?: string
  /** ganztägig: Anzahl Tage (end exklusiv) */
  allDayDays?: number
  endDay?: number
  location?: string
  description?: string
  rrule?: string
  attendees?: CalendarEventFields['attendees']
  organizer?: CalendarEventFields['organizer']
  alarms?: boolean
  transparent?: boolean
}

function seedCalendar(
  db: Database.Database,
  now: number,
  mailAccountId: number
): { tasksCal: number } {
  const accId = Number(
    db
      .prepare(
        `INSERT INTO cal_accounts (name, server_url, principal_url, home_url, username, mail_account_id,
           schedule_inbox_url, schedule_outbox_url, user_addresses, auto_schedule, dav_capabilities,
           state, last_sync, created_at)
         VALUES ('Acme Nextcloud', 'https://cloud.acme-corp.example/remote.php/dav',
           '/remote.php/dav/principals/users/nora/', 'https://cloud.acme-corp.example/remote.php/dav/calendars/nora/',
           ?, ?, '/remote.php/dav/calendars/nora/inbox/', 'https://cloud.acme-corp.example/remote.php/dav/calendars/nora/outbox/', ?, 1,
           '["calendar-access","calendar-auto-schedule","addressbook"]', 'idle', ?, ?)`
      )
      .run(DEMO_EMAIL, mailAccountId, JSON.stringify([DEMO_EMAIL]), now - 4 * 60_000, now)
      .lastInsertRowid
  )
  setSecret(calSecretKey(accId), 'demo-password')

  const mkCal = db.prepare(
    `INSERT INTO calendars (account_id, url, display_name, color, components, read_only, supports_sync, sort_order, color_user_set)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0)`
  )
  const base = 'https://cloud.acme-corp.example/remote.php/dav/calendars/nora/'
  const cal = (
    slug: string,
    name: string,
    color: string | null,
    comps: string,
    ro: number,
    order: number
  ): number =>
    Number(mkCal.run(accId, `${base}${slug}/`, name, color, comps, ro, order).lastInsertRowid)
  const work = cal('work', 'Work', '#2F5D8A', 'VEVENT', 0, 0)
  const personal = cal('personal', 'Personal', '#3F6B4F', 'VEVENT', 0, 1)
  const team = cal('team-holidays', 'Team holidays', '#B8791F', 'VEVENT', 1, 2)
  const tasksCal = cal('tasks', 'Tasks', '#6B4A8A', 'VTODO', 0, 3)
  db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('calendar.defaultCalendarId', ?)"
  ).run(String(work))

  let n = 0
  const mkCtx = (): EditContext => ({ now, newUid: () => `demo-${++n}@acme-corp.example` })
  const ws = weekStart(now)
  const att = (
    email: string,
    name: string,
    partstat: string,
    role = 'REQ-PARTICIPANT'
  ): CalendarEventFields['attendees'][number] => ({
    email,
    name,
    role,
    partstat,
    rsvp: partstat === 'NEEDS-ACTION',
    cutype: 'INDIVIDUAL'
  })
  const me = { email: DEMO_EMAIL, name: 'Nora Brandt' }

  const add = (calId: number, e: Ev): { objectId: number; ics: string; href: string } => {
    const dayMs = ws + e.day * DAY
    let time: CalendarEventFields['time']
    if (e.allDayDays) {
      time = {
        allDay: true,
        start: dayOf(dayMs),
        end: dayOf(dayMs + e.allDayDays * DAY + 3 * HOUR),
        tzid: null
      }
    } else {
      const [fh, fm] = (e.from ?? '09:00').split(':').map(Number)
      const [th, tm] = (e.to ?? '10:00').split(':').map(Number)
      const endDayMs = ws + (e.endDay ?? e.day) * DAY
      const mk = (ms: number, h: number, mi: number): string =>
        `${dayOf(ms)}T${pad(h)}:${pad(mi)}:00`
      time = { allDay: false, start: mk(dayMs, fh, fm), end: mk(endDayMs, th, tm), tzid: TZ }
    }
    const fields: CalendarEventFields = {
      summary: e.summary,
      location: e.location ?? null,
      description: e.description ?? null,
      time,
      rrule: e.rrule ?? null,
      status: null,
      transparency: e.transparent ? 'TRANSPARENT' : null,
      alarms: e.alarms
        ? [
            {
              action: 'DISPLAY',
              relativeTo: 'START',
              offsetSeconds: -900,
              absoluteUtc: null,
              description: null
            }
          ]
        : [],
      attendees: e.attendees ?? [],
      organizer: e.organizer ?? null
    }
    const { ics, uid } = createEventIcs(fields, mkCtx())
    const calRow = db.prepare('SELECT url FROM calendars WHERE id = ?').get(calId) as {
      url: string
    }
    const href = newObjectHref(calRow.url, uid)
    const objectId = upsertObject(db, { calendarId: calId, href, etag: `"demo-${n}"`, ics })
    return { objectId, ics, href }
  }

  // Wiederkehrend wöchentlich (Mo) mit Override in der Folgewoche
  const sync = add(work, {
    summary: 'Team sync',
    day: 0,
    from: '10:00',
    to: '10:45',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    location: 'Meeting room Lighthouse',
    alarms: true
  })
  const rid = db
    .prepare(
      'SELECT recurrence_id r FROM cal_instances WHERE object_id = ? ORDER BY start_utc LIMIT 2'
    )
    .all(sync.objectId) as Array<{ r: string | null }>
  const second = rid[1]?.r
  if (second) {
    const nextMon = ws + 7 * DAY
    const out = updateIcs(
      sync.ics,
      {
        scope: 'this',
        recurrenceId: second,
        patch: {
          summary: 'Team sync (moved)',
          time: {
            allDay: false,
            start: `${dayOf(nextMon)}T14:00:00`,
            end: `${dayOf(nextMon)}T14:45:00`,
            tzid: TZ
          }
        }
      },
      mkCtx()
    )
    upsertObject(db, { calendarId: work, href: sync.href, etag: '"demo-sync"', ics: out.ics })
  }

  // Heute: nächste Termine (für die Rail-Agenda), relativ zu „jetzt"
  const today = (new Date(now).getDay() + 6) % 7
  const nextHour = new Date(now)
  nextHour.setMinutes(0, 0, 0)
  const h0 = Math.min(nextHour.getHours() + 1, 20)
  add(work, {
    summary: 'Sprint planning',
    day: today,
    from: `${pad(h0)}:00`,
    to: `${pad(h0 + 1)}:30`,
    location: 'Zoom',
    alarms: true
  })
  add(personal, {
    summary: 'Dentist',
    day: today,
    from: `${pad(Math.min(h0 + 3, 21))}:00`,
    to: `${pad(Math.min(h0 + 3, 21))}:45`,
    location: 'Dr. Albrecht, Hafenstr. 12'
  })

  // Dienstag: drei überlappende Termine
  add(work, { summary: 'Design review', day: 1, from: '10:00', to: '11:30', location: 'Room 2.04' })
  add(work, {
    summary: 'Customer call: Nordwind',
    day: 1,
    from: '10:30',
    to: '12:00',
    location: 'Zoom'
  })
  add(personal, {
    summary: 'Lunch with Sven',
    day: 1,
    from: '12:15',
    to: '13:15',
    location: 'Cafe Seeblick',
    transparent: true
  })
  add(work, { summary: '1:1 Anna', day: 1, from: '11:00', to: '11:45' })

  // Mittwoch: Teilnehmer, ganztägig
  add(work, {
    summary: 'Quarterly planning',
    day: 2,
    from: '14:00',
    to: '15:30',
    location: 'Boardroom',
    description: 'Review Q3 results, agree on priorities for Q4. Slides are in the shared folder.',
    organizer: me,
    attendees: [
      att(DEMO_EMAIL, 'Nora Brandt', 'ACCEPTED'),
      att('jonas.weber@acme-corp.example', 'Jonas Weber', 'ACCEPTED'),
      att('lena.fischer@acme-corp.example', 'Lena Fischer', 'TENTATIVE'),
      att('priya.nair@acme-partners.example', 'Priya Nair', 'NEEDS-ACTION'),
      att('marta.lindqvist@acme-partners.example', 'Marta Lindqvist', 'DECLINED', 'OPT-PARTICIPANT')
    ],
    alarms: true
  })
  add(personal, { summary: "Anna's birthday", day: 2, allDayDays: 1 })

  // Donnerstag bis Samstag: mehrtägig ganztägig + Konflikt mit der Einladung (Do 15:00)
  add(work, { summary: 'Team offsite', day: 3, allDayDays: 3, location: 'Lakeside Lodge' })
  add(work, {
    summary: 'Workshop: onboarding flow',
    day: 3,
    from: '14:30',
    to: '16:00',
    location: 'Room 3.01'
  })
  // Freitag Nacht über Mitternacht
  add(work, {
    summary: 'Release night',
    day: 4,
    from: '22:00',
    to: '01:30',
    endDay: 5,
    location: 'On call'
  })
  add(team, { summary: 'Public holiday (Berlin)', day: 7 + 4, allDayDays: 1 })
  // Nächste Wochen für die Monatsansicht
  add(work, { summary: 'Board meeting', day: 9, from: '09:00', to: '12:00', location: 'HQ' })
  add(personal, { summary: 'Train to Hamburg', day: 12, from: '08:12', to: '11:40' })
  add(work, { summary: 'Product demo', day: 15, from: '16:00', to: '17:00' })
  add(personal, { summary: 'Vacation', day: 18, allDayDays: 4 })
  add(work, { summary: 'Retro', day: 16, from: '15:00', to: '16:00' })
  add(work, { summary: 'Hiring panel', day: 20, from: '13:00', to: '14:30' })
  add(work, { summary: 'Budget review', day: 22, from: '10:00', to: '11:00' })
  return { tasksCal }
}

// --- Aufgaben --------------------------------------------------------------------------------

function seedTasks(db: Database.Database, now: number, accountId: number, tasksCal: number): void {
  const budget = db.prepare("SELECT id FROM messages WHERE subject LIKE 'Q4 budget%'").get() as
    { id: number } | undefined
  const ins = db.prepare(
    `INSERT INTO tasks (source_kind, source_id, account_id, title, notes, due_date, status, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const rows: Array<{
    id: number
    title: string
    notes: string | null
    due: string | null
    status: string
  }> = []
  const add = (
    kind: 'mail' | 'manual',
    src: number | null,
    title: string,
    notes: string | null,
    due: string | null,
    status = 'open'
  ): number => {
    const id = Number(
      ins.run(
        kind,
        src,
        kind === 'mail' ? accountId : null,
        title,
        notes,
        due,
        status,
        now - HOUR,
        status === 'done' ? now - 30 * 60_000 : null
      ).lastInsertRowid
    )
    rows.push({ id, title, notes, due, status })
    return id
  }
  const day = (n: number): string => dayOf(now + n * DAY)
  add(
    'mail',
    budget?.id ?? null,
    'Review Q4 budget draft (marketing + contractors)',
    'Aus: Q4 budget draft: please review by Friday',
    day(3)
  )
  add('manual', null, 'Book train tickets for the offsite', null, day(1))
  add('manual', null, 'Send dietary requirements to Lena', 'Vegetarian, no nuts', day(2))
  add('manual', null, 'Renew parking permit', null, day(-1))
  add(
    'manual',
    null,
    'Prepare slides for quarterly planning',
    'Include the Q3 retro numbers',
    day(2)
  )
  add('manual', null, 'Order notebooks for the team', null, null)
  add('manual', null, 'Reply to Sven about climbing', null, null, 'done')

  // Zweiweg-Abgleich: gewählte Liste + Zuordnungen (synced / pending / conflict)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tasks.caldavCalendar', ?)").run(
    String(tasksCal)
  )
  const calRow = db.prepare('SELECT url FROM calendars WHERE id = ?').get(tasksCal) as {
    url: string
  }
  const map = db.prepare(
    `INSERT INTO task_caldav (task_id, calendar_id, uid, synced_hash, synced_etag, last_synced) VALUES (?, ?, ?, ?, ?, ?)`
  )
  const link = (idx: number, mode: 'synced' | 'pending' | 'conflict'): void => {
    const r = rows[idx]
    const uid = taskUid(r.id)
    const fields = { title: r.title, notes: r.notes, due: r.due, done: r.status === 'done' }
    const ics = buildTodoIcs(uid, fields, { now })
    upsertObject(db, {
      calendarId: tasksCal,
      href: newObjectHref(calRow.url, uid),
      etag: `"todo-${r.id}"`,
      ics
    })
    if (mode === 'pending') {
      // lokal geändert, Server-Stand älter → Hash weicht ab
      map.run(
        r.id,
        tasksCal,
        uid,
        fieldsHash({ ...fields, title: r.title + ' (old)' }),
        `"todo-${r.id}"`,
        now - HOUR
      )
    } else {
      map.run(r.id, tasksCal, uid, fieldsHash(fields), `"todo-${r.id}"`, now - 10 * 60_000)
    }
    if (mode === 'conflict') {
      db.prepare(
        `INSERT INTO cal_pending_ops (account_id, calendar_id, object_id, kind, href, uid, base_etag, summary, status, attempts, last_error, created_at)
         VALUES ((SELECT account_id FROM calendars WHERE id = ?), ?, NULL, 'update', ?, ?, NULL, ?, 'dead', 1, 'conflict', ?)`
      ).run(tasksCal, tasksCal, newObjectHref(calRow.url, uid), uid, r.title, now - 5 * 60_000)
    }
  }
  link(0, 'synced')
  link(1, 'synced')
  link(2, 'pending')
  link(4, 'conflict')
  link(6, 'synced')
}

// --- Kontakte --------------------------------------------------------------------------------

function seedContacts(db: Database.Database, now: number): void {
  const acc = (db.prepare('SELECT id FROM cal_accounts LIMIT 1').get() as { id: number }).id
  db.prepare(
    'INSERT OR REPLACE INTO contacts_accounts (account_id, enabled, home_url, error, last_sync) VALUES (?, 1, ?, NULL, ?)'
  ).run(
    acc,
    'https://cloud.acme-corp.example/remote.php/dav/addressbooks/users/nora/',
    now - 4 * 60_000
  )
  const mkBook = db.prepare(
    'INSERT INTO addressbooks (account_id, url, display_name, supports_sync, enabled, last_sync) VALUES (?, ?, ?, 1, ?, ?)'
  )
  const contacts = Number(
    mkBook.run(
      acc,
      'https://cloud.acme-corp.example/remote.php/dav/addressbooks/users/nora/contacts/',
      'Contacts',
      1,
      now - 4 * 60_000
    ).lastInsertRowid
  )
  mkBook.run(
    acc,
    'https://cloud.acme-corp.example/remote.php/dav/addressbooks/users/nora/team/',
    'Team directory',
    0,
    null
  )
  const people: Array<[string, string, string]> = [
    ['Marta Lindqvist', 'marta.lindqvist@acme-partners.example', 'Acme Partners'],
    ['Priya Nair', 'priya.nair@acme-partners.example', 'Acme Partners'],
    ['Jonas Weber', 'jonas.weber@acme-corp.example', 'Acme Corp'],
    ['Lena Fischer', 'lena.fischer@acme-corp.example', 'Acme Corp'],
    ['Mara Hoffmann', 'mara.hoffmann@acme-corp.example', 'Acme Corp'],
    ['Matteo Rossi', 'matteo.rossi@acme-partners.example', 'Acme Partners']
  ]
  people.forEach(([name, mail, org], i) => {
    const [given, ...rest] = name.split(' ')
    upsertContact(db, {
      addressBookId: contacts,
      href: `c${i}.vcf`,
      etag: `"c${i}"`,
      vcard: `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c${i}\r\nFN:${name}\r\nN:${rest.join(' ')};${given};;;\r\nORG:${org}\r\nEMAIL;TYPE=WORK:${mail}\r\nEND:VCARD\r\n`
    })
  })
}

// --- AI-Profile ------------------------------------------------------------------------------

function seedAi(): void {
  setProfileKey('openrouter', 'sk-or-demo-0000')
  const ollama = createProfile({
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    apiStyle: 'chat',
    isLocal: true
  })
  setTaskAssignment('triage', ollama.id, 'llama3.1:8b')
  setTaskAssignment('draft', 'openrouter', 'anthropic/claude-sonnet-4.6')
}

// --- Einstieg --------------------------------------------------------------------------------

export async function seedDemoData(db: Database.Database): Promise<void> {
  if (!isDev) return
  installDemoFreeBusy()
  const lang = process.env.NOCTUA_DEMO_LANG === 'de' ? 'de' : 'en'
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(DEMO_EMAIL) as
    { id: number } | undefined
  if (!existing) {
    const now = Date.now()
    const mailAcc = await seedMail(db, now)
    const { tasksCal } = seedCalendar(db, now, mailAcc)
    seedTasks(db, now, mailAcc, tasksCal)
    seedContacts(db, now)
    seedAi()
    if (process.env.NOCTUA_DEMO_ONBOARDING === '1') {
      // Onboarding-Pass: Flow „läuft bereits" (Konto vorhanden, nicht abgeschlossen) → Schritt 2
      set.run('noctua.onboardingStarted', '1')
    } else {
      set.run('noctua.onboarded', '1')
    }
    console.log('[demo] Demo-Daten angelegt')
  }
  set.run('ui.language', lang)
  // Local only: pro Lauf wählbar (Zustand ändert sich auch auf bestehender DB)
  setLocalOnly(process.env.NOCTUA_DEMO_LOCAL_ONLY === '1')
}

// --- Demo-Free/Busy -----------------------------------------------------------------------------

/**
 * Der Demo-Server (kein Netz) beantwortet Free/Busy-Anfragen an die Scheduling-Outbox mit
 * festen Mustern je Teilnehmer, damit der Verfügbarkeitsstreifen im Editor etwas zeigt.
 * Marta (Partnerfirma) liefert bewusst keine Auskunft.
 */
const DEMO_BUSY: Record<string, Array<[number, number, number[]?]>> = {
  // [von, bis, Wochentage (0=So) — leer = alle Arbeitstage]
  'jonas.weber@acme-corp.example': [
    [9, 10.5],
    [13, 14, [1, 3, 5]]
  ],
  'lena.fischer@acme-corp.example': [
    [10, 12, [1, 3]],
    [14.5, 16, [3]],
    [15, 17, [2, 4]]
  ],
  'priya.nair@acme-partners.example': [
    [8.5, 9.5],
    [11, 12, [3]],
    [16, 18, [1, 2, 3, 4]]
  ]
}

function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}

function demoScheduleResponse(recipients: string[], rangeStart: number, rangeEnd: number): string {
  const parts: string[] = []
  for (const email of recipients) {
    const periods: string[] = []
    const blocks = DEMO_BUSY[email]
    if (blocks) {
      const days = Math.ceil((rangeEnd - rangeStart) / 86_400_000)
      for (let d = 0; d < days; d++) {
        const day = new Date(rangeStart + d * 86_400_000)
        const wd = day.getDay()
        if (wd === 0 || wd === 6) continue
        for (const [from, to, only] of blocks) {
          if (only && !only.includes(wd)) continue
          const a = rangeStart + d * 86_400_000 + from * 3_600_000
          const b = rangeStart + d * 86_400_000 + to * 3_600_000
          periods.push(`FREEBUSY;FBTYPE=BUSY:${icsUtc(a)}/${icsUtc(b)}`)
        }
      }
      parts.push(`<C:response><C:recipient><D:href>mailto:${email}</D:href></C:recipient>
<C:request-status>2.0;Success</C:request-status>
<C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
METHOD:REPLY
BEGIN:VFREEBUSY
DTSTAMP:${icsUtc(Date.now())}
DTSTART:${icsUtc(rangeStart)}
DTEND:${icsUtc(rangeEnd)}
ATTENDEE:mailto:${email}
${periods.join('\n')}
END:VFREEBUSY
END:VCALENDAR
</C:calendar-data></C:response>`)
    } else {
      parts.push(`<C:response><C:recipient><D:href>mailto:${email}</D:href></C:recipient>
<C:request-status>3.7;Invalid Calendar User</C:request-status></C:response>`)
    }
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<C:schedule-response xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
${parts.join('\n')}
</C:schedule-response>`
}

export function installDemoFreeBusy(): void {
  if (!isDev) return
  setFreeBusyDeps({
    getPassword: () => 'demo-password',
    fetch: async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      const recipients = (headers['Recipient'] ?? '')
        .split(',')
        .map((r) =>
          r
            .trim()
            .replace(/^mailto:/i, '')
            .toLowerCase()
        )
        .filter(Boolean)
      const body = typeof init?.body === 'string' ? init.body : ''
      const ts = (name: string): number => {
        const m = new RegExp(`${name}:(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z`).exec(
          body
        )
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0
      }
      return new Response(demoScheduleResponse(recipients, ts('DTSTART'), ts('DTEND')), {
        status: 200,
        headers: { 'Content-Type': 'application/xml' }
      })
    }
  })
}
