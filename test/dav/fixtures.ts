/**
 * Handgebaute, an echten Servern orientierte Antworten (Nextcloud/sabre,
 * Radicale, iCloud). Namespace-Präfixe unterscheiden sich bewusst je Server.
 */

export const NEXTCLOUD_HOME_LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns" xmlns:x1="http://apple.com/ns/ical/">
 <d:response>
  <d:href>/remote.php/dav/calendars/anna/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  <d:propstat><d:prop><d:displayname/><x1:calendar-color/><cal:supported-calendar-component-set/><cs:getctag/><d:sync-token/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/calendars/anna/personal/</d:href>
  <d:propstat><d:prop>
   <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
   <d:displayname>Persönlich</d:displayname>
   <x1:calendar-color>#0082c9</x1:calendar-color>
   <x1:calendar-order>0</x1:calendar-order>
   <cal:supported-calendar-component-set><cal:comp name="VEVENT"/><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
   <cs:getctag>http://sabre.io/ns/sync/42</cs:getctag>
   <d:sync-token>http://sabre.io/ns/sync/42</d:sync-token>
   <d:current-user-privilege-set><d:privilege><d:all/></d:privilege><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>
   <d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report><d:supported-report><d:report><cal:calendar-multiget/></d:report></d:supported-report></d:supported-report-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/calendars/anna/team%20kalender/</d:href>
  <d:propstat><d:prop>
   <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
   <d:displayname>Team</d:displayname>
   <x1:calendar-color>#FF7F00FF</x1:calendar-color>
   <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
   <cs:getctag>http://sabre.io/ns/sync/7</cs:getctag>
   <d:sync-token>http://sabre.io/ns/sync/7</d:sync-token>
   <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
   <d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report></d:supported-report-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/calendars/anna/inbox/</d:href>
  <d:propstat><d:prop><d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/calendars/anna/contact_birthdays/</d:href>
  <d:propstat><d:prop>
   <d:resourcetype><d:collection/><cal:calendar/><cs:subscribed/></d:resourcetype>
   <d:displayname>Geburtstage</d:displayname>
   <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
 <d:response>
  <d:href>/remote.php/dav/calendars/anna/notes-only/</d:href>
  <d:propstat><d:prop>
   <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
   <cal:supported-calendar-component-set><cal:comp name="VJOURNAL"/></cal:supported-calendar-component-set>
  </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
 </d:response>
</d:multistatus>`

export const RADICALE_HOME_LISTING = `<?xml version='1.0' encoding='utf-8'?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:ICAL="http://apple.com/ns/ical/">
<response><href>/bob/</href><propstat><prop><resourcetype><collection /></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/bob/9a1f0c3e-calendar/</href><propstat><prop>
<resourcetype><collection /><C:calendar /></resourcetype>
<displayname>Arbeit</displayname>
<ICAL:calendar-color>#e8710a</ICAL:calendar-color>
<C:supported-calendar-component-set><C:comp name="VEVENT" /><C:comp name="VTODO" /><C:comp name="VJOURNAL" /></C:supported-calendar-component-set>
<CS:getctag>"a1b2c3"</CS:getctag>
<sync-token>http://radicale.org/ns/sync/9f8e7d</sync-token>
</prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`

export const ICLOUD_HOME_LISTING = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/">
<response><href>/1234567/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>https://p01-caldav.icloud.com:443/1234567/calendars/home/</href><propstat><prop>
<resourcetype><collection/><cal:calendar/></resourcetype>
<displayname>Privat</displayname>
<ical:calendar-color symbolic-color="blue">#1BADF8FF</ical:calendar-color>
<cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
<cs:getctag>FT=-@RU=aa1f@S=12</cs:getctag>
<sync-token>data:,12</sync-token>
<current-user-privilege-set><privilege><read/></privilege><privilege><write-content/></privilege><privilege><bind/></privilege></current-user-privilege-set>
<supported-report-set><supported-report><report><sync-collection/></report></supported-report></supported-report-set>
</prop><status>HTTP/1.1 200 OK</status></propstat></response>
<response><href>/1234567/calendars/inbox/</href><propstat><prop><resourcetype><collection/><cal:schedule-inbox/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
</multistatus>`

export const SYNC_COLLECTION_RESPONSE = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
 <d:response><d:href>/remote.php/dav/calendars/anna/personal/new%40event.ics</d:href><d:propstat><d:prop><d:getetag>"etag-new"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/calendars/anna/personal/gone.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>
 <d:sync-token>http://sabre.io/ns/sync/43</d:sync-token>
</d:multistatus>`

export const EVIL_XXE = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>&xxe;</d:href></d:response></d:multistatus>`

export function ics(opts: {
  uid: string
  summary: string
  dtstart: string
  dtend?: string
  extra?: string
  tz?: boolean
}): string {
  const tz = opts.tz
    ? `BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
`
    : ''
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
${tz}BEGIN:VEVENT
UID:${opts.uid}
DTSTAMP:20250101T000000Z
SUMMARY:${opts.summary}
${opts.dtstart}
${opts.dtend ?? ''}
${opts.extra ?? ''}
END:VEVENT
END:VCALENDAR
`
    .split('\n')
    .filter((l) => l !== '')
    .join('\r\n')
    .concat('\r\n')
}
