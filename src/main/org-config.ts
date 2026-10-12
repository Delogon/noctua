import {
  slugifyProductName,
  UPSTREAM_UPDATE_REPO,
  type OrgConfig,
  type UpdatesConfig
} from '@shared/org-config'

// Org configuration at runtime: the configuration validated at build time and
// embedded in the bundle (`__NOCTUA_ORG_CONFIG__`, see electron.vite.config.ts)
// — never read from disk. Without configuration everything is upstream.
// `getOrgConfig()` is the only read site; a later MDM source (Managed
// Preferences) can be merged with the embedded configuration here without
// callers having to change.

let override: OrgConfig | null | undefined

function embedded(): OrgConfig | null {
  return typeof __NOCTUA_ORG_CONFIG__ === 'undefined' ? null : __NOCTUA_ORG_CONFIG__
}

/** The active org configuration or null (upstream build). */
export function getOrgConfig(): OrgConfig | null {
  return override !== undefined ? override : embedded()
}

/** Tests only: set the configuration (undefined = back to the embedded one). */
export function __setOrgConfigForTest(config: OrgConfig | null | undefined): void {
  override = config
}

export function productName(): string {
  return getOrgConfig()?.productName ?? 'Noctua'
}

/** AppUserModelId / bundle ID. */
export function appId(): string {
  return getOrgConfig()?.appId ?? 'de.timsigl.noctua'
}

/**
 * Internal app name (determines the userData folder and safe-storage key) of the
 * packaged app. Upstream: 'noctua-prod'. A Company Edition gets its own name
 * so it can be installed next to the upstream build without sharing the same
 * database.
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

/** Resolution of the update source; default = upstream GitHub releases. */
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

/** Menu links (Help/About); upstream: GitHub repo. */
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
