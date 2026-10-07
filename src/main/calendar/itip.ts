import ICAL from 'ical.js'
import type { CalendarAttendee } from '@shared/calendar-types'
import { makeTimeProp, updateIcs, defaultEditContext, type EditContext } from './edit'
import {
  eventTimes,
  mailtoAddress,
  parseCalendar,
  PRODID,
  readAttendees,
  readTime,
  recurrenceIdOf,
  serializeCalendar,
  splitComponents,
  vtimezonesOf,
  wallToDateString
} from './ics'

/**
 * iTIP/iMIP (RFC 5546/6047): eingehende Einladungen parsen, Antworten
 * (REPLY) und Organisator-Nachrichten (REQUEST/CANCEL) erzeugen, Free/Busy
 * lesen. Reine Funktionen ohne DB/Netz. Eingehende Daten sind nicht
 * vertrauenswürdig: Größen werden begrenzt, Text bleibt Klartext.
 */

export const MAX_ICS_BYTES = 256 * 1024
const MAX_ATTENDEES = 500
const MAX_SUMMARY = 1000
const MAX_LOCATION = 1000
const MAX_DESCRIPTION = 5000

export type ItipMethod =
  'REQUEST' | 'CANCEL' | 'REPLY' | 'COUNTER' | 'DECLINECOUNTER' | 'ADD' | 'REFRESH' | 'PUBLISH'

const KNOWN_METHODS = new Set<string>([
  'REQUEST',
  'CANCEL',
  'REPLY',
  'COUNTER',
  'DECLINECOUNTER',
  'ADD',
  'REFRESH',
  'PUBLISH'
])

export type Partstat = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'

export interface ItipMessage {
  method: ItipMethod
  uid: string
  sequence: number
  /** DTSTAMP (UTC ms) */
  dtstamp: number | null
  organizer: { email: string; name: string | null } | null
  summary: string | null
  location: string | null
  /** Klartext, gekürzt */
  description: string | null
  startUtc: number | null
  endUtc: number | null
  allDay: boolean
  startDay: string | null
  endDay: string | null
  tzid: string | null
  rrule: string | null
  /** Kanonische Vorkommens-ID (siehe ics.ts), null = ganze Serie / Einzeltermin */
  recurrenceId: string | null
  status: string | null
  attendees: CalendarAttendee[]
  /** Roh-ICS (begrenzt) */
  ics: string
}

function str(comp: ICAL.Component, name: string, max: number): string | null {
  const v = comp.getFirstPropertyValue(name)
  if (typeof v !== 'string') return null
  const t = v.replaceAll(String.fromCharCode(0), '').trim()
  return t === '' ? null : t.slice(0, max)
}

/** Komponente, die die Einladung beschreibt: Stamm, sonst erste Ausnahme. */
function pickComponent(root: ICAL.Component): ICAL.Component | null {
  const { master, overrides } = splitComponents(root, 'vevent')
  return master ?? overrides[0] ?? null
}

function icsTimeMs(
  prop: ICAL.Property | null,
  vtz: ReturnType<typeof vtimezonesOf>
): number | null {
  const info = readTime(prop, vtz)
  return info ? info.utcMs : null
}

/**
 * Parst ein iTIP-Objekt. `methodHint` = method-Parameter des MIME-Teils (nur
 * Rückfall, wenn das ICS selbst kein METHOD trägt). null bei Unbrauchbarem
 * (kein VEVENT, keine UID, zu groß, kaputt).
 */
