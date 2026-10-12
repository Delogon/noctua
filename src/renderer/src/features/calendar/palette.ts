// Calendar colors: small fixed palette in the Letterpress tone (muted, readable
// on paper). Server colors are kept; without a color a palette color is assigned
// in turn.

export const CALENDAR_PALETTE = [
  '#C2452C',
  '#B8791F',
  '#3F6B4F',
  '#2F6F73',
  '#2F5D8A',
  '#6B4A8A',
  '#9C3F68',
  '#57503F'
] as const

export function calendarColor(color: string | null, index: number): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color
  return CALENDAR_PALETTE[Math.abs(index) % CALENDAR_PALETTE.length]
}

/** Color per calendar ID (list order determines the fallback color). */
export function colorMapOf(
  calendars: ReadonlyArray<{ id: number; color: string | null }>
): Map<number, string> {
  return new Map(calendars.map((c, i) => [c.id, calendarColor(c.color, i)]))
}
