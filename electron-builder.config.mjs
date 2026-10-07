import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Org-Konfiguration (Company Edition, src/shared/org-config.ts): dieselbe Quelle wie
// electron.vite.config.ts. Validiert wird dort (Schema in src/shared/org-config.ts;
// `electron-vite build` läuft in allen Build-Skripten VOR electron-builder),
// hier werden nur die Branding-Felder gelesen. Ohne Datei bleiben die
// Upstream-Werte.
function loadOrgBranding() {
  const fromEnv = process.env.NOCTUA_ORG_CONFIG?.trim()
  const file = fromEnv ? resolve(fromEnv) : resolve('build/org-config.json')
  if (!existsSync(file)) {
    if (fromEnv) throw new Error(`NOCTUA_ORG_CONFIG zeigt auf eine fehlende Datei: ${file}`)
    return {}
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  return { productName: raw.productName, appId: raw.appId, executableName: raw.executableName }
}

const org = loadOrgBranding()
const productName = org.productName ?? 'Noctua'

/** @type {import('electron-builder').Configuration} */
export default {
  appId: org.appId ?? 'de.timsigl.noctua',
  productName,
  ...(org.executableName ? { executableName: org.executableName } : {}),
  directories: {
    buildResources: 'build'
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!electron-builder.config.mjs',
    '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}',
    '!{.env,.env.*,.npmrc,pnpm-lock.yaml}',
    '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
    // electron-builder liest .gitignore nicht: ohne diese Zeilen wandert alles
    // ins app.asar, was neben der App im Projektordner liegt. Die Agent-Worktrees
    // unter .claude/ sind allein 25 GB und haben das Bundle von 563 MB auf 7,6 GB
    // aufgeblaeht — die App startet damit nicht mehr sinnvoll.
    '!.claude/**',
    '!.codex-work/**',
    '!{coverage,output,outputs,tmp}/**',
    '!{test,scripts,vendor}/**',
    '!vitest.config.ts',
    // Die Org-Konfiguration steckt im Main-Bundle; die Datei selbst gehört nicht ins Paket.
    '!build/org-config*.json'
  ],
  extraResources: [
    // Apple-Intelligence-Helper — fehlt er (kein Swift beim Bauen), fehlt nur das Feature
    {
      from: 'native/fm-helper/bin',
      to: '.',
      filter: ['noctua-fm']
    }
  ],
  asarUnpack: [
    'resources/**',
    '**/node_modules/sqlite-vec-darwin-arm64/**',
    '**/node_modules/better-sqlite3-multiple-ciphers/prebuilds/**',
    '**/node_modules/onnxruntime-node/**',
    '**/node_modules/@huggingface/transformers/**'
  ],
  // Electron-Fuses (werden beim Packen in die Electron-Binary geschrieben).
  // grantFileProtocolExtraPrivileges bleibt bewusst auf dem Default: die App laedt
  // index.html per loadFile (file://) und das Vite-Bundle nutzt Module-Skripte
  // mit crossorigin — ohne die file://-Privilegien wuerde das Fenster leer bleiben.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
  },
  mac: {
    // Hardened Runtime ist Voraussetzung fuer Notarisierung.
    hardenedRuntime: true,
    // Haupt-App und Helper nutzen dieselben Entitlements (sonst greift der
    // electron-builder-Default inkl. allow-dyld-environment-variables).
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    category: 'public.app-category.productivity',
    // Notarisierung laeuft nur, wenn die APPLE_*-Variablen gesetzt sind (siehe
    // README "Signing & notarization"); ohne sie wird sie uebersprungen.
    // Signatur-Identity kommt aus CSC_NAME / CSC_LINK, lokale Builds bleiben unsigniert.
    notarize: true,
    // TCC-Texte: Spracherkennung (On-Device-Diktat, noctua-fm) und Mikrofon
    // (Aufnahme im Renderer). Keine zusätzlichen Entitlements nötig — die App
    // ist nicht sandboxed, der Helper erbt die Hardened-Runtime-Entitlements.
    extendInfo: {
      NSSpeechRecognitionUsageDescription: `${productName} erkennt diktierte Sprache direkt auf diesem Mac. Die Aufnahme verlässt das Gerät nicht.`,
      NSMicrophoneUsageDescription: `${productName} nimmt dein Diktat über das Mikrofon auf.`
    }
  },
  dmg: {
    artifactName: '${name}-${version}.${ext}'
  }
}
