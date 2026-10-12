import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Bridge to Apple Foundation Models (macOS 26+, Apple Silicon): talks to the
 * Swift helper `noctua-fm` (native/fm-helper) via a JSON line protocol.
 * The helper runs as a long-lived serve process; requests are serial
 * (the AI queue processes one mail after another anyway).
 */

export type AppleFmState =
  | 'available'
  | 'apple-intelligence-off'
  | 'model-not-ready'
  | 'device-unsupported'
  | 'helper-missing'
  | 'error'

export interface AppleFmStatus {
  state: AppleFmState
  detail: string | null
}

/** Guardrail refusals get their own error class: triage then
 *  writes a neutral verdict instead of burning the job. */
export class AppleGuardrailError extends Error {}

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

function classifyReason(reason: string | undefined): AppleFmState {
  switch (reason) {
    case 'appleIntelligenceNotEnabled':
      return 'apple-intelligence-off'
    case 'modelNotReady':
      return 'model-not-ready'
    case 'deviceNotEligible':
      return 'device-unsupported'
    default:
      return 'error'
  }
}

let statusCache: { at: number; status: AppleFmStatus } | null = null

/** Availability of the on-device model (cached for 60 s — the settings refetch
 *  and every triage run would otherwise query the same state). */
export async function appleFmStatus(force = false): Promise<AppleFmStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.status

  const status = await new Promise<AppleFmStatus>((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ state: 'device-unsupported', detail: 'nur macOS' })
      return
    }
    const binary = helperPath()
    if (!binary) {
      resolve({ state: 'helper-missing', detail: null })
      return
    }
    execFile(binary, ['check'], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        resolve({ state: 'error', detail: error.message.slice(0, 200) })
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as { state?: string; reason?: string }
        resolve(
          parsed.state === 'available'
            ? { state: 'available', detail: null }
            : { state: classifyReason(parsed.reason), detail: parsed.reason ?? null }
        )
      } catch {
        resolve({ state: 'error', detail: 'unlesbare Helper-Antwort' })
      }
    })
  })

  statusCache = { at: Date.now(), status }
  return status
}

interface Waiter {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let proc: ChildProcessWithoutNullStreams | null = null
let nextId = 1
const waiters = new Map<number, Waiter>()
let stdoutRest = ''

function failAllWaiters(message: string): void {
  for (const [, waiter] of waiters) {
    clearTimeout(waiter.timer)
    waiter.reject(new Error(message))
  }
  waiters.clear()
}

function ensureServeProcess(binary: string): ChildProcessWithoutNullStreams {
  if (proc && proc.exitCode === null) return proc

  const child = spawn(binary, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] })
  stdoutRest = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutRest += chunk
    let index: number
    while ((index = stdoutRest.indexOf('\n')) >= 0) {
      const line = stdoutRest.slice(0, index).trim()
      stdoutRest = stdoutRest.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line) as {
          id?: number
          ok?: boolean
          result?: unknown
          error?: string
          state?: string
        }
        const waiter = message.id !== undefined ? waiters.get(message.id) : undefined
        if (!waiter) continue
        waiters.delete(message.id!)
        clearTimeout(waiter.timer)
        if (message.ok && message.result !== undefined) waiter.resolve(message.result)
        else waiter.reject(new Error(message.error ?? message.state ?? 'Helper-Fehler'))
      } catch {
        // half a line or similar — ignore, the next line carries the answer
      }
    }
  })
  child.on('exit', (code) => {
    if (proc === child) proc = null
    failAllWaiters(`Helper beendet (Code ${code ?? 'Signal'})`)
  })
  child.on('error', (error) => {
    if (proc === child) proc = null
    failAllWaiters(`Helper-Start fehlgeschlagen: ${error.message}`)
  })

  proc = child
  return child
}

function requestOnce(
  binary: string,
  mode: 'triage' | 'gate',
  instructions: string,
  prompt: string
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = ensureServeProcess(binary)
    const id = nextId++
    const timer = setTimeout(() => {
      waiters.delete(id)
      reject(new Error('Zeitüberschreitung (60 s) — On-Device-Modell antwortet nicht'))
    }, 60_000)
    waiters.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, mode, instructions, prompt }) + '\n', (error) => {
      if (error) {
        waiters.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  })
}

/**
 * A triage request to the on-device model. Throws AppleGuardrailError on
 * content refusal; if the context window overflows, retries once with a
 * shortened prompt.
 */
export async function appleTriage(instructions: string, prompt: string): Promise<unknown> {
  const binary = helperPath()
  if (!binary) throw new Error('noctua-fm fehlt — pnpm run build:fm')

  try {
    return await requestOnce(binary, 'triage', instructions, prompt)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/guardrail/i.test(message)) throw new AppleGuardrailError(message.slice(0, 200))
    if (/context/i.test(message)) {
      return await requestOnce(binary, 'triage', instructions, prompt.slice(0, 6000))
    }
    throw error
  }
}

/**
 * Task gate (M88): the narrow yes/no question "is a human asking the
 * account owner personally?" is answered by the small model much more
 * reliably than the extraction in the overall verdict (eval: precision
 * 64 % → 100 % at recall 90 %). Errors count conservatively as no.
 */
export async function appleGate(instructions: string, prompt: string): Promise<boolean> {
  const binary = helperPath()
  if (!binary) throw new Error('noctua-fm fehlt — pnpm run build:fm')

  try {
    const result = (await requestOnce(binary, 'gate', instructions, prompt)) as {
      is_personal_request?: boolean
    }
    return result?.is_personal_request === true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Guardrail/context: conservatively no task — triage runs anyway
    if (/guardrail|context/i.test(message)) return false
    throw error
  }
}

/** Take the helper down on app exit. */
export function stopAppleFm(): void {
  if (proc && proc.exitCode === null) proc.kill()
  proc = null
}