export function parseItip(text: string, methodHint?: string | null): ItipMessage | null {
  if (text.length > MAX_ICS_BYTES) return null
  let root: ICAL.Component
  try {
    root = parseCalendar(text)
  } catch {
    return null
  }
  try {
    const comp = pickComponent(root)
    if (!comp) return null
    const uid = str(comp, 'uid', 500)
    if (!uid) return null
    const rawMethod = String(root.getFirstPropertyValue('method') ?? methodHint ?? '')
      .trim()
      .toUpperCase()
    if (!KNOWN_METHODS.has(rawMethod)) return null
    const vtz = vtimezonesOf(root)
    const times = eventTimes(comp, vtz)
    const dtstampProp = comp.getFirstProperty('dtstamp')
    const orgProp = comp.getFirstProperty('organizer')
    const orgEmail = orgProp ? mailtoAddress(orgProp.getFirstValue()) : null
    const cn = orgProp?.getParameter('cn')
    const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0)
    const ridProp = comp.getFirstProperty('recurrence-id')
    const rid = ridProp ? readTime(ridProp, vtz) : null
    const rrule = comp.getFirstPropertyValue('rrule')
    return {
      method: rawMethod as ItipMethod,
      uid,
      sequence: Number.isFinite(seq) && seq >= 0 ? Math.floor(seq) : 0,
      dtstamp: icsTimeMs(dtstampProp, vtz),
      organizer: orgEmail
        ? { email: orgEmail, name: typeof cn === 'string' && cn !== '' ? cn.slice(0, 200) : null }
        : null,
      summary: str(comp, 'summary', MAX_SUMMARY),
      location: str(comp, 'location', MAX_LOCATION),
      description: str(comp, 'description', MAX_DESCRIPTION),
      startUtc: times?.start.utcMs ?? null,
      endUtc: times?.endUtc ?? null,
      allDay: times?.start.allDay ?? false,
      startDay: times?.start.allDay ? wallToDateString(times.start.wall) : null,
      endDay: times?.endDay ?? null,
      tzid: times?.start.tzid ?? null,
      rrule: rrule instanceof ICAL.Recur ? rrule.toString().slice(0, 500) : null,
      recurrenceId: rid ? recurrenceIdOf(rid) : null,
      status: str(comp, 'status', 30)?.toUpperCase() ?? null,
      attendees: readAttendees(comp).slice(0, MAX_ATTENDEES),
      ics: text
    }
  } catch {
    return null
  }
}

/** Positiv, wenn `a` neuer ist als `b` (höhere SEQUENCE, bei Gleichstand späterer DTSTAMP). */
export function compareRevision(
  a: { sequence: number; dtstamp: number | null },
  b: { sequence: number; dtstamp: number | null }
): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence
  return (a.dtstamp ?? 0) - (b.dtstamp ?? 0)
}

/** Das ATTENDEE-Objekt des Nutzers (erste passende Adresse), sonst undefined. */
export function findMyAttendee(
  attendees: readonly CalendarAttendee[],
  myAddresses: ReadonlySet<string>
): CalendarAttendee | undefined {
  return attendees.find((a) => myAddresses.has(a.email.toLowerCase()))
}

// --- Kleine ICS-Bausteine ----------------------------------------------------------------

function cloneComp(comp: ICAL.Component): ICAL.Component {
  return new ICAL.Component(JSON.parse(JSON.stringify(comp.toJSON())))
}

function utcValue(ms: number): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(Math.floor(ms / 1000) * 1000), true)
}

function newCalendar(method: string | null): ICAL.Component {
  const root = new ICAL.Component(['vcalendar', [], []])
  root.addPropertyWithValue('version', '2.0')
  root.addPropertyWithValue('prodid', PRODID)
  if (method) root.addPropertyWithValue('method', method)
  return root
}

function mailto(email: string): string {
  return `mailto:${email}`
}

/** Zeitwert einer Quellkomponente als UTC-/Datums-Property (ohne VTIMEZONE-Bedarf). */
function portableTimeProp(
  name: string,
  src: ICAL.Property | null,
  vtz: ReturnType<typeof vtimezonesOf>
): ICAL.Property | null {
  const info = readTime(src, vtz)
  if (!info) return null
  if (info.allDay) return makeTimeProp(name, true, info.wall, null)
  const d = new Date(info.utcMs)
  return makeTimeProp(
    name,
    false,
    {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      mi: d.getUTCMinutes(),
      s: d.getUTCSeconds()
    },
    'UTC'
  )
}

// --- REPLY (Teilnehmer → Organisator) -----------------------------------------------------------

export interface ReplyOptions {
  attendeeEmail: string
  attendeeName: string | null
  partstat: Partstat
  comment?: string | null
  now: number
}

/**
 * METHOD:REPLY nach RFC 5546 §3.2.3: genau EIN ATTENDEE (der Nutzer) mit dem
 * neuen PARTSTAT, ORGANIZER, UID, DTSTAMP, SEQUENCE der Einladung und — bei
 * einer Einzeleinladung zu einem Vorkommen — RECURRENCE-ID. Zeiten gehen in
 * UTC raus, damit kein VTIMEZONE mitgeschickt werden muss.
 */
