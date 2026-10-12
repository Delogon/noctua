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
 * Update check against the configured source (org configuration, default:
 * GitHub releases of Schereo/noctua, anonymous). Modes: `github` (releases API),
 * `url` (JSON `{version, url, notes?}`), `off` (never, not even manually).
 * While a GitHub repo is private, the API returns 404 — the check then stays
 * silent. Fully automatic installation needs an Apple signature and is
 * deliberately not built in: there is only a notice + link.
 *
 * Local only: automatic checks are dropped entirely; only an explicit
 * call (`manual: true`, button in settings) goes to the network.
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
  // Mode "off": no timer at all
  if (resolveUpdateFeed().mode === 'off') return
  // checkForUpdates() checks Local only itself on every run — the switch
  // can change at runtime.
  setTimeout(() => void checkForUpdates(), 60_000)
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export function stopUpdateChecks(): void {
  if (timer) clearInterval(timer)
  timer = null
}
