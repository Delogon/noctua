import { app } from 'electron'
import { resolveIsDev } from './security'

// Dev-Erkennung: Der gebrandete Dev-Wrapper benennt die Electron-Binary um,
// wodurch app.isPackaged fälschlich true meldet — scripts/dev.mjs setzt darum
// NOCTUA_DEV=1 als explizites Signal. `is.dev` (= !isPackaged) reicht nicht.
// NOCTUA_DEV zählt aber nur, wenn die App nicht aus einem app.asar läuft:
// ein installiertes Produktions-Build kippt damit nie in den Dev-Modus.
export const isDev = resolveIsDev({
  isPackaged: app.isPackaged,
  devEnv: process.env.NOCTUA_DEV,
  appPath: app.getAppPath()
})
