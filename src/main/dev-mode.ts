import { app } from 'electron'
import { resolveIsDev } from './security'

// Dev detection: the branded dev wrapper renames the Electron binary, which makes
// app.isPackaged wrongly report true — so scripts/dev.mjs sets NOCTUA_DEV=1 as an
// explicit signal. `is.dev` (= !isPackaged) is not enough.
// NOCTUA_DEV only counts if the app is not running from an app.asar:
// an installed production build thus never flips into dev mode.
export const isDev = resolveIsDev({
  isPackaged: app.isPackaged,
  devEnv: process.env.NOCTUA_DEV,
  appPath: app.getAppPath()
})
