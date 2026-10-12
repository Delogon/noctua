import { useEffect, useId, useRef, useState } from 'react'
import type { AccountSummary } from '@shared/types'
import { useT } from '@renderer/lib/i18n'
import { usePopoverPlacement } from '@renderer/lib/popover-placement'
import { accountHotkeyForIndex } from '@renderer/keyboard/account-hotkeys'

/**
 * FROM picker of the composer (Design 3a): the same menu vocabulary as the
 * list's mailbox filter — swatch · account name · email · hotkey chip,
 * ✓ on the active entry. Replaces the bare <select>.
 */
export function FromAccountPicker({
  accounts,
  account,
  onSelect
}: {
  accounts: AccountSummary[]
  /** Effectively selected account (explicit or first) — undefined: no accounts. */
  account?: AccountSummary
  onSelect: (accountId: number) => void
}): React.JSX.Element {
  const t = useT()
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = usePopoverPlacement(open)
  const activeLabel = account ? `${account.accountName} · ${account.email}` : t('mailboxFilterNone')
  const selectable = accounts.length > 1

  useEffect(() => {
    if (!open) return

    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Esc belongs to the menu here — not the composer (it would otherwise file the draft)
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
        ?.focus()
    })
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const select = (accountId: number): void => {
    onSelect(accountId)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveWithinMenu = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const plainKey =
      !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.repeat
    if (plainKey && /^[1-9]$/.test(event.key)) {
      const target = accounts[Number(event.key) - 1]
      if (target) {
        event.preventDefault()
        event.stopPropagation()
        if (target.id === account?.id) {
          setOpen(false)
          requestAnimationFrame(() => triggerRef.current?.focus())
        } else {
          select(target.id)
        }
      }
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    )
    const current = options.indexOf(document.activeElement as HTMLElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    options[(current + direction + options.length) % options.length]?.focus()
  }

  return (
    <div ref={rootRef} className="compose-from account-filter-control">
      <button
        ref={triggerRef}
        type="button"
        className="account-filter-trigger"
        data-open={open}
        disabled={!selectable}
        aria-haspopup="menu"
        aria-expanded={selectable && open}
        aria-controls={menuId}
        aria-label={t('composeFromAria', { name: activeLabel })}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="account-filter-swatch"
          style={{ background: account?.color ?? 'var(--hairline)' }}
          aria-hidden="true"
        />
        <span className="account-filter-trigger__value" title={activeLabel}>
          {activeLabel}
        </span>
        <svg viewBox="0 0 10 7" aria-hidden="true">
          <path d="M1 1.5 5 5.5 9 1.5" />
        </svg>
      </button>

      {open && selectable && (
        <div
          ref={popoverRef}
          popover="manual"
          id={menuId}
          className="account-filter-menu"
          role="menu"
          aria-label={t('composeFrom')}
          onKeyDown={moveWithinMenu}
        >
          {accounts.map((candidate, index) => {
            const hotkey = accountHotkeyForIndex(index)
            const checked = candidate.id === account?.id
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-keyshortcuts={hotkey ?? undefined}
                className="account-filter-option"
                key={candidate.id}
                onClick={() => select(candidate.id)}
              >
                <span
                  className="account-filter-swatch"
                  style={{ background: candidate.color }}
                  aria-hidden="true"
                />
                <span className="account-filter-option__copy">
                  <strong>{candidate.accountName}</strong>
                  <small>{candidate.email}</small>
                </span>
                <span className="account-filter-option__meta" aria-hidden="true">
                  {checked ? (
                    <span className="account-filter-check">✓</span>
                  ) : (
                    hotkey && <kbd className="account-filter-hotkey">{hotkey}</kbd>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