export function buildReplyIcs(sourceIcs: string, opts: ReplyOptions): string {
  const src = parseCalendar(sourceIcs)
  const vtz = vtimezonesOf(src)
  const comp = pickComponent(src)
  if (!comp) throw new Error('Kein VEVENT in der Einladung')
  const root = newCalendar('REPLY')
  const ev = new ICAL.Component('vevent')
  ev.addPropertyWithValue('uid', String(comp.getFirstPropertyValue('uid')))
  ev.addPropertyWithValue('dtstamp', utcValue(opts.now))
  const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0)
  ev.addPropertyWithValue('sequence', Number.isFinite(seq) ? seq : 0)
  const srcOrg = comp.getFirstProperty('organizer')
  if (srcOrg) {
    const org = new ICAL.Property('organizer')
    org.setValue(String(srcOrg.getFirstValue()))
    const cn = srcOrg.getParameter('cn')
    if (typeof cn === 'string' && cn) org.setParameter('cn', cn)
    ev.addProperty(org)
  }
  const att = new ICAL.Property('attendee')
  att.setValue(mailto(opts.attendeeEmail))
  if (opts.attendeeName) att.setParameter('cn', opts.attendeeName)
  att.setParameter('partstat', opts.partstat)
  ev.addProperty(att)
  const summary = comp.getFirstPropertyValue('summary')
  if (typeof summary === 'string' && summary) ev.addPropertyWithValue('summary', summary)
  for (const name of ['dtstart', 'dtend', 'recurrence-id'] as const) {
    const prop = portableTimeProp(name, comp.getFirstProperty(name), vtz)
    if (prop) ev.addProperty(prop)
  }
  const comment = opts.comment?.trim()
  if (comment) ev.addPropertyWithValue('comment', comment.slice(0, 2000))
  root.addSubcomponent(ev)
  return serializeCalendar(root)
}

// --- Kopie für den eigenen Kalender --------------------------------------------------------------------------

export interface StoredCopyOptions {
  myAddresses: ReadonlySet<string>
  /** Wenn gesetzt: PARTSTAT des Nutzers (sonst unverändert) */
  partstat?: Partstat
  /**
   * SCHEDULE-AGENT=CLIENT am ORGANIZER (RFC 6638 §7.1): der Client verschickt die
   * Antwort selbst, der Server darf sie nicht zusätzlich senden (Doppelversand).
   */
  scheduleAgentClient: boolean
}

function organizerParamsClient(comp: ICAL.Component): void {
  const org = comp.getFirstProperty('organizer')
  if (org) org.setParameter('schedule-agent', 'CLIENT')
}

function setMyPartstat(
  comp: ICAL.Component,
  addresses: ReadonlySet<string>,
  partstat: Partstat
): boolean {
  let changed = false
  for (const prop of comp.getAllProperties('attendee')) {
    const email = mailtoAddress(prop.getFirstValue())
    if (!email || !addresses.has(email)) continue
    const cur = String(prop.getParameter('partstat') ?? '').toUpperCase()
    if (cur !== partstat) changed = true
    prop.setParameter('partstat', partstat)
    // Antwort ist gegeben: keine weitere RSVP-Aufforderung
    prop.removeParameter('rsvp')
    if (prop.getParameter('schedule-status')) prop.removeParameter('schedule-status')
  }
  return changed
}

/**
 * Wandelt ein empfangenes Einladungs-ICS in eine Kalenderressource um:
 * METHOD, VALARM und ATTACH fliegen raus (untrusted), nur VEVENT/VTIMEZONE bleiben.
 */
export function buildStoredCopy(sourceIcs: string, opts: StoredCopyOptions): string {
  const root = parseCalendar(sourceIcs)
  root.removeAllProperties('method')
  for (const sub of root.getAllSubcomponents()) {
    if (sub.name !== 'vevent' && sub.name !== 'vtimezone') root.removeSubcomponent(sub)
  }
  if (root.getAllSubcomponents('vevent').length === 0) throw new Error('Kein VEVENT')
  for (const ev of root.getAllSubcomponents('vevent')) {
    for (const alarm of ev.getAllSubcomponents('valarm')) ev.removeSubcomponent(alarm)
    ev.removeAllProperties('attach')
    if (opts.scheduleAgentClient) organizerParamsClient(ev)
    if (opts.partstat) setMyPartstat(ev, opts.myAddresses, opts.partstat)
  }
  if (!root.getFirstPropertyValue('prodid')) root.addPropertyWithValue('prodid', PRODID)
  return serializeCalendar(root)
}

