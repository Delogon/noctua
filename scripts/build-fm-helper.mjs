import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Builds the Apple Foundation Models helper (native/fm-helper). Best effort:
// without a Swift toolchain or macOS 26 SDK it is silently skipped — the app
// then reports the missing helper cleanly in the settings.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(root, 'native', 'fm-helper')
const sources = ['main.swift', 'speech.swift'].map((file) => join(srcDir, file))
// Info.plist is embedded into the binary: TCC reads the speech usage
// text from it, even when the helper runs as a child process of the app.
const infoPlist = join(srcDir, 'Info.plist')
const binDir = join(root, 'native', 'fm-helper', 'bin')
const binary = join(binDir, 'noctua-fm')

/** @returns {boolean} true if the helper exists/was built */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- .mjs without TS syntax
export function buildFmHelper({ log = console.log } = {}) {
  if (process.platform !== 'darwin') return false
  if (![...sources, infoPlist].every((file) => existsSync(file))) return false
  const newest = Math.max(...[...sources, infoPlist].map((file) => statSync(file).mtimeMs))
  if (existsSync(binary) && statSync(binary).mtimeMs >= newest) return true

  try {
    const sdkVersion = execFileSync('xcrun', ['--show-sdk-version'], { encoding: 'utf8' }).trim()
    if (Number.parseInt(sdkVersion, 10) < 26) {
      log(`[fm-helper] macOS-SDK ${sdkVersion} < 26 — Helper wird übersprungen`)
      return false
    }
    mkdirSync(binDir, { recursive: true })
    // Frameworks (FoundationModels, Speech, AVFoundation) are resolved by `import`.
    const sectcreate = ['__TEXT', '__info_plist', infoPlist].flatMap((arg, i) =>
      i === 0 ? ['-Xlinker', '-sectcreate', '-Xlinker', arg] : ['-Xlinker', arg]
    )
    execFileSync('swiftc', ['-parse-as-library', '-O', ...sources, ...sectcreate, '-o', binary], {
      stdio: ['ignore', 'inherit', 'inherit']
    })
    log('[fm-helper] gebaut: native/fm-helper/bin/noctua-fm')
    return true
  } catch (error) {
    log(`[fm-helper] Bau übersprungen: ${error?.message ?? error}`)
    return false
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ok = buildFmHelper()
  if (process.argv.includes('--strict') && !ok) process.exit(1)
}
