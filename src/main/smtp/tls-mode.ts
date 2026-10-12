import { connect } from 'node:net'

/**
 * Implicit TLS or STARTTLS? On loopback (Proton Bridge) the
 * mode is configurable per protocol and cannot be read from the port —
 * Tim's Bridge, e.g., runs SMTP as "SSL" on 1025. Fortunately the distinction
 * is deterministic: in plaintext/STARTTLS mode the server sends
 * its 220 greeting right away, in SSL mode it silently waits for the
 * client's TLS handshake.
 */

// Detected mode per target — the Bridge setting rarely changes.
// After a send error the entry is discarded and detected again.
const detectedModes = new Map<string, boolean>()

export async function detectImplicitTls(
  host: string,
  port: number,
  timeoutMs = 700
): Promise<boolean> {
  const key = `${host}:${port}`
  const cached = detectedModes.get(key)
  if (cached !== undefined) return cached

  const result = await new Promise<{ implicitTls: boolean; cache: boolean }>((resolve) => {
    const socket = connect({ host, port })
    const finish = (implicitTls: boolean, cache: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ implicitTls, cache })
    }
    // Silent until timeout → server expects the TLS handshake first
    const timer = setTimeout(() => finish(true, true), timeoutMs)
    socket.once('data', () => finish(false, true))
    // A connection error says nothing about the mode — don't cache,
    // the actual send delivers the understandable error message.
    socket.once('error', () => finish(false, false))
  })

  if (result.cache) detectedModes.set(key, result.implicitTls)
  return result.implicitTls
}

/** Call after a send error — the next attempt detects again. */
export function forgetTlsMode(host: string, port: number): void {
  detectedModes.delete(`${host}:${port}`)
}