export function ridKey(comp: ICAL.Component, vtz: ReturnType<typeof vtimezonesOf>): string {
  const rid = readTime(comp.getFirstProperty('recurrence-id'), vtz)
  return rid ? recurrenceIdOf(rid) : ''
}

/**
 * Führt eine (bereits bereinigte) Einladung mit einer vorhandenen Ressource
 * zusammen: Enthält sie den Stamm, ersetzt sie die Ressource; enthält sie nur
 * Ausnahmen (Einladung zu einzelnen Vorkommen), werden diese eingesetzt.
 */
export function mergeInvitation(existingIcs: string | null, incomingIcs: string): string {
  if (!existingIcs) return incomingIcs
  const incoming = parseCalendar(incomingIcs)
  const { master } = splitComponents(incoming, 'vevent')
  if (master) return incomingIcs
  const target = parseCalendar(existingIcs)
  const tVtz = vtimezonesOf(target)
  const iVtz = vtimezonesOf(incoming)
  for (const [tzid, vtz] of iVtz) {
    if (!tVtz.has(tzid)) target.addSubcomponent(cloneComp(vtz))
  }
  for (const ov of incoming.getAllSubcomponents('vevent')) {
    const key = ridKey(ov, iVtz)
    for (const old of target.getAllSubcomponents('vevent')) {
      if (ridKey(old, vtimezonesOf(target)) === key) target.removeSubcomponent(old)
    }
    target.addSubcomponent(cloneComp(ov))
  }
  return serializeCalendar(target)
}

// --- PARTSTAT in einer vorhandenen Ressource ändern ---------------------------------------------------

export interface PartstatResult {
  ics: string
  /** ATTENDEE kommt in der Ressource (bzw. dem Vorkommen) vor */
  matched: boolean
  /** Wert hat sich tatsächlich geändert */
  changed: boolean
}

/**
 * Setzt den PARTSTAT der ATTENDEE-Einträge mit einer der Adressen. Ohne
 * `recurrenceId` für alle Komponenten (Stamm + Ausnahmen), mit `recurrenceId`
 * nur für dieses Vorkommen (Ausnahme wird bei Bedarf angelegt). Andere
 * Parameter der ATTENDEE-Zeile bleiben erhalten.
 */
export function setAttendeePartstat(
  ics: string,
  addresses: ReadonlySet<string>,
  partstat: string,
  recurrenceId: string | null,
  ctx: EditContext = defaultEditContext()
): PartstatResult {
  const root = parseCalendar(ics)
  const vtz = vtimezonesOf(root)
  const events = root.getAllSubcomponents('vevent')
  const has = (c: ICAL.Component): boolean =>
    c
      .getAllProperties('attendee')
      .some((p) => addresses.has(mailtoAddress(p.getFirstValue()) ?? ''))
  const apply = (c: ICAL.Component): boolean => {
    let changed = false
    for (const prop of c.getAllProperties('attendee')) {
      const email = mailtoAddress(prop.getFirstValue())
      if (!email || !addresses.has(email)) continue
      if (String(prop.getParameter('partstat') ?? '').toUpperCase() !== partstat) changed = true
      prop.setParameter('partstat', partstat)
      prop.removeParameter('rsvp')
    }
    return changed
  }

  if (recurrenceId === null) {
    const targets = events.filter(has)
    if (targets.length === 0) return { ics, matched: false, changed: false }
    let changed = false
    for (const c of targets) changed = apply(c) || changed
    return changed
      ? { ics: serializeCalendar(root), matched: true, changed }
      : { ics, matched: true, changed: false }
  }

  const override = events.find(
    (c) => c.hasProperty('recurrence-id') && ridKey(c, vtz) === recurrenceId
  )
  if (override) {
    if (!has(override)) return { ics, matched: false, changed: false }
    const changed = apply(override)
    return changed
      ? { ics: serializeCalendar(root), matched: true, changed }
      : { ics, matched: true, changed: false }
  }
  const { master } = splitComponents(root, 'vevent')
  if (!master || !has(master)) return { ics, matched: false, changed: false }
  // Noch keine Ausnahme: über den Standard-Editor anlegen (this-Scope)
  const attendees = readAttendees(master).map((a) =>
    addresses.has(a.email.toLowerCase()) ? { ...a, partstat, rsvp: false } : a
  )
  const result = updateIcs(ics, { scope: 'this', recurrenceId, patch: { attendees } }, ctx)
  return { ics: result.ics, matched: true, changed: true }
}

