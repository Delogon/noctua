import { create } from 'zustand'

/**
 * Remaining store next to stores/paper.ts: only the two overlays that don't
 * depend on the paper layout. Everything else (view, selection, search, composer)
 * lives in usePaper — don't add anything new here.
 */
interface UiState {
  overrideMenuOpen: boolean
  setOverrideMenuOpen: (open: boolean) => void

  addAccountOpen: boolean
  setAddAccountOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  overrideMenuOpen: false,
  setOverrideMenuOpen: (open) => set({ overrideMenuOpen: open }),

  addAccountOpen: false,
  setAddAccountOpen: (open) => set({ addAccountOpen: open })
}))
