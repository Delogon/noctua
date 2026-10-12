import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * On-Device-Diktat über macOS-Spracherkennung (SpeechAnalyzer/SpeechTranscriber
 * ab macOS 26, Fallback SFSpeechRecognizer nur on-device). Spricht dieselbe
 * Binärdatei wie apple-fm.ts (`noctua-fm`), aber über Einmal-Prozesse:
 *   stt-check <locale> | stt-install <locale> | transcribe <wav> <locale>
 * Jede Antwort ist eine JSON-Zeile (siehe native/fm-helper/speech.swift).
 * Audio geht als temporäre WAV-Datei (0600, wird immer gelöscht) — robust für
 * mehrere Minuten, ohne base64-Aufblähung über die Pipe.
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

// Dupliziert aus apple-fm.ts (dort nicht exportiert) — bei Änderung dort mitziehen.
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

/** App-Sprache (`ui.language`: de/en/auto) → Locale-ID für die Erkennung. */
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

/** Ein Helper-Aufruf; liefert die geparste JSON-Antwortzeile. */
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
        // Letzte nicht-leere Zeile trägt die Antwort (Framework-Logs davor ignorieren)
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
 * Verfügbarkeit der On-Device-Erkennung für eine Locale. Lädt nichts nach und
 * zeigt keinen Dialog; `reason` ist 'assets-missing', 'permission-denied',
 * 'unavailable', 'helper-missing' oder eine Fehlermeldung.
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

/** Lädt das Sprachpaket für die Locale (System-Download, auf Nutzerwunsch). */
export async function ensureAppleSpeechAssets(locale: string): Promise<void> {
  const binary = helperPath()
  if (!binary) throw new AppleSpeechError('helper-missing', 'noctua-fm fehlt — pnpm run build:fm')
  const reply = await runHelper(binary, ['stt-install', locale], INSTALL_TIMEOUT_MS)
  if (reply.ok === false) throw toError(reply)
}

/** Transkribiert WAV-Audio on-device. Wirft AppleSpeechError mit Fehlercode. */
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
  // Nur der Nutzer darf die Aufnahme lesen; Löschen auch bei Fehler/Timeout.
  await writeFile(file, audio, { mode: 0o600 })
  try {
    const reply = await runHelper(binary, ['transcribe', file, locale], TRANSCRIBE_TIMEOUT_MS)
    if (reply.ok === false || typeof reply.text !== 'string') throw toError(reply)
    return reply.text.trim()
  } finally {
    await unlink(file).catch(() => undefined)
  }
}
