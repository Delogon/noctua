import { getSetting } from '../db'

// Sprache, in der Modelle Text für den Nutzer schreiben (Zusammenfassungen,
// Antworten der Eule, Aufgabentitel). Prompts selbst sind englisch; die
// Ausgabe folgt der App-Sprache, Standard Deutsch wie überall im Main-Prozess.

export type OutputLanguage = 'de' | 'en'

export function outputLanguage(): OutputLanguage {
  try {
    return getSetting('ui.language') === 'en' ? 'en' : 'de'
  } catch {
    return 'de'
  }
}

/** Sprachname für Prompts („Write in German."). */
export function outputLanguageName(language: OutputLanguage = outputLanguage()): string {
  return language === 'en' ? 'English' : 'German'
}
