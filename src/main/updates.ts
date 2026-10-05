import { app } from 'electron'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { isLocalOnly } from './privacy'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

const RELEASES_API = 'https://api.github.com/repos/Schereo/noctua/releases/latest'
const RELEASES_PAGE = 'https://github.com/Schereo/noctua/releases/latest'
const CHECK_INTERVAL_MS = 6 * 3600_000

let push: PushFn = () => {}
let timer: NodeJS.Timeout | null = null

export function newer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

/**
 * Update-Check über die GitHub-Releases-API (anonym). Solange das Repo privat
 * ist, liefert die API 404 — der Check bleibt dann still. Vollautomatische
 * Installation braucht eine Apple-Signatur und ist bewusst nicht verbaut.
 *
 * Local only: automatische Checks entfallen komplett; nur ein ausdrücklicher
 * Aufruf (`manual: true`, Button in den Einstellungen) geht ins Netz.
 */
export async function checkForUpdates(options: { manual?: boolean } = {}): Promise<{
  updateAvailable: boolean
  latest: string | null
  url: string
  note: string | null
}> {
  if (!options.manual && isLocalOnly()) {
    return {
      updateAvailable: false,
      latest: null,
      url: RELEASES_PAGE,
      note: 'Local only: automatischer Update-Check aus'
    }
  }
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (response.status === 404) {
      return {
        updateAvailable: false,
        latest: null,
        url: RELEASES_PAGE,
        note: 'Repo ist privat — Update-Check braucht ein öffentliches Repo'
      }
    }
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)
    const data = (await response.json()) as { tag_name?: string; html_url?: string }
    const latest = data.tag_name ?? null
    const updateAvailable = latest !== null && newer(latest, app.getVersion())
    if (updateAvailable) {
      push('updates:available', { latest: latest!, url: data.html_url ?? RELEASES_PAGE })
    }
    return { updateAvailable, latest, url: data.html_url ?? RELEASES_PAGE, note: null }
  } catch (error) {
    return {
      updateAvailable: false,
      latest: null,
      url: RELEASES_PAGE,
      note: `Check fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export function startUpdateChecks(pushFn: PushFn): void {
  push = pushFn
  // checkForUpdates() prüft Local only bei jedem Lauf selbst — der Schalter
  // kann zur Laufzeit wechseln.
  setTimeout(() => void checkForUpdates(), 60_000)
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
}
