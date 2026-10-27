declare module '*.sql?raw' {
  const content: string
  export default content
}

/** Org configuration embedded at build time (electron.vite.config.ts); null = upstream. */
declare const __NOCTUA_ORG_CONFIG__: import('../shared/org-config').OrgConfig | null
