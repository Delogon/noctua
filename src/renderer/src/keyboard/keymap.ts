import { usePaper } from '@renderer/stores/paper'
import { useUiStore } from '@renderer/stores/ui'
import { useOwl } from '@renderer/stores/owl'
import { useToast } from '@renderer/stores/toast'
import { accountFilterForHotkey } from './account-hotkeys'
import { calendarKeyAction } from '@renderer/features/calendar/keys'

// Letterpress keymap — direct port of the behavior spec (Component.onKey in the
// handoff prototype): contextual Enter precedence and Esc cascade.
// (The former g sequence was removed without replacement in 0.49.)

function dispatch(
  scope: 'mail' | 'waiting' | 'task' | 'owl' | 'compose' | 'calendar',
  action: string
): void {
  window.dispatchEvent(new CustomEvent(`paper:${scope}`, { detail: action }))
}

export function installPaperKeymap(accountIds: () => readonly number[]): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const paper = usePaper.getState()
    const ui = useUiStore.getState()
    const target = e.target as HTMLElement | null
    const tag = target?.tagName ?? ''
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable
    const withinComposer = !!target?.closest('.mail-composer')

    // Cmd combos (also run via the native menu; here for fullscreen & co.)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      paper.setPaletteOpen(!paper.paletteOpen)
      paper.setHelpOpen(false)
      return
    }
    // ⌘Z belongs ONLY to the visible undo-send countdown; while typing it
    // stays the native undo of the focused field.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      const current = useToast.getState().current
      if (!typing && current?.kind === 'countdown' && current.action) {
        e.preventDefault()
        useToast.getState().runAction(current.id)
      }
      return
    }
    if ((e.metaKey || e.ctrlKey) && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault()
      paper.setView(
        e.key === '1' ? 'inbox' : e.key === '2' ? 'waiting' : e.key === '3' ? 'tasks' : 'calendar'
      )
      return
    }
    // ⌘F = search: opens the Owl view with the field focused (also runs
    // via the native menu; here for the case without an app menu).
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault()
      paper.setView('chat')
      useOwl.getState().requestFocus()
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      if (paper.view === 'inbox' && paper.mbox === 'inbox') {
        e.preventDefault()
        dispatch('mail', 'dictate')
        return
      }
      // Nudge composer: dictation in the Waiting view too
      if (paper.view === 'waiting') {
        e.preventDefault()
        dispatch('waiting', 'dictate')
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
      if (paper.view === 'inbox' && paper.mbox === 'inbox' && paper.comp.text.trim()) {
        e.preventDefault()
        dispatch('mail', 'elaborate')
        return
      }
      // Rephrase nudge — the sheet checks itself whether there is text
      if (paper.view === 'waiting') {
        e.preventDefault()
        dispatch('waiting', 'elaborate')
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (paper.view === 'inbox' && paper.mbox === 'inbox') {
        e.preventDefault()
        dispatch('mail', 'enter')
        return
      }
      // Sending a nudge deliberately requires ⌘↵ — an unfocused Enter must
      // not trigger a real mail.
      if (paper.view === 'waiting') {
        e.preventDefault()
        dispatch('waiting', 'enter')
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault()
      paper.setView('settings')
      return
    }

    if (e.key === 'Escape') {
      if (paper.paletteOpen) {
        paper.setPaletteOpen(false)
        return
      }
      if (paper.helpOpen) {
        paper.setHelpOpen(false)
        return
      }
      // Category override closes first (the overlay itself also listens for Esc)
      if (ui.overrideMenuOpen) {
        ui.setOverrideMenuOpen(false)
        return
      }
      // Esc cascade of the Owl view: first clear the search field, then as usual.
      // (With the field focused, its handler takes over and stops the event.)
      if (paper.view === 'chat' && useOwl.getState().query) {
        useOwl.getState().setQuery('')
        return
      }
      // Calendar: Esc closes in order delete dialog, quick create, editor, selection
      if (paper.view === 'calendar') {
        dispatch('calendar', 'escape')
        return
      }
      // Compose view: Esc files the draft and returns to the inbox
      // (Design 3a). Menus/dropdowns stop the event themselves beforehand.
      if (paper.view === 'compose') {
        dispatch('compose', 'escape')
        return
      }
      // Waiting view: Esc aborts a running nudge dictation or rephrasing
      if (paper.view === 'waiting') {
        dispatch('waiting', 'escape')
        return
      }
      if (paper.comp.mode !== 'idle') {
        dispatch('mail', 'escape')
        return
      }
      return
    }

    if (typing) return
    if (paper.paletteOpen || paper.helpOpen || paper.onboarding) return
    // An open override menu owns 1–7/0, ↑↓ and ↵ itself (tinykeys in the overlay) —
    // otherwise the digits would also toggle the account filter.
    if (ui.overrideMenuOpen) return

    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    const view = paper.view

    // Calendar keys (d/w/m, t, j/k, ←/→, n, ↵, e, ⌫): only in the calendar view and not
    // from within the editor/dialog — there Enter/Backspace belong to the controls.
    if (view === 'calendar' && !e.shiftKey && !target?.closest('[data-cal-modal]')) {
      const action = calendarKeyAction(k)
      // Enter on a focused button triggers its own click (event block, sidebar)
      if (action && !(k === 'Enter' && tag === 'BUTTON')) {
        e.preventDefault()
        // Don't trigger new event/open/delete multiple times via key repeat
        if (e.repeat && (action === 'new' || action === 'open' || action === 'delete')) return
        dispatch('calendar', action)
        return
      }
    }

    const accountFilter =
      view === 'inbox' && !withinComposer && !e.shiftKey
        ? accountFilterForHotkey(k, accountIds())
        : undefined
    if (accountFilter !== undefined) {
      e.preventDefault()
      if (!e.repeat && accountFilter !== paper.filter) paper.setFilter(accountFilter)
      return
    }

    if (k === '?') {
      paper.setHelpOpen(!paper.helpOpen)
      return
    }
    if (k === 'j' || k === 'k' || k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault()
      const dir = k === 'j' || k === 'ArrowDown' ? 1 : -1
      window.dispatchEvent(new CustomEvent('paper:move', { detail: dir }))
      return
    }
    if (k === 'v') {
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'dictate')
      return
    }
    if (k === 'Enter') {
      if (view === 'chat') {
        dispatch('owl', 'enter')
        return
      }
      if (paper.comp.mode === 'listening') {
        dispatch('mail', 'enter')
      }
      return
    }
    if (k === 'n') {
      if (view === 'chat') dispatch('owl', 'new')
      return
    }
    if (k === 'i') {
      // 5c: "Needs you" — session filter on rank 4+
      if (view === 'inbox') paper.toggleInboxFilter('needsYou')
      return
    }
    if (k === 'e') {
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'file')
      return
    }
    if (k === 'r') {
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'reply')
      return
    }
    if (k === 'a') {
      // M80: Reply all — like r, but with CC to the other recipients
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'replyAll')
      return
    }
    if (k === 'R') {
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'redraft')
      return
    }
    if (k === 'S') {
      if (view === 'inbox') dispatch('mail', 'summarize')
      return
    }
    if (k === 'z') {
      dispatch('mail', 'undo')
      return
    }
    if (k === 't') {
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'taskAccept')
      return
    }
    if (k === 'x') {
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'taskDismiss')
      return
    }
    if (k === 'd') {
      if (view === 'waiting') dispatch('waiting', 'drop')
      return
    }
    if (k === 'o') {
      if (view === 'tasks') dispatch('task', 'openSource')
      return
    }
    if (k === 'l') {
      // Category override (Design 3d): opens the menu on the selected thread
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'override')
      return
    }
    if (k === '/') {
      // Mail search lives with the owl: open the view and focus the field (⌘K stays the palette)
      e.preventDefault()
      paper.setView('chat')
      useOwl.getState().requestFocus()
      return
    }
    if (k === ' ') {
      if (view === 'tasks') {
        e.preventDefault()
        if (e.repeat) return
        dispatch('task', 'toggle')
      }
      return
    }
  }

  window.addEventListener('keydown', onKey)
  return () => {
    window.removeEventListener('keydown', onKey)
  }
}
