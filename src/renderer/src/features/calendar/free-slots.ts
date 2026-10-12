// Gemeinsame freie Zeit mehrerer Teilnehmer: reine Logik für den Verfügbarkeitsstreifen und
// „nächster gemeinsamer freier Termin" im Termin-Editor. Alles in lokaler Zeit (Wandzeit der
// Systemzone), Tage per Date-Konstruktor — damit sind Sommerzeit-Wechsel kein Sonderfall.

export interface Interval {
  startUtc: number
  endUtc: number
}

const STEP_MS = 15 * 60_000

/** Sortiert und verschmilzt überlappende/aneinanderstoßende Intervalle; leere fallen weg. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  for (const b of [...list]
    .filter((x) => x.endUtc > x.startUtc)
    .sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc)) {
    const last = out[out.length - 1]
    if (last && b.startUtc <= last.endUtc) last.endUtc = Math.max(last.endUtc, b.endUtc)
    else out.push({ startUtc: b.startUtc, endUtc: b.endUtc })
  }
  return out
}

/** Lokale Uhrzeit `hour` am Tag von `dayMs`. */
export function localDayAt(dayMs: number, hour: number): number {
  const d = new Date(dayMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime()
}

/** Beginn der nächsten Viertelstunde (>= ms). */
function ceilStep(ms: number): number {
  return Math.ceil(ms / STEP_MS) * STEP_MS
}

export interface CommonSlotOptions {
  /** Belegung je Person; Personen ohne Auskunft gehören nicht hierher */
  busy: ReadonlyArray<readonly Interval[]>
  durationMs: number
  /** Frühester Beginn (z. B. jetzt) */
  fromMs: number
  /** Arbeitstage Mo–Fr ab dem Tag von fromMs, Standard 10 */
  workingDays?: number
  startHour?: number
  endHour?: number
}

/** Die nächsten `count` Arbeitstage (Mo–Fr) als lokale Tagesanfänge. */
export function workingDayStarts(fromMs: number, count: number): number[] {
  const first = new Date(fromMs)
  const out: number[] = []
  // Obergrenze gegen Endlosschleifen: 10 Arbeitstage = höchstens ~14 Kalendertage
  for (let i = 0; i < count * 3 + 7 && out.length < count; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    const wd = d.getDay()
    if (wd >= 1 && wd <= 5) out.push(d.getTime())
  }
  return out
}

/**
 * Erstes Zeitfenster der gegebenen Dauer, in dem niemand belegt ist: auf Viertelstunden
 * gerastert, innerhalb der Arbeitszeit (Standard 08–18), nie vor `fromMs`. Null, wenn
 * innerhalb der Arbeitstage nichts frei ist (oder die Dauer nicht in einen Arbeitstag passt).
 */
export function findCommonFreeSlot(opts: CommonSlotOptions): Interval | null {
  const { durationMs } = opts
  if (!(durationMs > 0)) return null
  const startHour = opts.startHour ?? 8
  const endHour = opts.endHour ?? 18
  const busy = mergeIntervals(opts.busy.flat())
  const from = ceilStep(opts.fromMs)
  for (const day of workingDayStarts(opts.fromMs, opts.workingDays ?? 10)) {
    const winStart = localDayAt(day, startHour)
    const winEnd = localDayAt(day, endHour)
    let cursor = Math.max(winStart, from)
    while (cursor + durationMs <= winEnd) {
      const end = cursor + durationMs
      const hit = busy.find((b) => b.endUtc > cursor && b.startUtc < end)
      if (!hit) return { startUtc: cursor, endUtc: end }
      cursor = ceilStep(hit.endUtc)
    }
  }
  return null
}

export interface StripSegment {
  /** Anteile 0..1 der Streifenbreite */
  from: number
  to: number
  tentative: boolean
}

/** Belegung als Anteile eines Fensters [winStart, winEnd) für die Streifen-Darstellung. */
export function stripSegments(
  busy: ReadonlyArray<Interval & { type?: string }>,
  winStart: number,
  winEnd: number
): StripSegment[] {
  const span = winEnd - winStart
  if (!(span > 0)) return []
  const out: StripSegment[] = []
  for (const b of busy) {
    const s = Math.max(b.startUtc, winStart)
    const e = Math.min(b.endUtc, winEnd)
    if (e <= s) continue
    out.push({
      from: (s - winStart) / span,
      to: (e - winStart) / span,
      tentative: b.type === 'BUSY-TENTATIVE'
    })
  }
  return out.sort((a, b) => a.from - b.from)
}

/** Überschneidet der Zeitraum eine Belegung? */
export function conflictsWith(busy: readonly Interval[], slot: Interval): boolean {
  return busy.some((b) => b.endUtc > slot.startUtc && b.startUtc < slot.endUtc)
}

/** Lokale Wandzeit 'YYYY-MM-DD' + 'HH:mm' als Zeitstempel; NaN bei ungültiger Eingabe. */
export function wallToLocalMs(date: string, time: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return NaN
  return new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]).getTime()
}
