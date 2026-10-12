import { parentPort, workerData } from 'node:worker_threads'
import { PARSE_WORKER_MARKER, parseMail, type ParsedMail } from './parser'

// MIME parsing off the main process: large or deeply nested messages take
// long enough to stall IPC and the UI during the body backfill.

export interface ParseRequest {
  id: number
  source: Uint8Array
}

export type ParseResponse = { id: number; parsed: ParsedMail } | { id: number; error: string }

export async function handleParseRequest(request: ParseRequest): Promise<ParseResponse> {
  try {
    return { id: request.id, parsed: await parseMail(request.source) }
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) }
  }
}

const port = parentPort
if (port && (workerData as Record<string, unknown> | null)?.[PARSE_WORKER_MARKER] === true) {
  port.on('message', (request: ParseRequest) => {
    void handleParseRequest(request).then((response) => port.postMessage(response))
  })
}
