import { getSetting } from '../db'

// Language in which models write text for the user (summaries, the owl's
// answers, task titles). Prompts themselves are English; the output
// follows the app language, default German as everywhere in the main process.

export type OutputLanguage = 'de' | 'en'

export function outputLanguage(): OutputLanguage {
  try {
    return getSetting('ui.language') === 'en' ? 'en' : 'de'
  } catch {
    return 'de'
  }
}

/** Language name for prompts ("Write in German."). */
export function outputLanguageName(language: OutputLanguage = outputLanguage()): string {
  return language === 'en' ? 'English' : 'German'
}
