import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Helper-Prozess und Binär-Suche gemockt; Temp-Dateien laufen echt (Cleanup-Test).
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => '/app' }
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (p: string) => (String(p).endsWith('noctua-fm') ? true : actual.existsSync(p))
  }
})

import {
  AppleSpeechError,
  appleSpeechLocale,
  ensureAppleSpeechAssets,
  isAppleSpeechAvailable,
  transcribeWithApple
} from '../../src/main/ai/apple-speech'

type Cb = (error: (Error & { killed?: boolean }) | null, stdout: string) => void

function replyWith(stdout: string, error: (Error & { killed?: boolean }) | null = null): void {
  execFileMock.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: Cb) =>
    cb(error, stdout)
  )
}

function sttTempFiles(): string[] {
  return readdirSync(tmpdir()).filter((f) => f.startsWith('noctua-stt-'))
}

const platform = process.platform

beforeEach(() => {
  execFileMock.mockReset()
  Object.defineProperty(process, 'platform', { value: 'darwin' })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
})

describe('appleSpeechLocale', () => {
  it('leitet die Locale aus der App-Sprache ab', () => {
    expect(appleSpeechLocale('de')).toBe('de-DE')
    expect(appleSpeechLocale('en')).toBe('en-US')
    expect(appleSpeechLocale('auto')).toBe('en-US')
    expect(appleSpeechLocale(undefined)).toBe('en-US')
    expect(appleSpeechLocale('fr-FR')).toBe('fr-FR')
  })
})

describe('transcribeWithApple', () => {
  it('ruft transcribe <datei> <locale> auf und liefert den Text', async () => {
    replyWith('{"ok":true,"text":"  Hallo Welt \\n","engine":"speech-analyzer"}\n')
    const text = await transcribeWithApple(Buffer.from('RIFF'), 'wav', 'de-DE')
    expect(text).toBe('Hallo Welt')
    const [, args, opts] = execFileMock.mock.calls[0] as [string, string[], { timeout: number }]
    expect(args[0]).toBe('transcribe')
    expect(args[1]).toMatch(/noctua-stt-[0-9a-f]+\.wav$/)
    expect(args[2]).toBe('de-DE')
    expect(opts.timeout).toBeGreaterThan(0)
  })

  it('legt die Temp-Datei mit 0600 an und löscht sie danach', async () => {
    let mode = 0
    execFileMock.mockImplementation((_b: string, args: string[], _o: unknown, cb: Cb) => {
      mode = statSync(args[1]).mode & 0o777
      cb(null, '{"ok":true,"text":"x"}\n')
    })
    await transcribeWithApple(Buffer.from('RIFF'), 'wav', 'en-US')
    expect(mode).toBe(0o600)
    expect(sttTempFiles()).toEqual([])
  })

  it('ignoriert Log-Zeilen vor der JSON-Antwort', async () => {
    replyWith('Framework log\n{"ok":true,"text":"ok"}\n')
    await expect(transcribeWithApple(Buffer.from('x'), 'wav', 'en-US')).resolves.toBe('ok')
  })

  it.each(['unavailable', 'assets-missing', 'permission-denied', 'failed'] as const)(
    'bildet Helper-Fehler %s auf den Code ab und räumt auf',
    async (code) => {
      replyWith(`{"ok":false,"error":"${code}","detail":"d"}\n`)
      await expect(transcribeWithApple(Buffer.from('x'), 'wav', 'en-US')).rejects.toMatchObject({
        code
      })
      expect(sttTempFiles()).toEqual([])
    }
  )

  it('mappt unbekannte Fehler auf failed', async () => {
    replyWith('{"ok":false,"error":"boom"}\n')
    await expect(transcribeWithApple(Buffer.from('x'), 'wav', 'en-US')).rejects.toMatchObject({
      code: 'failed'
    })
  })

  it('meldet Timeout (Prozess getötet) und löscht die Datei', async () => {
    replyWith('', Object.assign(new Error('killed'), { killed: true }))
    const promise = transcribeWithApple(Buffer.from('x'), 'wav', 'en-US')
    await expect(promise).rejects.toBeInstanceOf(AppleSpeechError)
    await expect(promise).rejects.toMatchObject({ code: 'timeout' })
    expect(sttTempFiles()).toEqual([])
  })

  it('meldet unlesbare Ausgabe als failed', async () => {
    replyWith('kein json\n')
    await expect(transcribeWithApple(Buffer.from('x'), 'wav', 'en-US')).rejects.toMatchObject({
      code: 'failed'
    })
  })

  it('lehnt andere Formate und Nicht-macOS ab, ohne Prozess zu starten', async () => {
    await expect(transcribeWithApple(Buffer.from('x'), 'mp3' as 'wav', 'en-US')).rejects.toThrow()
    Object.defineProperty(process, 'platform', { value: 'linux' })
    await expect(transcribeWithApple(Buffer.from('x'), 'wav', 'en-US')).rejects.toMatchObject({
      code: 'unavailable'
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })
})

describe('isAppleSpeechAvailable', () => {
  it('available bei state available', async () => {
    replyWith('{"ok":true,"state":"available","engine":"speech-analyzer"}\n')
    await expect(isAppleSpeechAvailable('de-DE')).resolves.toEqual({ available: true })
    expect((execFileMock.mock.calls[0] as [string, string[]])[1]).toEqual(['stt-check', 'de-DE'])
  })

  it('liefert den Grund bei fehlenden Assets', async () => {
    replyWith('{"ok":true,"state":"assets-missing"}\n')
    await expect(isAppleSpeechAvailable()).resolves.toEqual({
      available: false,
      reason: 'assets-missing'
    })
  })

  it('fängt Helper-Fehler und Timeouts ab', async () => {
    replyWith('', Object.assign(new Error('killed'), { killed: true }))
    const result = await isAppleSpeechAvailable()
    expect(result.available).toBe(false)
    expect(result.reason).toMatch(/Zeitüberschreitung/)
  })

  it('unter Linux nicht verfügbar', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect((await isAppleSpeechAvailable()).available).toBe(false)
  })
})

describe('ensureAppleSpeechAssets', () => {
  it('ruft stt-install und wirft bei Fehler', async () => {
    replyWith('{"ok":true,"state":"available"}\n')
    await expect(ensureAppleSpeechAssets('de-DE')).resolves.toBeUndefined()
    expect((execFileMock.mock.calls[0] as [string, string[]])[1]).toEqual(['stt-install', 'de-DE'])

    replyWith('{"ok":false,"error":"unavailable","detail":"x"}\n')
    await expect(ensureAppleSpeechAssets('xx-XX')).rejects.toMatchObject({ code: 'unavailable' })
  })
})
