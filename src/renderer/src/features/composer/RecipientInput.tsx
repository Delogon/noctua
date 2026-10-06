import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { isChippableAddress, isDoubtfulAddress } from './address-check'

interface RecipientInputProps {
  label: string
  chips: string[]
  onChipsChange: (chips: string[]) => void
  /** Roher, noch nicht bestätigter Eingabetext — der Composer parst ihn beim Senden mit. */
  onTextChange: (text: string) => void
  placeholder?: string
  autoFocus?: boolean
}

/**
 * Empfängerfeld mit Chips und Autocomplete aus der eigenen Mail-Historie
 * (contact_stats: angeschriebene und empfangene Adressen). Zweifelhafte
 * Adressen (@ ohne Punkt in der Domain) behalten ihren Chip — im Akzent,
 * mit erklärendem title (Design 3a).
 */
export function RecipientInput({
  label,
  chips,
  onChipsChange,
  onTextChange,
  placeholder,
  autoFocus
}: RecipientInputProps): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Kurzes Debounce, damit nicht jeder Tastendruck eine IPC-Query auslöst.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 120)
    return () => clearTimeout(t)
  }, [text])

  const suggestQuery = useQuery({
    queryKey: ['contacts:suggest', query],
    queryFn: () => invoke('contacts:suggest', { q: query, limit: 8 }),
    enabled: query.length >= 1,
    staleTime: 0,
    placeholderData: (prev) => prev
  })

  const suggestions = useMemo(() => {
    const list = suggestQuery.data?.contacts ?? []
    const taken = new Set(chips.map((c) => c.toLowerCase()))
    return list.filter((s) => !taken.has(s.addr.toLowerCase()))
  }, [suggestQuery.data, chips])

  // Auswahl und Popup bei neuer Anfrage bzw. neuer Trefferzahl zurücksetzen
  // (Render-Anpassung statt Effect, damit kein Zusatz-Render nötig ist)
  const suggestSignature = `${query}\u0000${suggestions.length}`
  const [prevSuggestSignature, setPrevSuggestSignature] = useState(suggestSignature)
  if (prevSuggestSignature !== suggestSignature) {
    setPrevSuggestSignature(suggestSignature)
    setActive(0)
    setOpen(query.length >= 1 && suggestions.length > 0)
  }

  const setTextBoth = (value: string): void => {
    setText(value)
    onTextChange(value)
  }

  const addChip = (addr: string): void => {
    const clean = addr.trim().replace(/[,;]+$/, '')
    if (!clean) return
    if (!chips.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      onChipsChange([...chips, clean])
    }
    setTextBoth('')
    setOpen(false)
  }

  const removeChip = (addr: string): void => {
    onChipsChange(chips.filter((c) => c !== addr))
    inputRef.current?.focus()
  }

  const commitText = (): void => {
    if (isChippableAddress(text)) addChip(text)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (open && event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (open && event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter' || (event.key === 'Tab' && (open || text.trim()))) {
      const pick = open ? suggestions[active] : undefined
      if (pick) {
        event.preventDefault()
        addChip(pick.addr)
      } else if (isChippableAddress(text)) {
        event.preventDefault()
        addChip(text)
      } else if (event.key === 'Enter') {
        event.preventDefault()
      }
    } else if (event.key === ',' || event.key === ';') {
      event.preventDefault()
      commitText()
    } else if (event.key === 'Backspace' && text === '' && chips.length > 0) {
      event.preventDefault()
      removeChip(chips[chips.length - 1])
    } else if (event.key === 'Escape' && open) {
      // Nur das Dropdown schließen — nicht den Composer.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="composer-field group relative flex items-start gap-3 px-5 py-2.5">
      {label !== '' && (
        <span className="mt-1 w-12 shrink-0 text-[12px] font-medium text-text-faint transition-colors group-focus-within:text-accent">
          {label}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {chips.map((addr) => {
          const doubtful = isDoubtfulAddress(addr)
          return (
            <span
              key={addr}
              className="recipient-chip anim-pop"
              data-doubtful={doubtful || undefined}
              title={doubtful ? t('composeDoubtfulAddr') : undefined}
            >
              {addr}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => removeChip(addr)}
                className="recipient-chip-x"
                aria-label={t('composeChipRemove', { addr })}
              >
                ×
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setTextBoth(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            commitText()
            setOpen(false)
          }}
          placeholder={chips.length === 0 ? placeholder : undefined}
          autoFocus={autoFocus}
          className="min-w-[140px] flex-1 bg-transparent py-0.5 text-[13.5px] text-text placeholder:text-text-faint focus:outline-none"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      {open && (
        <div className="suggest-pop anim-rise absolute top-full left-16 z-50 mt-1 w-[min(28rem,80%)] overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s.addr}
              type="button"
              // onMouseDown statt onClick: feuert vor dem Blur des Inputs.
              onMouseDown={(e) => {
                e.preventDefault()
                addChip(s.addr)
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors ${
                i === active ? 'bg-accent-soft' : ''
              }`}
            >
              {s.name ? (
                <>
                  <span className="truncate text-[13px] font-medium text-text">{s.name}</span>
                  <span className="truncate text-[12px] text-text-faint">{s.addr}</span>
                </>
              ) : (
                <span className="truncate text-[13px] text-text">{s.addr}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
