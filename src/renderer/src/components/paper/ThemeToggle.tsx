import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'

const SUN =
  'M8 5.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6z M8 1.2v1.6 M8 13.2v1.6 M1.2 8h1.6 M13.2 8h1.6 M3.2 3.2l1.1 1.1 M11.7 11.7l1.1 1.1 M3.2 12.8l1.1-1.1 M11.7 4.3l1.1-1.1'
const MOON = 'M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z'

/**
 * Hell/Dunkel-Schalter (Einstellung ui.theme). Zeigt das Ziel: im Hellen den
 * Mond, im Dunkeln die Sonne — wie in den meisten Apps.
 */
export function ThemeToggle({ className }: { className: string }): React.JSX.Element {
  const t = useT()
  const theme = usePaper((s) => s.theme)
  const setTheme = usePaper((s) => s.setTheme)
  const dark = theme === 'dark'
  const label = dark ? t('themeToLight') : t('themeToDark')
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={dark}
      title={label}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="theme-toggle__icon">
        <path d={dark ? SUN : MOON} />
      </svg>
    </button>
  )
}
