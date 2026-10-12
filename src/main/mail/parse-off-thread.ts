import { cpus } from 'node:os'
import { parseMail, type ParsedMail } from './parser'

// Parsing for the body backfill: in a small worker pool in the app, in-process
// in tests, with NOCTUA_PARSE_IN_PROCESS=1, or when the workers fail.

interface Parser {
  parse(source: Uint8Array): Promise<ParsedMail>
  stop?(): void
}

const inProcess: Parser = { parse: (source) => parseMail(source) }
let parser: Promise<Parser> | null = null

function poolSize(): number {
  return Math.max(1, Math.min(2, cpus().length - 1))
}

function selectParser(): Promise<Parser> {
  if (!parser) {
    parser = (async (): Promise<Parser> => {
      if (!process.versions.electron || process.env.NOCTUA_PARSE_IN_PROCESS === '1') {
        return inProcess
      }
      try {
        const { ParsePool } = await import('./parse-pool')
        return new ParsePool(poolSize())
      } catch (error) {
        console.warn('[parse] worker pool unavailable, parsing in-process:', error)
        return inProcess
      }
    })()
  }
  return parser
}

export async function parseMailOffThread(source: Uint8Array): Promise<ParsedMail> {
  const current = await selectParser()
  try {
    return await current.parse(source)
  } catch (error) {
    if (error instanceof Error && error.name === 'ParseWorkerUnavailableError') {
      console.warn('[parse] worker failed, parsing in-process:', error.message)
      current.stop?.()
      parser = Promise.resolve(inProcess)
      return parseMail(source)
    }
    throw error
  }
}

export function stopParsePool(): void {
  void parser?.then((current) => current.stop?.())
  parser = null
}
