// Tastenbelegung der Kalenderansicht (nur aktiv, wenn die Ansicht offen ist).
// Rein, damit die Keymap sie ohne DOM testen kann.

export type CalendarAction =
  'day' | 'week' | 'month' | 'today' | 'prev' | 'next' | 'new' | 'open' | 'edit' | 'delete'

export function calendarKeyAction(key: string): CalendarAction | null {
  switch (key) {
    case 'd':
      return 'day'
    case 'w':
      return 'week'
    case 'm':
      return 'month'
    case 't':
      return 'today'
    case 'j':
    case 'ArrowRight':
      return 'next'
    case 'k':
    case 'ArrowLeft':
      return 'prev'
    case 'n':
      return 'new'
    case 'Enter':
      return 'open'
    case 'e':
      return 'edit'
    case 'Backspace':
    case 'Delete':
      return 'delete'
    default:
      return null
  }
}