// --- Organisator: REQUEST / CANCEL ----------------------------------------------------------------------------

function stripForSending(ev: ICAL.Component): void {
  for (const alarm of ev.getAllSubcomponents('valarm')) ev.removeSubcomponent(alarm)
}

function sendRoot(storedIcs: string, method: string): ICAL.Component {
  const root = parseCalendar(storedIcs)
  root.removeAllProperties('method')
  root.addPropertyWithValue('method', method)
  for (const sub of root.getAllSubcomponents()) {
    if (sub.name !== 'vevent' && sub.name !== 'vtimezone') root.removeSubcomponent(sub)
  }
  return root
}

/** METHOD:REQUEST aus der gespeicherten Ressource (Alarme des Organisators bleiben privat). */
export function buildRequestIcs(storedIcs: string, now: number): string {
  const root = sendRoot(storedIcs, 'REQUEST')
  for (const ev of root.getAllSubcomponents('vevent')) {
    stripForSending(ev)
    ev.updatePropertyWithValue('dtstamp', utcValue(now))
  }
  return serializeCalendar(root)
}

/**
 * METHOD:CANCEL für die ganze Ressource. `only` beschränkt die ATTENDEE-Liste
 * (entfernte Teilnehmer). SEQUENCE wird gegenüber dem letzten Stand erhöht
 * (RFC 5546 §3.2.5).
 */
export function buildCancelIcs(storedIcs: string, now: number, only?: ReadonlySet<string>): string {
  const root = sendRoot(storedIcs, 'CANCEL')
  for (const ev of root.getAllSubcomponents('vevent')) {
    stripForSending(ev)
    ev.updatePropertyWithValue('status', 'CANCELLED')
    ev.updatePropertyWithValue('dtstamp', utcValue(now))
    const seq = Number(ev.getFirstPropertyValue('sequence') ?? 0)
    ev.updatePropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1)
    if (only) {
      for (const p of ev.getAllProperties('attendee')) {
        if (!only.has(mailtoAddress(p.getFirstValue()) ?? '')) ev.removeProperty(p)
      }
    }
  }
  return serializeCalendar(root)
}

/** CANCEL für ein einzelnes Vorkommen (bzw. dieses und alle folgenden). */
export function buildOccurrenceCancelIcs(
  storedIcs: string,
  recurrenceId: string,
  range: 'this' | 'following',
  now: number
): string {
  const src = parseCalendar(storedIcs)
  const vtz = vtimezonesOf(src)
  const { master } = splitComponents(src, 'vevent')
  const base = master ?? pickComponent(src)
  if (!base) throw new Error('Kein VEVENT')
  const root = newCalendar('CANCEL')
  const ev = new ICAL.Component('vevent')
  ev.addPropertyWithValue('uid', String(base.getFirstPropertyValue('uid')))
  ev.addPropertyWithValue('dtstamp', utcValue(now))
  const seq = Number(base.getFirstPropertyValue('sequence') ?? 0)
  ev.addPropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1)
  ev.addPropertyWithValue('status', 'CANCELLED')
  const summary = base.getFirstPropertyValue('summary')
  if (typeof summary === 'string') ev.addPropertyWithValue('summary', summary)
  for (const name of ['organizer', 'attendee'] as const) {
    for (const p of base.getAllProperties(name)) ev.addProperty(new ICAL.Property(p.toJSON()))
  }
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(recurrenceId)
  const ridProp = allDay
    ? makeTimeProp(
        'recurrence-id',
        true,
        {
          y: Number(recurrenceId.slice(0, 4)),
          m: Number(recurrenceId.slice(5, 7)),
          d: Number(recurrenceId.slice(8, 10)),
          h: 0,
          mi: 0,
          s: 0
        },
        null
      )
    : (() => {
        const d = new Date(recurrenceId)
        return makeTimeProp(
          'recurrence-id',
          false,
          {
            y: d.getUTCFullYear(),
            m: d.getUTCMonth() + 1,
            d: d.getUTCDate(),
            h: d.getUTCHours(),
            mi: d.getUTCMinutes(),
            s: d.getUTCSeconds()
          },
          'UTC'
        )
      })()
  if (range === 'following') ridProp.setParameter('range', 'THISANDFUTURE')
  ev.addProperty(ridProp)
  void vtz
  root.addSubcomponent(ev)
  return serializeCalendar(root)
}

