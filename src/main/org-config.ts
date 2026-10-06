import {
  slugifyProductName,
  UPSTREAM_UPDATE_REPO,
  type OrgConfig,
  type UpdatesConfig
} from '@shared/org-config'

// Org-Konfiguration zur Laufzeit: die zur Build-Zeit validierte und in den
// Bundle eingebettete Konfiguration (`__NOCTUA_ORG_CONFIG__`, siehe
// electron.vite.config.ts) — nie von der Platte gelesen. Ohne Konfiguration
// ist alles Upstream. `getOrgConfig()` ist die einzige Lesestelle; eine spätere
// MDM-Quelle (Managed Preferences) kann hier mit der eingebetteten
// Konfiguration zusammengeführt werden, ohne dass Aufrufer sich ändern.

let override: OrgConfig | null | undefined

function embedded(): OrgConfig | null {
  return typeof __NOCTUA_ORG_CONFIG__ === 'undefined' ? null : __NOCTUA_ORG_CONFIG__
}

/** Die aktive Org-Konfiguration oder null (Upstream-Build). */
export function getOrgConfig(): OrgConfig | null {
  return override !== undefined ? override : embedded()
}

/** Nur Tests: Konfiguration setzen (undefined = zurück auf die eingebettete). */
export function __setOrgConfigForTest(config: OrgConfig | null | undefined): void {
  override = config
}

export function productName(): string {
  return getOrgConfig()?.productName ?? 'Noctua'
}

/** AppUserModelId / Bundle-ID. */
export function appId(): string {
  return getOrgConfig()?.appId ?? 'de.timsigl.noctua'
}

/**
 * Interner App-Name (bestimmt userData-Ordner und Safe-Storage-Schlüssel) der
 * verpackten App. Upstream: 'noctua-prod'. Eine Company Edition bekommt einen
 * eigenen Namen, damit sie neben dem Upstream-Build installierbar ist, ohne
 * dieselbe Datenbank zu teilen.
 */
export function packagedAppName(): string {
  const org = getOrgConfig()
  if (!org || (!org.productName && !org.appId && !org.executableName)) return 'noctua-prod'
  return `${org.executableName ?? slugifyProductName(org.productName ?? org.appId ?? 'app')}-prod`
}

export type UpdateFeed =
  | { mode: 'github'; repo: string; apiUrl: string; pageUrl: string }
  | { mode: 'url'; url: string; pageUrl: string }
  | { mode: 'off'; pageUrl: string }

/** Auflösung der Update-Quelle; Default = Upstream-GitHub-Releases. */
export function resolveUpdateFeed(config: OrgConfig | null = getOrgConfig()): UpdateFeed {
  const updates: UpdatesConfig = config?.updates ?? { mode: 'github', repo: UPSTREAM_UPDATE_REPO }
  const fallbackPage = config?.links?.homepage
  switch (updates.mode) {
    case 'github':
      return {
        mode: 'github',
        repo: updates.repo,
        apiUrl: `https://api.github.com/repos/${updates.repo}/releases/latest`,
        pageUrl: `https://github.com/${updates.repo}/releases/latest`
      }
    case 'url':
      return { mode: 'url', url: updates.url, pageUrl: fallbackPage ?? updates.url }
    case 'off':
      return { mode: 'off', pageUrl: fallbackPage ?? '' }
  }
}

/** Menü-Links (Hilfe/Über); Upstream: GitHub-Repo. */
export function helpLinks(config: OrgConfig | null = getOrgConfig()): {
  homepage: string
  support: string | null
  homepageIsUpstream: boolean
} {
  const homepage = config?.links?.homepage
  return {
    homepage: homepage ?? `https://github.com/${UPSTREAM_UPDATE_REPO}`,
    support: config?.links?.support ?? null,
    homepageIsUpstream: !homepage
  }
}
