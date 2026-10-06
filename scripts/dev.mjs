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
 * esbuild ist ein natives Binary. Liegt im node_modules eines für eine andere
 * Plattform (z. B. aus einem Linux-Container in den Mac-Checkout kopiert),
 * scheitert der Start sonst nur mit `[vite:esbuild] spawn ENOEXEC`.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- .mjs ohne TS-Syntax
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
  // Apple-Intelligence-Helper mitbauen (überspringt still ohne Swift/SDK 26)
  buildFmHelper()
}

// Die gebrandete Binary lässt app.isPackaged fälschlich true melden — ohne
// dieses Signal würde der Main-Prozess die Prod-Datenbank sperren und den
// gebauten Renderer statt des Vite-Dev-Servers laden. `preview` bleibt
// bewusst prod-nah (gebauter Renderer, Prod-userData).
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
