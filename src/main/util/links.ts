import { shell } from 'electron'

const ALLOWED_EXTERNAL_SCHEMES = new Set(['https:', 'mailto:'])

/** Opens URLs in the system browser only with an allowed scheme. */
export function openExternalSafe(url: string): boolean {
  try {
    if (ALLOWED_EXTERNAL_SCHEMES.has(new URL(url).protocol)) {
      void shell.openExternal(url)
      return true
    }
  } catch {
    // invalid URL
  }
  return false
}
