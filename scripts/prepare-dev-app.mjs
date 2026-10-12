/* eslint-disable @typescript-eslint/explicit-function-return-type -- Build-Tooling in .mjs */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const root = dirname(dirname(scriptPath))
const rootRequire = createRequire(join(root, 'package.json'))
const cacheRoot = join(root, 'node_modules', '.cache', 'noctua-dev')
const targetApp = join(cacheRoot, 'Noctua.app')
const targetExecutable = join(targetApp, 'Contents', 'MacOS', 'Noctua')
const stampPath = join(cacheRoot, 'stamp.json')
const lockPath = join(cacheRoot, 'build.lock')
const lockWaiter = new Int32Array(new SharedArrayBuffer(4))

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function setPlistString(plist, key, value) {
  execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
}

function patchHelper(frameworks, suffix, appVersion) {
  const electronName = `Electron Helper${suffix}`
  const noctuaName = `Noctua Helper${suffix}`
  const sourceApp = join(frameworks, `${electronName}.app`)
  const targetHelperApp = join(frameworks, `${noctuaName}.app`)
  const sourceExecutable = join(sourceApp, 'Contents', 'MacOS', electronName)
  const targetHelperExecutable = join(sourceApp, 'Contents', 'MacOS', noctuaName)
  const plist = join(sourceApp, 'Contents', 'Info.plist')
  const bundleIdSuffix = suffix.replaceAll(/[()]/g, '').trim().replaceAll(/\s+/g, '-')

  renameSync(sourceExecutable, targetHelperExecutable)
  setPlistString(plist, 'CFBundleDisplayName', noctuaName)
  setPlistString(plist, 'CFBundleExecutable', noctuaName)
  setPlistString(
    plist,
    'CFBundleIdentifier',
    `de.timsigl.noctua.dev.helper${bundleIdSuffix ? `.${bundleIdSuffix}` : ''}`
  )
  setPlistString(plist, 'CFBundleName', noctuaName)
  setPlistString(plist, 'CFBundleShortVersionString', appVersion)
  setPlistString(plist, 'CFBundleVersion', appVersion)
  renameSync(sourceApp, targetHelperApp)
}

function cacheIsValid(signature) {
  if (!existsSync(targetExecutable) || !existsSync(stampPath)) return false
  try {
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
    if (stamp.signature !== signature) return false

    const frameworks = join(targetApp, 'Contents', 'Frameworks')
    const helpers = readdirSync(frameworks).filter((name) => name.startsWith('Noctua Helper'))
    if (helpers.length === 0) return false
    if (readdirSync(frameworks).some((name) => name.startsWith('Electron Helper'))) return false

    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', targetApp], {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}

function acquireBuildLock() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      mkdirSync(lockPath)
      writeFileSync(join(lockPath, 'pid'), `${process.pid}\n`)
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 60_000) {
          rmSync(lockPath, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }
      Atomics.wait(lockWaiter, 0, 0, 100)
    }
  }
  throw new Error('Zeitüberschreitung beim Erstellen der Noctua-Dev-App')
}

/**
 * Creates a separately cached, ad-hoc-signed Electron shell for development.
 * The project package name remains `noctua`, so userData and Safe Storage keep
 * using their existing locations; only the macOS-visible bundle is branded.
 */
export function prepareNoctuaDevApp() {
  const electronExecutable = rootRequire('electron')
  if (process.platform !== 'darwin') return electronExecutable

  const sourceApp = dirname(dirname(dirname(electronExecutable)))
  const icon = join(root, 'build', 'icon.icns')
  const { version: electronVersion } = rootRequire('electron/package.json')
  const { version: appVersion } = rootRequire(join(root, 'package.json'))
  const signature = createHash('sha256')
    .update(
      JSON.stringify({
        schema: 1,
        electronVersion,
        appVersion,
        architecture: process.arch,
        sourceApp,
        sourceExecutable: sha256(electronExecutable),
        icon: sha256(icon),
        script: sha256(scriptPath)
      })
    )
    .digest('hex')

  if (cacheIsValid(signature)) return targetExecutable

  mkdirSync(cacheRoot, { recursive: true })
  acquireBuildLock()
  if (cacheIsValid(signature)) {
    rmSync(lockPath, { recursive: true, force: true })
    return targetExecutable
  }

  const temporaryApp = join(cacheRoot, `Noctua.tmp-${process.pid}.app`)
  rmSync(temporaryApp, { recursive: true, force: true })

  try {
    cpSync(sourceApp, temporaryApp, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      verbatimSymlinks: true
    })

    const contents = join(temporaryApp, 'Contents')
    const plist = join(contents, 'Info.plist')
    const macOS = join(contents, 'MacOS')
    const frameworks = join(contents, 'Frameworks')
    const resources = join(contents, 'Resources')

    renameSync(join(macOS, 'Electron'), join(macOS, 'Noctua'))
    copyFileSync(icon, join(resources, 'icon.icns'))
    rmSync(join(resources, 'electron.icns'), { force: true })

    setPlistString(plist, 'CFBundleDisplayName', 'Noctua')
    setPlistString(plist, 'CFBundleExecutable', 'Noctua')
    setPlistString(plist, 'CFBundleIconFile', 'icon.icns')
    setPlistString(plist, 'CFBundleIdentifier', 'de.timsigl.noctua.dev')
    setPlistString(plist, 'CFBundleName', 'Noctua')
    setPlistString(plist, 'CFBundleShortVersionString', appVersion)
    setPlistString(plist, 'CFBundleVersion', appVersion)
    setPlistString(plist, 'LSApplicationCategoryType', 'public.app-category.productivity')
    setPlistString(
      plist,
      'NSMicrophoneUsageDescription',
      'Noctua benötigt Mikrofonzugriff, um E-Mails zu diktieren.'
    )
    setPlistString(
      plist,
      'NSAudioCaptureUsageDescription',
      'Noctua benötigt Audiozugriff, um E-Mails zu diktieren.'
    )

    const helperSuffixes = readdirSync(frameworks)
      .filter((name) => /^Electron Helper.*\.app$/.test(name))
      .map((name) => name.slice('Electron Helper'.length, -'.app'.length))
    if (helperSuffixes.length === 0) throw new Error('Keine Electron-Helper im Dev-Bundle gefunden')
    for (const suffix of helperSuffixes) patchHelper(frameworks, suffix, appVersion)

    execFileSync('/usr/bin/codesign', [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--timestamp=none',
      temporaryApp
    ])

    rmSync(targetApp, { recursive: true, force: true })
    renameSync(temporaryApp, targetApp)
    writeFileSync(
      stampPath,
      `${JSON.stringify({ signature, electronVersion, appVersion }, null, 2)}\n`
    )
  } catch (error) {
    rmSync(temporaryApp, { recursive: true, force: true })
    throw error
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }

  return targetExecutable
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(prepareNoctuaDevApp())
}