// --- SEQUENCE nach Bearbeitung (Organisator) ----------------------------------------------------------------

function propText(c: ICAL.Component, name: string): string {
  return c
    .getAllProperties(name)
    .map((p) => p.toICALString())
    .sort()
    .join('|')
}

/** Zeitplan-Felder: eine Änderung verschiebt den Termin (Teilnehmer müssen neu antworten). */
function scheduleHash(c: ICAL.Component): string {
  return ['dtstart', 'dtend', 'duration', 'due', 'rrule', 'rdate', 'exdate']
    .map((n) => propText(c, n))
    .join('\n')
}

/** „Wesentliche" Änderung nach RFC 5546 §2.1.4: Zeitplan, Status, Ort. */
function significantHash(c: ICAL.Component): string {
  return `${scheduleHash(c)}\n${propText(c, 'status')}\n${propText(c, 'location')}`
}

export interface SequenceResult {
  ics: string
  /** Mindestens eine Komponente wesentlich geändert (→ REQUEST mit höherer SEQUENCE) */
  significant: boolean
  /** Zeitplan geändert (PARTSTAT der Teilnehmer wurde zurückgesetzt) */
  rescheduled: boolean
}

/**
 * Bringt die SEQUENCE einer bearbeiteten Ressource mit Teilnehmern in Ordnung:
 * unveränderte Komponenten behalten ihre SEQUENCE, wesentlich geänderte sind
 * garantiert höher als zuvor. Bei Terminverschiebung gehen die Antworten der
 * Teilnehmer auf NEEDS-ACTION zurück (RFC 5546 §2.1.4). Der Organisator
 * (`organizer`) bleibt unberührt.
 */
export function normalizeSequence(
  oldIcs: string,
  newIcs: string,
  organizer: string | null
): SequenceResult {
  const oldRoot = parseCalendar(oldIcs)
  const newRoot = parseCalendar(newIcs)
  const oldVtz = vtimezonesOf(oldRoot)
  const newVtz = vtimezonesOf(newRoot)
  const oldByKey = new Map<string, ICAL.Component>()
  for (const c of oldRoot.getAllSubcomponents('vevent')) oldByKey.set(ridKey(c, oldVtz), c)
  let significant = false
  let rescheduled = false
  for (const c of newRoot.getAllSubcomponents('vevent')) {
    const old = oldByKey.get(ridKey(c, newVtz))
    if (!old) {
      significant = true
      continue
    }
    const oldSeq = Number(old.getFirstPropertyValue('sequence') ?? 0) || 0
    const curSeq = Number(c.getFirstPropertyValue('sequence') ?? 0) || 0
    if (significantHash(old) === significantHash(c)) {
      c.updatePropertyWithValue('sequence', oldSeq)
      continue
    }
    significant = true
    c.updatePropertyWithValue('sequence', Math.max(curSeq, oldSeq + 1))
    if (scheduleHash(old) !== scheduleHash(c)) {
      rescheduled = true
      for (const p of c.getAllProperties('attendee')) {
        const email = mailtoAddress(p.getFirstValue())
        if (!email || email === organizer) continue
        p.setParameter('partstat', 'NEEDS-ACTION')
        p.setParameter('rsvp', 'TRUE')
      }
    }
  }
  return { ics: serializeCalendar(newRoot), significant, rescheduled }
}

// --- Teilnehmer für den Versand ------------------------------------------------------------------------------------

/**
 * Empfänger einer Organisator-Nachricht: alle ATTENDEEs außer dem Organisator;
 * Räume/Ressourcen und Einträge mit SCHEDULE-AGENT≠SERVER (Client versendet
 * dort nichts / bewusst unterdrückt) bleiben außen vor. Alle Komponenten
 * (Stamm + Ausnahmen) zählen.
 */
