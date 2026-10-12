import { useEffect, useState } from 'react'
import { tinykeys } from 'tinykeys'
import type { AiCategory, ThreadListItem } from '@shared/types'
import { useOverrideCategory } from '@renderer/queries/threads'
import { useUiStore } from '@renderer/stores/ui'
import { useT } from '@renderer/lib/i18n'
import {
  OVERRIDE_OPTIONS,
  moveOverrideSelection,
  overrideOptionForKey
} from '@renderer/features/inbox/override-options'

/**
 * Category override (key l) — the correction permanently beats the model.
 * Look: palette vocabulary (Design 3d) — accent bar, serif label,
 * kbd chips 1–7/0, footer like the command palette.
 */
export function OverrideMenu({ thread }: { thread: ThreadListItem }): React.JSX.Element {
  const t = useT()
  const setOverrideMenuOpen = useUiStore((s) => s.setOverrideMenuOpen)
  const override = useOverrideCategory()
  const [selIndex, setSelIndex] = useState(0)

  const apply = (category: AiCategory | null): void => {
    override.mutate({ threadKey: thread.threadKey, category })
    setOverrideMenuOpen(false)
  }

  useEffect(() => {
    const bindings: Record<string, (e: KeyboardEvent) => void> = {
      Escape: (e) => {
        e.preventDefault()
        setOverrideMenuOpen(false)
      },
      ArrowDown: (e) => {
        e.preventDefault()
        setSelIndex((index) => moveOverrideSelection(index, 1))
      },
      ArrowUp: (e) => {
        e.preventDefault()
        setSelIndex((index) => moveOverrideSelection(index, -1))
      },
      Enter: (e) => {
        e.preventDefault()
        apply(OVERRIDE_OPTIONS[selIndex].category)
      }
    }
    for (const option of OVERRIDE_OPTIONS) {
      bindings[option.key] = (e) => {
        e.preventDefault()
        apply(overrideOptionForKey(option.key)!.category)
      }
    }
    return tinykeys(window, bindings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.threadKey, selIndex])

  return (
    <div
      className="scrim z-50"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOverrideMenuOpen(false)
      }}
    >
      <div
        className="overlay-card"
        role="dialog"
        aria-modal="true"
        aria-label={t('overrideTitle')}
        style={{ width: 'min(380px, calc(100% - 48px))', margin: '20vh auto 0' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--ink)' }}>
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('overrideTitle')}
          </span>
          <span
            style={{
              display: 'block',
              font: '500 13.5px var(--serif)',
              marginTop: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {thread.subject ?? t('noSubject')}
          </span>
        </div>
        <div role="listbox" aria-label={t('overrideTitle')}>
          {OVERRIDE_OPTIONS.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === selIndex}
              key={option.key}
              className="palette-command-row"
              data-active={index === selIndex}
              style={
                option.category === null
                  ? { borderTop: '1px solid var(--hairline-light)' }
                  : undefined
              }
              onMouseEnter={() => setSelIndex(index)}
              onClick={() => apply(option.category)}
            >
              <span
                className="palette-command-row__label"
                style={option.category === null ? { color: 'var(--faint)' } : undefined}
              >
                {t(option.labelKey)}
              </span>
              <span className="palette-command-row__key">{option.key}</span>
            </button>
          ))}
        </div>
        <div className="palette-footer">
          <span>{t('overrideFooterSet')}</span>
          <span>{t('palChoose')}</span>
          <span>{t('overrideFooterClose')}</span>
        </div>
      </div>
    </div>
  )
}
