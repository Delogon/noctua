import type { CalendarAlarm } from '@shared/calendar-types'

// Erinnerungs-Voreinstellungen des Editors. Genau ein Alarm relativ zum Start ist
// darstellbar; alles andere („custom": mehrere, absolut, relativ zum Ende, …) bleibt
// unverändert erhalten, solange der Nutzer die Auswahl nicht anfasst.

export const ALARM_PRESETS = [
  { id: 'none', minutes: null },
  { id: '0', minutes: 0 },
  { id: '5', minutes: 5 },
  { id: '10', minutes: 10 },
  { id: '15', minutes: 15 },
  { id: '30', minutes: 30 },
  { id: '60', minutes: 60 },
  { id: '1440', minutes: 1440 }
] as const

export type AlarmPresetId = (typeof ALARM_PRESETS)[number]['id']
export type AlarmChoice = AlarmPresetId | 'custom'

/** Welche Voreinstellung beschreibt diese Alarme? 'custom' = nicht darstellbar. */
export function alarmChoiceOf(alarms: readonly CalendarAlarm[]): AlarmChoice {
  if (alarms.length === 0) return 'none'
  if (alarms.length > 1) return 'custom'
  const a = alarms[0]
  if (a.relativeTo !== 'START' || a.absoluteUtc !== null || a.action === 'EMAIL') return 'custom'
  if (a.offsetSeconds > 0 || a.offsetSeconds % 60 !== 0) return 'custom'
  const minutes = -a.offsetSeconds / 60
  const preset = ALARM_PRESETS.find((p) => p.minutes === minutes)
  return preset ? preset.id : 'custom'
}

/** Alarme für die Auswahl; 'custom' gibt die Originale unverändert zurück. */
export function alarmsFromChoice(
  choice: AlarmChoice,
  original: readonly CalendarAlarm[]
): CalendarAlarm[] {
  if (choice === 'custom') return [...original]
  const preset = ALARM_PRESETS.find((p) => p.id === choice)
  if (!preset || preset.minutes === null) return []
  return [
    {
      action: 'DISPLAY',
      relativeTo: 'START',
      offsetSeconds: -preset.minutes * 60,
      absoluteUtc: null,
      description: null
    }
  ]
}
