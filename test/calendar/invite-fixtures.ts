/**
 * Realistische iMIP-Fixtures im Stil von Nextcloud (sabre), Exchange/Outlook,
 * Google Calendar und Apple Kalender. Handgebaut nach beobachteten Mails.
 */
const crlf = (lines: string[]): string => `${lines.join('\r\n')}\r\n`

const BERLIN_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
]

/** Nextcloud: REQUEST, Europe/Berlin, 20.10.2026 10:00–11:00 Ortszeit (08:00Z). */
export const nextcloudRequest = crlf([
  'BEGIN:VCALENDAR',
  'PRODID:-//Sabre//Sabre VObject 4.5.4//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'CALSCALE:GREGORIAN',
  ...BERLIN_VTIMEZONE,
  'BEGIN:VEVENT',
  'UID:6f1c2a1e-nc-0001@cloud.example.org',
  'DTSTAMP:20261001T080000Z',
  'SEQUENCE:0',
  'SUMMARY:Projekt-Kickoff',
  'LOCATION:Raum 4.12\\, Hauptstraße 1',
  'DESCRIPTION:Agenda: Ziele\\nund Termine. Siehe https://wiki.example.org/kick',
  'DTSTART;TZID=Europe/Berlin:20261020T100000',
  'DTEND;TZID=Europe/Berlin:20261020T110000',
  'ORGANIZER;CN=Alice Organizer:mailto:alice@cloud.example.org',
  'ATTENDEE;CN=Alice Organizer;PARTSTAT=ACCEPTED;ROLE=CHAIR:mailto:alice@cloud.example.org',
  'ATTENDEE;CN=Bob Mensch;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL:mailto:bob@mail.example.com',
  'ATTENDEE;CN=Carla;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:carla@mail.example.com',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Exchange/Outlook: Windows-Zonenname als TZID, mit VTIMEZONE. 21.10.2026 14:00–15:30 (12:00Z). */
export const outlookRequest = crlf([
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'ORGANIZER;CN="Dr. Dieter Chef":MAILTO:dieter.chef@corp.example.com',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Bob Mensch":MAILTO:bob@mail.example.com',
  'ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Eva":MAILTO:eva@corp.example.com',
  'DESCRIPTION;LANGUAGE=de-DE:Teams-Besprechung\\n\\nhttps://teams.microsoft.com/l/meetup-join/xyz',
  'UID:040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5A6B7',
  'SUMMARY;LANGUAGE=de-DE:Quartalsplanung',
  'DTSTART;TZID=W. Europe Standard Time:20261021T140000',
  'DTEND;TZID=W. Europe Standard Time:20261021T153000',
  'CLASS:PUBLIC',
  'PRIORITY:5',
  'DTSTAMP:20261002T101500Z',
  'TRANSP:OPAQUE',
  'STATUS:CONFIRMED',
  'SEQUENCE:3',
  'LOCATION;LANGUAGE=de-DE:Microsoft Teams-Besprechung',
  'X-MICROSOFT-CDO-APPT-SEQUENCE:3',
  'X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE',
  'X-MICROSOFT-CDO-ALLDAYEVENT:FALSE',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Exchange ohne VTIMEZONE, nur der Windows-Name (kommt bei Outlook-Web vor). */
export const outlookNoVtimezone = crlf([
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'ORGANIZER;CN=Chef:MAILTO:chef@corp.example.com',
  'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Bob:MAILTO:bob@mail.example.com',
  'UID:outlook-novtz-1',
  'SUMMARY:Sync',
  'DTSTART;TZID=Pacific Standard Time:20261021T090000',
  'DTEND;TZID=Pacific Standard Time:20261021T093000',
  'DTSTAMP:20261002T101500Z',
  'SEQUENCE:0',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Google Calendar: UTC-Zeiten, wiederkehrend (jeden Dienstag), X-Parameter an ATTENDEE. */
export const googleRequest = crlf([
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20261006T130000Z',
  'DTEND:20261006T133000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'DTSTAMP:20261003T120000Z',
  'ORGANIZER;CN=Gina Google:mailto:gina@gmail.example.com',
  'UID:abcdefghijklmnop1234567890@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN=Gina Google;X-NUM-GUESTS=0:mailto:gina@gmail.example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=bob@mail.example.com;X-NUM-GUESTS=0:mailto:bob@mail.example.com',
  'X-MICROSOFT-CDO-OWNERAPPTID:2118000000',
  'CREATED:20261001T090000Z',
  'DESCRIPTION:Weekly sync\\n\\nJoin: https://meet.google.com/abc-defg-hij',
  'LAST-MODIFIED:20261003T120000Z',
  'LOCATION:Google Meet',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Weekly Sync',
  'TRANSP:OPAQUE',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Apple Kalender: ganztägig, EMAIL-Parameter, X-APPLE-Properties. */
export const appleAllDayRequest = crlf([
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'CREATED:20261001T100000Z',
  'DTEND;VALUE=DATE:20261105',
  'DTSTAMP:20261001T100000Z',
  'DTSTART;VALUE=DATE:20261103',
  'LAST-MODIFIED:20261001T100000Z',
  'ORGANIZER;CN=Anton Apfel;EMAIL=anton@icloud.example.com:mailto:anton@icloud.example.com',
  'ATTENDEE;CN=Bob Mensch;CUTYPE=INDIVIDUAL;EMAIL=bob@mail.example.com;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:bob@mail.example.com',
  'SEQUENCE:0',
  'SUMMARY:Offsite',
  'UID:APPLE-UID-7C1F-0042',
  'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Einzelnes Vorkommen einer Serie (RECURRENCE-ID), Exchange. */
export const outlookOccurrenceRequest = crlf([
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'ORGANIZER;CN=Chef:MAILTO:chef@corp.example.com',
  'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Bob:MAILTO:bob@mail.example.com',
  'UID:series-uid-99',
  'RECURRENCE-ID:20261027T090000Z',
  'SUMMARY:Daily (verschoben)',
  'DTSTART:20261027T110000Z',
  'DTEND:20261027T113000Z',
  'DTSTAMP:20261002T101500Z',
  'SEQUENCE:1',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Outlook CANCEL. */
export const outlookCancel = crlf([
  'BEGIN:VCALENDAR',
  'METHOD:CANCEL',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'ORGANIZER;CN="Dr. Dieter Chef":MAILTO:dieter.chef@corp.example.com',
  'ATTENDEE;CN="Bob Mensch":MAILTO:bob@mail.example.com',
  'UID:040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5A6B7',
  'SUMMARY:Abgesagt: Quartalsplanung',
  'DTSTART:20261021T120000Z',
  'DTEND:20261021T133000Z',
  'DTSTAMP:20261005T080000Z',
  'STATUS:CANCELLED',
  'SEQUENCE:4',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Nextcloud/Google REPLY von Bob (Zusage) auf unseren Termin. */
export const bobAcceptReply = (uid: string, sequence = 0, rid?: string): string =>
  crlf([
    'BEGIN:VCALENDAR',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'VERSION:2.0',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    'DTSTAMP:20261006T080000Z',
    'ORGANIZER;CN=Me Myself:mailto:me@mail.example.com',
    `UID:${uid}`,
    ...(rid ? [`RECURRENCE-ID:${rid}`] : []),
    'ATTENDEE;PARTSTAT=ACCEPTED;CN=Bob Mensch:mailto:bob@partner.example.net',
    `SEQUENCE:${sequence}`,
    'SUMMARY:Planung',
    'END:VEVENT',
    'END:VCALENDAR'
  ])

/** Outlook COUNTER (Gegenvorschlag). */
export const outlookCounter = crlf([
  'BEGIN:VCALENDAR',
  'METHOD:COUNTER',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'ORGANIZER;CN=Me:MAILTO:me@mail.example.com',
  'ATTENDEE;CN=Bob;PARTSTAT=TENTATIVE:MAILTO:bob@partner.example.net',
  'UID:counter-uid-1',
  'SUMMARY:Planung',
  'DTSTART:20261022T130000Z',
  'DTEND:20261022T140000Z',
  'DTSTAMP:20261006T080000Z',
  'SEQUENCE:0',
  'COMMENT:Passt Donnerstag besser?',
  'END:VEVENT',
  'END:VCALENDAR'
])

/** Kompletter Roh-Mail-Text mit text/calendar-Alternative (Exchange-Stil). */
export const rawInviteMail = (ics: string, method = 'REQUEST'): string =>
  [
    'From: Dieter Chef <dieter.chef@corp.example.com>',
    'To: bob@mail.example.com',
    'Subject: Einladung: Quartalsplanung',
    'Message-ID: <inv-1@corp.example.com>',
    'Date: Fri, 02 Oct 2026 10:15:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Sie wurden eingeladen.',
    '--b1',
    `Content-Type: text/calendar; charset="utf-8"; method=${method}`,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(ics)
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n'),
    '--b1--',
    ''
  ].join('\r\n')
