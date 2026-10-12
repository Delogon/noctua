import { useEffect, useRef, useState } from 'react'
import { useT } from '@renderer/lib/i18n'
import { usePopoverPlacement } from '@renderer/lib/popover-placement'
import { usePaper } from '@renderer/stores/paper'
import {
  filterSections,
  INBOX_FILTERS,
  type InboxFilterId
} from '@renderer/features/paper/inbox-filters'

/**
 * Extensible filter menu of the inbox list (Design Turn 7): FILTER row
 * with funnel, chips per active filter and „zurücksetzen"; the popover
 * renders sections and options from the registry.
 */
export function InboxFilterMenu({
  counts,
  totalRows
}: {
  counts: Record<InboxFilterId, number>
  totalRows: number
}): React.JSX.Element {
  const t = useT()
  const inboxFilters = usePaper((s) => s.inboxFilters)
  const toggleInboxFilter = usePaper((s) => s.toggleInboxFilter)
  const clearInboxFilters = usePaper((s) => s.clearInboxFilters)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = usePopoverPlacement(popoverOpen)

  useEffect(() => {
    if (!popoverOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setPopoverOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setPopoverOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape, true)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [popoverOpen])

  const activeDefs = INBOX_FILTERS.filter((def) => inboxFilters.has(def.id))
  const anyActive = activeDefs.length > 0

  return (
    <div ref={rootRef} className="inbox-filter-row">
      <span className="list-filter-label">{t('needsYouFilterLabel')}</span>
      <button
        ref={triggerRef}
        type="button"
        className="inbox-filter-trigger"
        data-active={anyActive}
        data-open={popoverOpen}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls="inbox-filter-popover"
        aria-label={t('needsYouFilterLabel')}
        onClick={() => setPopoverOpen((open) => !open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 3h12L9.5 8.1v3.6l-3 1.3V8.1L2 3Z" />
        </svg>
      </button>

      {anyActive ? (
        activeDefs.map((def) => (
          <button
            key={def.id}
            type="button"
            className="inbox-filter-chip"
            aria-label={t('filterChipRemove', { name: t(def.label) })}
            onClick={() => toggleInboxFilter(def.id)}
          >
            <span>
              {t(def.label)}
              {def.countRows ? ` · ${counts[def.id]}` : ''}
            </span>
            <span className="inbox-filter-chip__x" aria-hidden="true">
              ×
            </span>
          </button>
        ))
      ) : (
        <span className="inbox-filter-none">{t('needsYouAll')}</span>
      )}

      {anyActive && (
        <button type="button" className="inbox-filter-clear" onClick={clearInboxFilters}>
          {t('filterClearAll')}
        </button>
      )}

      {popoverOpen && (
        <div
          ref={popoverRef}
          popover="manual"
          id="inbox-filter-popover"
          className="list-filter-popover inbox-filter-popover"
          role="dialog"
          aria-label={t('needsYouFilterLabel')}
        >
          {filterSections().map(({ section, defs }) => (
            <fieldset key={section}>
              <legend>{t(section)}</legend>
              <label className="list-filter-option" htmlFor="inbox-filter-all">
                <input
                  id="inbox-filter-all"
                  type="radio"
                  name="inbox-filter-mode"
                  checked={!anyActive}
                  onChange={() => clearInboxFilters()}
                />
                <span className="list-filter-check" aria-hidden="true" />
                <span>{t('filterShowAll')}</span>
                <span className="list-filter-count">{totalRows}</span>
              </label>
              {defs.map((def) => (
                <label
                  key={def.id}
                  className="list-filter-option"
                  htmlFor={`inbox-filter-${def.id}`}
                >
                  <input
                    id={`inbox-filter-${def.id}`}
                    type="checkbox"
                    checked={inboxFilters.has(def.id)}
                    onChange={() => toggleInboxFilter(def.id)}
                  />
                  <span className="list-filter-check" aria-hidden="true" />
                  <span>
                    {t(def.label)}
                    {def.note && <span className="inbox-filter-option__note"> {t(def.note)}</span>}
                  </span>
                  <span className="list-filter-count">
                    {def.countRows ? counts[def.id] : ''}
                    {def.hotkey && <kbd className="inbox-filter-option__kbd">{def.hotkey}</kbd>}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="inbox-filter-footer">
            <button
              type="button"
              className="inbox-filter-clear"
              disabled={!anyActive}
              onClick={clearInboxFilters}
            >
              {t('filterClearAll').toUpperCase()}
            </button>
            <span>ESC</span>
          </div>
        </div>
      )}
    </div>
  )
}