export function inviteRecipients(ics: string, organizer: string | null): string[] {
  const root = parseCalendar(ics)
  const out = new Set<string>()
  for (const ev of root.getAllSubcomponents('vevent')) {
    for (const p of ev.getAllProperties('attendee')) {
      const email = mailtoAddress(p.getFirstValue())
      if (!email || email === organizer) continue
      const cutype = String(p.getParameter('cutype') ?? 'INDIVIDUAL').toUpperCase()
      if (cutype === 'ROOM' || cutype === 'RESOURCE') continue
      const agent = String(p.getParameter('schedule-agent') ?? 'SERVER').toUpperCase()
      if (agent === 'NONE') continue
      out.add(email)
    }
  }
  return [...out]
}

/** Organisator der Ressource (kleingeschrieben) oder null. */
export function organizerOf(ics: string): string | null {
  try {
    const comp = pickComponent(parseCalendar(ics))
    return comp ? mailtoAddress(comp.getFirstProperty('organizer')?.getFirstValue()) : null
  } catch {
    return null
  }
}

/** Alle ATTENDEE-Adressen (kleingeschrieben) über alle Komponenten. */
export function attendeeAddresses(ics: string): Set<string> {
  const out = new Set<string>()
  try {
    for (const ev of parseCalendar(ics).getAllSubcomponents('vevent')) {
      for (const p of ev.getAllProperties('attendee')) {
        const e = mailtoAddress(p.getFirstValue())
        if (e) out.add(e)
      }
    }
  } catch {
    // unlesbar → leer
  }
  return out
}

// --- Free/Busy -----------------------------------------------------------------------------------------------------------

export interface BusyInterval {
  startUtc: number
  endUtc: number
  type: 'BUSY' | 'BUSY-TENTATIVE' | 'BUSY-UNAVAILABLE'
}

/** Sortiert und verschmilzt überlappende Intervalle desselben Typs. */
export function mergeBusy(list: BusyInterval[]): BusyInterval[] {
  const sorted = [...list]
    .filter((b) => b.endUtc > b.startUtc)
    .sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc)
  const out: BusyInterval[] = []
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && last.type === b.type && b.startUtc <= last.endUtc) {
      last.endUtc = Math.max(last.endUtc, b.endUtc)
    } else out.push({ ...b })
  }
  return out
}

/** FREEBUSY-Perioden eines VFREEBUSY (FREE wird ignoriert). */
export function parseFreeBusy(text: string): BusyInterval[] {
  const out: BusyInterval[] = []
  let root: ICAL.Component
  try {
    root = parseCalendar(text)
  } catch {
    return out
  }
  for (const fb of root.getAllSubcomponents('vfreebusy')) {
    for (const prop of fb.getAllProperties('freebusy')) {
      const fbtype = String(prop.getParameter('fbtype') ?? 'BUSY').toUpperCase()
      if (fbtype === 'FREE') continue
      const type: BusyInterval['type'] =
        fbtype === 'BUSY-TENTATIVE' || fbtype === 'BUSY-UNAVAILABLE' ? fbtype : 'BUSY'
      for (const value of prop.getValues()) {
        if (!(value instanceof ICAL.Period)) continue
        try {
          const start = value.start.toJSDate().getTime()
          const end = value.getEnd().toJSDate().getTime()
          if (Number.isFinite(start) && Number.isFinite(end)) {
            out.push({ startUtc: start, endUtc: end, type })
          }
        } catch {
          // kaputte Periode überspringen
        }
      }
    }
  }
  return mergeBusy(out)
}

/** VFREEBUSY-Anfrage (METHOD:REQUEST) für den Scheduling-Outbox (RFC 6638 §5.1). */
export function buildFreeBusyRequest(opts: {
  organizer: string
  attendees: string[]
  rangeStart: number
  rangeEnd: number
  uid: string
  now: number
}): string {
  const root = newCalendar('REQUEST')
  const fb = new ICAL.Component('vfreebusy')
  fb.addPropertyWithValue('uid', opts.uid)
  fb.addPropertyWithValue('dtstamp', utcValue(opts.now))
  fb.addPropertyWithValue('dtstart', utcValue(opts.rangeStart))
  fb.addPropertyWithValue('dtend', utcValue(opts.rangeEnd))
  const org = new ICAL.Property('organizer')
  org.setValue(mailto(opts.organizer))
  fb.addProperty(org)
  for (const a of opts.attendees) {
    const p = new ICAL.Property('attendee')
    p.setValue(mailto(a))
    fb.addProperty(p)
  }
  root.addSubcomponent(fb)
  return serializeCalendar(root)
}
