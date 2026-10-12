import { basename } from 'node:path'

const MAX_FILENAME_LENGTH = 120

/**
 * Macht einen absenderkontrollierten Dateinamen als Vorschlag für den
 * Speichern-Dialog unschädlich: kein Pfad, keine Steuerzeichen, keine
 * führenden Punkte, keine Windows-Stolperfallen am Ende.
 */
export function sanitizeFilename(name: string | null | undefined, fallback = 'anhang'): string {
  // Beide Separator-Stile abschneiden, unabhängig von der Plattform
  let clean = basename((name ?? '').replace(/\\/g, '/'))
  clean = clean
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
  if (clean.length > MAX_FILENAME_LENGTH) {
    const dot = clean.lastIndexOf('.')
    const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : ''
    clean = clean.slice(0, MAX_FILENAME_LENGTH - ext.length).replace(/[. ]+$/, '') + ext
  }
  return clean === '' ? fallback : clean
}
