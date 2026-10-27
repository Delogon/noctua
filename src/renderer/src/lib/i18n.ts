import { create } from 'zustand'
import { invoke } from '@renderer/lib/ipc'
import { STRINGS, type Lang, type StringKey } from '@renderer/i18n/strings'

interface I18nState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useI18n = create<I18nState>((set) => ({
  lang: 'de',
  setLang: (lang) => {
    set({ lang })
    void invoke('settings:set', { key: 'ui.language', value: lang })
  }
}))

export function initLanguage(): void {
  void invoke('settings:get', { key: 'ui.language' }).then((r) => {
    if (r.value === 'en' || r.value === 'de') useI18n.setState({ lang: r.value })
  })
}

/** Translates a key; {placeholders} are replaced. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const lang = useI18n.getState().lang
  let s: string = STRINGS[key][lang]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

/** Hook variant: subscribes to language changes. */
export function useT(): typeof t {
  useI18n((s) => s.lang)
  return t
}

/** Date line in the masthead: TUE, 7 JULY 2026 / DI., 7. JULI 2026 */
export function mastheadDate(lang: Lang, now = new Date()): string {
  const s = now
    .toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
    .toUpperCase()
  return s
}

/** Relative time for list rows: 09:41 today, otherwise weekday/date. */
export function rowTime(lang: Lang, ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 6) {
    return d
      .toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short' })
      .toUpperCase()
  }
  return d
    .toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'short' })
    .toUpperCase()
}

/** Compact time difference for the thread arrows: "4 T. 5 Std." / "4 d 5 h". */
export function formatGap(lang: Lang, ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000))
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rest = mins % 60
  const u = lang === 'de' ? { d: 'T.', h: 'Std.', m: 'Min.' } : { d: 'd', h: 'h', m: 'min' }
  const parts: string[] = []
  if (days > 0) parts.push(`${days} ${u.d}`)
  if (hours > 0) parts.push(`${hours} ${u.h}`)
  if (days === 0 && (hours === 0 || rest > 0)) parts.push(`${rest} ${u.m}`)
  return parts.slice(0, 2).join(' ')
}
