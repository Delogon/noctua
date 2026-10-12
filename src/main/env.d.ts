declare module '*.sql?raw' {
  const content: string
  export default content
}

/** Beim Build eingebettete Org-Konfiguration (electron.vite.config.ts); null = Upstream. */
declare const __NOCTUA_ORG_CONFIG__: import('../shared/org-config').OrgConfig | null
