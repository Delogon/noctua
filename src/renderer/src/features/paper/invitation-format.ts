import type { InvitationView } from '@shared/invitation-types'

/**
 * Darstellung von Einladungen: Zeitangabe in der Ortszeit des Betrachters
 * (ganztägig = Kalendertage, nie zeitzonenverschoben) und Kurzfassung der
 * Wiederholungsregel. Reine Funktionen, ohne React.
 */

export type InviteLang = 'de' | 'en'

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function formatInvitationWhen(
  inv: Pick<InvitationView, 'startUtc' | 'endUtc' | 'allDay' | 'startDay' | 'endDay'>,
  lang: InviteLang,
  timeZone?: string
): string {
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  if (inv.allDay && inv.startDay) {
    const f = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
    const start = dayDate(inv.startDay)
    const last = inv.endDay ? new Date(dayDate(inv.endDay).getTime() - 86_400_000) : start
    const allDay = lang === 'de' ? 'ganztägig' : 'all day'
    return last.getTime() > start.getTime()
      ? `${f.format(start)} – ${f.format(last)} (${allDay})`
      : `${f.format(start)} (${allDay})`
  }
  if (inv.startUtc === null) return ''
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone })
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone })
  const zone = new Intl.DateTimeFormat(locale, { timeZoneName: 'short', timeZone })
    .formatToParts(inv.startUtc)
    .find((p) => p.type === 'timeZoneName')?.value
  const suffix = zone ? ` ${zone}` : ''
  const end = inv.endUtc !== null && inv.endUtc > inv.startUtc ? inv.endUtc : null
  const head = `${day.format(inv.startUtc)}, ${time.format(inv.startUtc)}`
  if (end === null) return `${head}${suffix}`
  return day.format(end) === day.format(inv.startUtc)
    ? `${head} – ${time.format(end)}${suffix}`
    : `${head} – ${day.format(end)}, ${time.format(end)}${suffix}`
}

const WEEKDAYS: Record<InviteLang, Record<string, string>> = {
  de: {
    MO: 'Montag',
    TU: 'Dienstag',
    WE: 'Mittwoch',
    TH: 'Donnerstag',
    FR: 'Freitag',
    SA: 'Samstag',
    SU: 'Sonntag'
  },
  en: {
    MO: 'Monday',
    TU: 'Tuesday',
    WE: 'Wednesday',
    TH: 'Thursday',
    FR: 'Friday',
    SA: 'Saturday',
    SU: 'Sunday'
  }
}

const UNITS: Record<string, { every: [string, string]; many: [string, string] }> = {
  DAILY: { every: ['Jeden Tag', 'Every day'], many: ['Tage', 'days'] },
  WEEKLY: { every: ['Jede Woche', 'Every week'], many: ['Wochen', 'weeks'] },
  MONTHLY: { every: ['Jeden Monat', 'Every month'], many: ['Monate', 'months'] },
  YEARLY: { every: ['Jedes Jahr', 'Every year'], many: ['Jahre', 'years'] }
}

/** „Jede Woche (Dienstag)" aus einer RRULE; unbekannte Muster als „Wiederkehrend". */
export function recurrenceSummary(rrule: string | null, lang: InviteLang): string | null {
  if (!rrule) return null
  const parts: Record<string, string | undefined> = {}
  for (const p of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = p.split('=')
    if (k) parts[k.toUpperCase()] = v
  }
  const de = lang === 'de'
  const unit = UNITS[parts.FREQ ?? '']
  if (!unit) return de ? 'Wiederkehrend' : 'Recurring'
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1)
  const idx = de ? 0 : 1
  let text =
    interval === 1
      ? unit.every[idx]
      : de
        ? `Alle ${interval} ${unit.many[0]}`
        : `Every ${interval} ${unit.many[1]}`
  if (parts.FREQ === 'WEEKLY' && parts.BYDAY) {
    const names = parts.BYDAY.split(',')
      .map((d) => WEEKDAYS[lang][d.slice(-2)])
      .filter(Boolean)
    if (names.length > 0) text += de ? ` (${names.join(', ')})` : ` on ${names.join(', ')}`
  }
  if (parts.COUNT) text += de ? `, ${parts.COUNT}×` : `, ${parts.COUNT} times`
  else if (parts.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL)
    if (m) text += de ? `, bis ${m[3]}.${m[2]}.${m[1]}` : `, until ${m[1]}-${m[2]}-${m[3]}`
  }
  return text
}
