import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect, type PeerCertificate, type TLSSocket } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { getDb } from '../db'

/**
 * Zertifikat-Pinning für Loopback-Server (Proton Bridge & Co., SEC vuln-0010).
 *
 * Die Bridge präsentiert ein selbstsigniertes Zertifikat — eine CA-Prüfung ist
 * unmöglich. Ohne Pinning würde jeder lokale Prozess, der den Port vor der
 * Bridge belegt, Passwort und Mailverkehr erhalten. Deshalb Trust-on-first-use:
 * Beim ersten Verbinden wird der SHA-256-Fingerabdruck in
 * accounts.tls_fingerprint256 gespeichert, danach muss er passen.
 *
 * Ablauf je Verbindung: Eine Probe-Verbindung (inkl. STARTTLS-Dialog) holt das
 * Zertifikat und vergleicht den Fingerabdruck mit dem Pin. Die eigentliche
 * Verbindung bekommt genau dieses Zertifikat als einzige CA plus einen
 * Fingerabdruck-Check — sie ist damit kryptografisch an den Pin gebunden,
 * bevor imapflow/nodemailer Zugangsdaten senden.
 */

export type LoopbackProtocol = 'imap' | 'smtp'

export interface PinnedTlsOptions {
  rejectUnauthorized: true
  ca: string[]
  checkServerIdentity: (host: string, cert: PeerCertificate) => Error | undefined
}

export class TlsPinMismatchError extends Error {
  readonly tlsPinMismatch = true
  constructor(host: string, port: number) {
    super(
      `Das TLS-Zertifikat von ${host}:${port} hat sich geändert. Falls du die Proton Bridge ` +
        'neu installiert oder aktualisiert hast, gib das Passwort des Kontos erneut ein, um dem ' +
        'neuen Zertifikat zu vertrauen. Andernfalls gibt sich möglicherweise ein anderes ' +
        'Programm als Bridge aus — die Verbindung wurde deshalb abgebrochen.'
    )
    this.name = 'TlsPinMismatchError'
  }
}

export function isTlsPinMismatch(error: unknown): boolean {
  return (error as { tlsPinMismatch?: unknown } | null)?.tlsPinMismatch === true
}

type PinMap = Record<string, string>

function pinKey(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`
}

export function parsePins(raw: string | null | undefined): PinMap {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        return typeof entry[1] === 'string'
      })
    )
  } catch {
    return {}
  }
}

function readPins(accountId: number): PinMap {
  const row = getDb()
    .prepare('SELECT tls_fingerprint256 FROM accounts WHERE id = ?')
    .get(accountId) as { tls_fingerprint256: string | null } | undefined
  return parsePins(row?.tls_fingerprint256)
}

function writePins(accountId: number, pins: PinMap): void {
  getDb()
    .prepare('UPDATE accounts SET tls_fingerprint256 = ? WHERE id = ?')
    .run(Object.keys(pins).length > 0 ? JSON.stringify(pins) : null, accountId)
}

/** Nutzer hat die Zugangsdaten neu eingegeben → dem aktuellen Zertifikat neu vertrauen. */
export function clearTlsPins(accountId: number): void {
  writePins(accountId, {})
}

const PROBE_TIMEOUT_MS = 10_000

/** Liest Zeilen, bis eine `done(line)` erfüllt; `fail(line)` bricht ab. */
function readUntil(
  socket: Socket,
  done: (line: string) => boolean,
  fail: (line: string) => boolean = () => false
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const cleanup = (): void => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('latin1')
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (fail(line)) {
          cleanup()
          reject(new Error(`Server lehnt STARTTLS ab: ${line.slice(0, 120)}`))
          return
        }
        if (done(line)) {
          cleanup()
          resolve()
          return
        }
      }
      if (buffer.length > 64 * 1024) {
        cleanup()
        reject(new Error('Unerwartete Serverantwort'))
      }
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('Verbindung vom Server geschlossen'))
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function startTls(socket: Socket, protocol: LoopbackProtocol): Promise<void> {
  if (protocol === 'imap') {
    await readUntil(socket, (line) => /^\* (OK|PREAUTH)\b/i.test(line))
    socket.write('N1 STARTTLS\r\n')
    await readUntil(
      socket,
      (line) => /^N1 OK\b/i.test(line),
      (line) => /^N1 (NO|BAD)\b/i.test(line)
    )
  } else {
    await readUntil(socket, (line) => /^220 /.test(line))
    socket.write('EHLO noctua\r\n')
    await readUntil(socket, (line) => /^250 /.test(line))
    socket.write('STARTTLS\r\n')
    await readUntil(
      socket,
      (line) => /^220 /.test(line),
      (line) => /^[45]\d\d /.test(line)
    )
  }
}

/** Holt das Server-Zertifikat (PEM) über eine eigene Probe-Verbindung. */
export async function probeServerCertificate(
  host: string,
  port: number,
  protocol: LoopbackProtocol,
  implicitTls: boolean
): Promise<{ pem: string; fingerprint256: string }> {
  let plain: Socket | null = null
  let secure: TLSSocket | null = null
  const timer = setTimeout(() => {
    const error = new Error(`Zeitüberschreitung beim TLS-Handshake mit ${host}:${port}`)
    plain?.destroy(error)
    secure?.destroy(error)
  }, PROBE_TIMEOUT_MS)
  try {
    if (!implicitTls) {
      const socket = netConnect({ host, port })
      plain = socket
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('error', reject)
      })
      await startTls(socket, protocol)
    }
    const tlsSocket = tlsConnect({
      ...(plain ? { socket: plain } : { host, port }),
      // Nur die Probe akzeptiert jedes Zertifikat — sie sendet keine Zugangsdaten.
      rejectUnauthorized: false
    })
    secure = tlsSocket
    await new Promise<void>((resolve, reject) => {
      tlsSocket.once('secureConnect', resolve)
      tlsSocket.once('error', reject)
    })
    const raw = tlsSocket.getPeerCertificate(false)?.raw
    if (!raw || raw.length === 0) throw new Error(`${host}:${port} liefert kein TLS-Zertifikat`)
    const cert = new X509Certificate(raw)
    return { pem: cert.toString(), fingerprint256: cert.fingerprint256 }
  } finally {
    clearTimeout(timer)
    secure?.destroy()
    plain?.destroy()
  }
}

/**
 * TLS-Optionen für eine Loopback-Verbindung, gebunden an den gepinnten
 * Fingerabdruck. Ohne Konto-ID (Verbindungstest vor dem Anlegen) wird an das
 * Zertifikat der Probe gebunden, aber nichts gespeichert.
 */
export async function pinnedLoopbackTls(
  accountId: number | null,
  host: string,
  port: number,
  protocol: LoopbackProtocol,
  implicitTls: boolean
): Promise<PinnedTlsOptions> {
  const { pem, fingerprint256 } = await probeServerCertificate(host, port, protocol, implicitTls)
  if (accountId !== null) {
    const pins = readPins(accountId)
    const key = pinKey(host, port)
    const pinned = pins[key]
    if (pinned && pinned !== fingerprint256) throw new TlsPinMismatchError(host, port)
    if (!pinned) writePins(accountId, { ...pins, [key]: fingerprint256 })
  }
  return {
    rejectUnauthorized: true,
    ca: [pem],
    // Hostname ist bei Loopback bedeutungslos — entscheidend ist der Pin.
    checkServerIdentity: (_host, cert) =>
      cert.fingerprint256 === fingerprint256 ? undefined : new TlsPinMismatchError(host, port)
  }
}
