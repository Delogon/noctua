import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePaper } from '@renderer/stores/paper'
import { useOwl } from '@renderer/stores/owl'
import { invoke } from '@renderer/lib/ipc'
import { rowTime, useI18n, useT } from '@renderer/lib/i18n'
import { useDeleteOwlConversation, useOwlConversations } from '@renderer/queries/owl'

// Left column of the Owl view: persisted conversations (owl_conversations).
// j/k moves the marker, ↵ loads the marked conversation into the sheet,
// click loads directly. Replaces the wrongly borrowed task list.

export function OwlConversationsPane(): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const queryClient = useQueryClient()
  const conversations = useOwlConversations()
  const remove = useDeleteOwlConversation()
  const selConversationId = useOwl((s) => s.selConversationId)
  const rows = conversations.data ?? []
  const listRef = useRef<HTMLDivElement>(null)

  // Keyboard marker follows the opened conversation (derived state in render)
  const [selId, setSelId] = useState<number | null>(selConversationId)
  const [prevOpenId, setPrevOpenId] = useState<number | null>(selConversationId)
  if (prevOpenId !== selConversationId) {
    setPrevOpenId(selConversationId)
    setSelId(selConversationId)
  }
  const sel = rows.find((row) => row.id === selId) ?? null

  const openConversation = useCallback(
    (id: number): void => {
      setSelId(id)
      void invoke('owl:get', { id })
        .then(({ conversation }) => {
          if (!conversation) {
            // Deleted in the meantime — refresh the list instead of failing silently
            void queryClient.invalidateQueries({ queryKey: ['owl'] })
            return
          }
          useOwl.getState().openConversation(conversation)
        })
        .catch(() => {})
    },
    [queryClient]
  )

  // j/k from the keymap moves the marker — only in this view
  useEffect(() => {
    const onMove = (e: Event): void => {
      if (usePaper.getState().view !== 'chat') return
      const dir = (e as CustomEvent<number>).detail
      const items = conversations.data ?? []
      if (items.length === 0) return
      setSelId((current) => {
        const index = items.findIndex((row) => row.id === current)
        const next = Math.max(0, Math.min(items.length - 1, (index === -1 ? 0 : index) + dir))
        return items[next].id
      })
    }
    window.addEventListener('paper:move', onMove)
    return () => window.removeEventListener('paper:move', onMove)
  }, [conversations.data])

  // ↵ from the keymap opens the marked entry
  useEffect(() => {
    const onOwl = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== 'enter') return
      const items = conversations.data ?? []
      const id = sel?.id ?? items[0]?.id
      if (id !== undefined) openConversation(id)
    }
    window.addEventListener('paper:owl', onOwl)
    return () => window.removeEventListener('paper:owl', onOwl)
  }, [sel?.id, conversations.data, openConversation])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selId])

  const deleteConversation = (id: number): void => {
    remove.mutate({ id })
    if (useOwl.getState().selConversationId === id) useOwl.getState().newQuestion()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="mlabel flex flex-none items-center border-b border-hairline"
        style={{ padding: '9px 18px 7px', color: 'var(--muted)' }}
      >
        <span className="flex flex-1 items-baseline gap-2">
          <span>{t('owlConvHead')}</span>
          <button
            type="button"
            className="owl-new-btn"
            title={t('owlNewChatHint')}
            aria-label={t('owlNewChatHint')}
            onClick={() => {
              useOwl.getState().newQuestion()
              useOwl.getState().requestFocus()
            }}
          >
            + {t('owlNewChat')}
          </button>
        </span>
        <span className="flex-none" style={{ color: 'var(--faint)', letterSpacing: 1 }}>
          {t('owlConvSub')}
        </span>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.id}
            className="list-row owl-conv-row"
            data-selected={sel?.id === row.id}
            onClick={() => openConversation(row.id)}
          >
            <div className="flex items-baseline gap-1.5">
              <span
                className="min-w-0 truncate"
                style={{ font: '400 13.5px var(--serif)', color: 'var(--secondary)' }}
              >
                {row.title}
              </span>
              <span className="mmeta ml-auto flex-none">{rowTime(lang, row.updatedAt)}</span>
              <button
                type="button"
                className="owl-conv-row__delete"
                title={t('owlDeleteConv')}
                aria-label={t('owlDeleteConv')}
                onClick={(e) => {
                  e.stopPropagation()
                  deleteConversation(row.id)
                }}
              >
                ×
              </button>
            </div>
            {row.answerGist && (
              <div
                className="truncate"
                style={{
                  font: '400 12px var(--serif)',
                  fontStyle: 'italic',
                  color: 'var(--meta)',
                  marginTop: 2
                }}
              >
                ↳ {row.answerGist}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && !conversations.isLoading && (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div
              style={{
                font: '400 16px var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)'
              }}
            >
              {t('owlConvEmpty')}
            </div>
            <div className="mmeta" style={{ color: 'var(--faint)', marginTop: 8 }}>
              {t('owlConvEmptySub')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
