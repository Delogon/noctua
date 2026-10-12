import { app } from 'electron'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { updateManifestSchema } from '@shared/org-config'
import { isLocalOnly } from './privacy'
import { resolveUpdateFeed } from './org-config'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

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
 * Update-Check gegen die konfigurierte Quelle (Org-Konfiguration, Default:
 * GitHub-Releases von Schereo/noctua, anonym). Modi: `github` (Releases-API),
 * `url` (JSON `{version, url, notes?}`), `off` (nie, auch nicht manuell).
 * Solange ein GitHub-Repo privat ist, liefert die API 404 — der Check bleibt
 * dann still. Vollautomatische Installation braucht eine Apple-Signatur und
 * ist bewusst nicht verbaut: es gibt nur Hinweis + Link.
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
  const feed = resolveUpdateFeed()
  if (feed.mode === 'off') {
    return {
      updateAvailable: false,
      latest: null,
      url: feed.pageUrl,
      note: 'Die Update-Prüfung ist durch die Organisationskonfiguration deaktiviert'
    }
  }
  if (!options.manual && isLocalOnly()) {
    return {
      updateAvailable: false,
      latest: null,
      url: feed.pageUrl,
      note: '„Nur lokal“: automatische Update-Prüfung ist aus'
    }
  }
  try {
    if (feed.mode === 'url') {
      const response = await fetch(feed.url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error(`Update-Feed ${response.status}`)
      const manifest = updateManifestSchema.safeParse(await response.json())
      if (!manifest.success) throw new Error('Der Update-Feed hat ein ungültiges Format')
      const { version, url, notes } = manifest.data
      const updateAvailable = newer(version, app.getVersion())
      if (updateAvailable) push('updates:available', { latest: version, url })
      return {
        updateAvailable,
        latest: version,
        url,
        note: updateAvailable ? (notes ?? null) : null
      }
    }
    const response = await fetch(feed.apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (response.status === 404) {
      return {
        updateAvailable: false,
        latest: null,
        url: feed.pageUrl,
        note: 'Das Repository ist privat – die Update-Prüfung braucht ein öffentliches Repository'
      }
    }
    if (!response.ok) throw new Error(`GitHub API ${response.status}`)
    const data = (await response.json()) as { tag_name?: string; html_url?: string }
    const latest = data.tag_name ?? null
    const updateAvailable = latest !== null && newer(latest, app.getVersion())
    if (updateAvailable) {
      push('updates:available', { latest: latest!, url: data.html_url ?? feed.pageUrl })
    }
    return { updateAvailable, latest, url: data.html_url ?? feed.pageUrl, note: null }
  } catch (error) {
    return {
      updateAvailable: false,
      latest: null,
      url: feed.pageUrl,
      note: `Prüfung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export function startUpdateChecks(pushFn: PushFn): void {
  push = pushFn
  // Modus „off": gar kein Timer
  if (resolveUpdateFeed().mode === 'off') return
  // checkForUpdates() prüft Local only bei jedem Lauf selbst — der Schalter
  // kann zur Laufzeit wechseln.
  setTimeout(() => void checkForUpdates(), 60_000)
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
}
