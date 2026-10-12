import { usePaper } from '@renderer/stores/paper'
import { useUiStore } from '@renderer/stores/ui'
import { useOwl } from '@renderer/stores/owl'
import { useToast } from '@renderer/stores/toast'
import { accountFilterForHotkey } from './account-hotkeys'
import { calendarKeyAction } from '@renderer/features/calendar/keys'

// Letterpress-Keymap — direkter Port des Behavior-Specs (Component.onKey im
// Handoff-Prototyp): kontextuelle Enter-Praezedenz und Esc-Kaskade.
// (Die fruehere g-Sequenz wurde in 0.49 ersatzlos ausgebaut.)

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

    // Cmd-Kombis (laufen zusaetzlich uebers native Menue; hier fuer Vollbild & Co.)
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      paper.setPaletteOpen(!paper.paletteOpen)
      paper.setHelpOpen(false)
      return
    }
    // ⌘Z gehört NUR dem sichtbaren Undo-Send-Countdown; beim Tippen bleibt
    // es das native Undo des fokussierten Felds.
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
    // ⌘F = Suchen: öffnet die Owl-View mit fokussiertem Feld (läuft
    // zusätzlich übers native Menü; hier für den Fall ohne App-Menü).
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
      // Stups-Composer: Diktat auch in der Wartet-Ansicht
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
      // Stups neu formulieren — das Sheet prüft selbst, ob Text da ist
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
      // Stups senden verlangt bewusst ⌘↵ — ein unfokussiertes Enter darf
      // keine echte Mail auslösen.
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
      // Kategorie-Override schließt zuerst (das Overlay selbst hört ebenfalls auf Esc)
      if (ui.overrideMenuOpen) {
        ui.setOverrideMenuOpen(false)
        return
      }
      // Esc-Kaskade der Owl-View: erst das Suchfeld leeren, dann wie gewohnt.
      // (Bei fokussiertem Feld übernimmt dessen Handler und stoppt das Event.)
      if (paper.view === 'chat' && useOwl.getState().query) {
        useOwl.getState().setQuery('')
        return
      }
      // Kalender: Esc schließt der Reihe nach Löschen-Dialog, Schnell-Anlegen, Editor, Auswahl
      if (paper.view === 'calendar') {
        dispatch('calendar', 'escape')
        return
      }
      // Compose-Ansicht: Esc legt den Entwurf ab und kehrt in den Posteingang
      // zurück (Design 3a). Menüs/Dropdowns stoppen das Event vorher selbst.
      if (paper.view === 'compose') {
        dispatch('compose', 'escape')
        return
      }
      // Wartet-Ansicht: Esc bricht ein laufendes Stups-Diktat bzw. -Formulieren ab
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
    // Offenes Override-Menü besitzt 1–7/0, ↑↓ und ↵ selbst (tinykeys im Overlay) —
    // sonst würden die Ziffern zugleich den Kontofilter umschalten.
    if (ui.overrideMenuOpen) return

    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    const view = paper.view

    // Kalender-Tasten (d/w/m, t, j/k, ←/→, n, ↵, e, ⌫): nur in der Kalenderansicht und nicht
    // aus dem Editor/Dialog heraus — dort gehören Enter/Rücktaste den Bedienelementen.
    if (view === 'calendar' && !e.shiftKey && !target?.closest('[data-cal-modal]')) {
      const action = calendarKeyAction(k)
      // Enter auf einem fokussierten Knopf löst dessen eigenen Klick aus (Termin-Block, Seitenleiste)
      if (action && !(k === 'Enter' && tag === 'BUTTON')) {
        e.preventDefault()
        // Neuer Termin/Öffnen/Löschen nicht per Tastenwiederholung mehrfach auslösen
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
      // 5c: „Braucht dich" — Sitzungsfilter auf Rang 4+
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
      // M80: Allen antworten — wie r, aber mit CC an die übrigen Empfänger
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
      // Kategorie-Override (Design 3d): öffnet das Menü auf dem selektierten Thread
      if (view === 'inbox' && paper.mbox === 'inbox') dispatch('mail', 'override')
      return
    }
    if (k === '/') {
      // Mailsuche wohnt bei der Eule: View öffnen und Feld fokussieren (⌘K bleibt Palette)
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
