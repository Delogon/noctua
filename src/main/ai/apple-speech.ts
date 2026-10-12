import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * On-device dictation via macOS speech recognition (SpeechAnalyzer/SpeechTranscriber
 * from macOS 26, fallback SFSpeechRecognizer on-device only). Talks to the same
 * binary as apple-fm.ts (`noctua-fm`), but via one-shot processes:
 *   stt-check <locale> | stt-install <locale> | transcribe <wav> <locale>
 * Each answer is one JSON line (see native/fm-helper/speech.swift).
 * Audio goes as a temporary WAV file (0600, always deleted) — robust for
 * several minutes, without base64 bloat over the pipe.
 */

export type AppleSpeechErrorCode =
  'unavailable' | 'assets-missing' | 'permission-denied' | 'failed' | 'timeout' | 'helper-missing'

export class AppleSpeechError extends Error {
  constructor(
    readonly code: AppleSpeechErrorCode,
    message: string
  ) {
    super(message)
  }
}

const CHECK_TIMEOUT_MS = 15_000
const TRANSCRIBE_TIMEOUT_MS = 180_000
const INSTALL_TIMEOUT_MS = 600_000

// Duplicated from apple-fm.ts (not exported there) — keep in sync when changing it.
function helperPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'noctua-fm'),
    join(app.getAppPath(), 'native', 'fm-helper', 'bin', 'noctua-fm')
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

/** App language (`ui.language`: de/en/auto) → locale ID for recognition. */
export function appleSpeechLocale(language: string | null | undefined): string {
  const lang = (language ?? '').toLowerCase()
  if (lang.startsWith('de')) return 'de-DE'
  if (lang.startsWith('en')) return lang === 'en-gb' ? 'en-GB' : 'en-US'
  if (/^[a-z]{2}-[A-Za-z]{2}$/.test(language ?? '')) return language as string
  return 'en-US'
}

interface HelperReply {
  ok?: boolean
  text?: string
  state?: string
  engine?: string
  error?: string
  detail?: string
}

/** One helper call; returns the parsed JSON answer line. */
function runHelper(binary: string, args: string[], timeoutMs: number): Promise<HelperReply> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error && (error as { killed?: boolean }).killed) {
          reject(new AppleSpeechError('timeout', `Zeitüberschreitung (${timeoutMs / 1000} s)`))
          return
        }
        // The last non-empty line carries the answer (ignore framework logs before it)
        const line = stdout
          .split('\n')
          .reverse()
          .find((l) => l.trim().startsWith('{'))
        if (!line) {
          reject(
            new AppleSpeechError(
              'failed',
              error ? error.message.slice(0, 200) : 'unlesbare Helper-Antwort'
            )
          )
          return
        }
        try {
          resolve(JSON.parse(line) as HelperReply)
        } catch {
          reject(new AppleSpeechError('failed', 'unlesbare Helper-Antwort'))
        }
      }
    )
  })
}

function toError(reply: HelperReply): AppleSpeechError {
  const code = (['unavailable', 'assets-missing', 'permission-denied'] as const).find(
    (c) => c === reply.error
  )
  return new AppleSpeechError(
    code ?? 'failed',
    (reply.detail || reply.error || 'Helper-Fehler').slice(0, 200)
  )
}

/**
 * Availability of on-device recognition for a locale. Downloads nothing and
 * shows no dialog; `reason` is 'assets-missing', 'permission-denied',
 * 'unavailable', 'helper-missing' or an error message.
 */
export async function isAppleSpeechAvailable(
  locale = 'en-US'
): Promise<{ available: boolean; reason?: string }> {
  if (process.platform !== 'darwin') return { available: false, reason: 'unavailable' }
  const binary = helperPath()
  if (!binary) return { available: false, reason: 'helper-missing' }
  try {
    const reply = await runHelper(binary, ['stt-check', locale], CHECK_TIMEOUT_MS)
    if (reply.ok === false) return { available: false, reason: toError(reply).code }
    return reply.state === 'available'
      ? { available: true }
      : { available: false, reason: reply.state ?? 'unavailable' }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Downloads the language pack for the locale (system download, at user request). */
export async function ensureAppleSpeechAssets(locale: string): Promise<void> {
  const binary = helperPath()
  if (!binary) throw new AppleSpeechError('helper-missing', 'noctua-fm fehlt — pnpm run build:fm')
  const reply = await runHelper(binary, ['stt-install', locale], INSTALL_TIMEOUT_MS)
  if (reply.ok === false) throw toError(reply)
}

/** Transcribes WAV audio on-device. Throws AppleSpeechError with an error code. */
export async function transcribeWithApple(
  audio: Buffer,
  format: 'wav',
  locale: string
): Promise<string> {
  if (format !== 'wav') throw new AppleSpeechError('failed', `Format nicht unterstützt: ${format}`)
  if (process.platform !== 'darwin') throw new AppleSpeechError('unavailable', 'nur macOS')
  const binary = helperPath()
  if (!binary) throw new AppleSpeechError('helper-missing', 'noctua-fm fehlt — pnpm run build:fm')

  const file = join(app.getPath('temp'), `noctua-stt-${randomBytes(8).toString('hex')}.wav`)
  // Only the user may read the recording; delete even on error/timeout.
  await writeFile(file, audio, { mode: 0o600 })
  try {
    const reply = await runHelper(binary, ['transcribe', file, locale], TRANSCRIBE_TIMEOUT_MS)
    if (reply.ok === false || typeof reply.text !== 'string') throw toError(reply)
    return reply.text.trim()
  } finally {
    await unlink(file).catch(() => undefined)
  }
}
