import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareNoctuaDevApp } from './prepare-dev-app.mjs'
import { buildFmHelper } from './build-fm-helper.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const rootRequire = createRequire(join(root, 'package.json'))
const electronVitePackagePath = rootRequire.resolve('electron-vite/package.json')
const electronVitePackage = JSON.parse(readFileSync(electronVitePackagePath, 'utf8'))
const electronViteCli = join(
  dirname(electronVitePackagePath),
  electronVitePackage.bin['electron-vite']
)
/**
 * esbuild is a native binary. If node_modules holds one for another platform
 * (e.g. copied from a Linux container into the Mac checkout), startup would
 * otherwise just fail with `[vite:esbuild] spawn ENOEXEC`.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- .mjs without TS syntax
function assertNativeEsbuild() {
  for (const owner of ['vite', 'electron-vite']) {
    let esbuild
    try {
      esbuild = createRequire(rootRequire.resolve(`${owner}/package.json`))('esbuild')
    } catch {
      continue
    }
    try {
      esbuild.transformSync('let a = 1')
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      console.error(
        `[dev] esbuild (über ${owner}) lässt sich nicht ausführen${code ? ` (${code})` : ''}.\n` +
          '[dev] Vermutlich passt das Binary in node_modules nicht zu dieser Plattform.\n' +
          '[dev] Abhilfe: rm -rf node_modules && pnpm install'
      )
      process.exit(1)
    }
  }
}
assertNativeEsbuild()

const env = { ...process.env }
const requestedCommand = process.argv[2]
const command = requestedCommand === 'preview' ? 'preview' : 'dev'
const forwardedArgs = requestedCommand === 'preview' ? process.argv.slice(3) : process.argv.slice(2)

if (process.platform === 'darwin') {
  env.ELECTRON_EXEC_PATH = prepareNoctuaDevApp()
  console.log('[dev] Starte die gebrandete Noctua-Dev-App')
  // Also build the Apple Intelligence helper (silently skipped without Swift/SDK 26)
  buildFmHelper()
}

// The branded binary makes app.isPackaged wrongly report true — without
// this signal the main process would lock the prod database and load the
// built renderer instead of the Vite dev server. `preview` deliberately
// stays close to prod (built renderer, prod userData).
if (command === 'dev') env.NOCTUA_DEV = '1'

const child = spawn(process.execPath, [electronViteCli, command, ...forwardedArgs], {
  cwd: root,
  env,
  stdio: 'inherit'
})
const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP']
const signalHandlers = new Map(
  forwardedSignals.map((signal) => [
    signal,
    () => {
      if (!child.killed) child.kill(signal)
    }
  ])
)
for (const [signal, handler] of signalHandlers) process.on(signal, handler)

child.on('error', (error) => {
  console.error('[dev] Noctua konnte nicht gestartet werden:', error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  for (const [forwardedSignal, handler] of signalHandlers) {
    process.off(forwardedSignal, handler)
  }
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
