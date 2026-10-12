import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { connect as tlsConnect, createServer as createTlsServer, TLSSocket } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb, seedAccount } from '../helpers/db'
import { CERT_A, CERT_B, KEY_A, KEY_B } from '../helpers/loopback-certs'
import {
  clearTlsPins,
  isTlsPinMismatch,
  parsePins,
  pinnedLoopbackTls,
  type PinnedTlsOptions
} from '@main/auth/loopback-tls'
import { buildImapOptions } from '@main/auth/providers'

const FP_A = new X509Certificate(CERT_A).fingerprint256
const FP_B = new X509Certificate(CERT_B).fingerprint256

/** Fake-Bridge: STARTTLS (IMAP/SMTP) oder implizites TLS, Zertifikat umschaltbar. */
class FakeBridge {
  server!: Server
  port = 0
  cert = { key: KEY_A, cert: CERT_A }
  offerStartTls = true

  constructor(private mode: 'imap' | 'smtp' | 'implicit') {}

  async start(): Promise<void> {
    if (this.mode === 'implicit') {
      this.server = createTlsServer(this.cert, (s) => s.end())
    } else {
      this.server = createServer((socket) => this.handle(socket))
    }
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as { port: number }).port
  }

  swapCert(): void {
    this.cert = { key: KEY_B, cert: CERT_B }
    if (this.mode === 'implicit') {
      ;(this.server as ReturnType<typeof createTlsServer>).setSecureContext(this.cert)
    }
  }

  private handle(socket: Socket): void {
    socket.on('error', () => {})
    const upgrade = (): void => {
      const secure = new TLSSocket(socket, { isServer: true, ...this.cert })
      secure.on('error', () => {})
    }
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString()
      let index: number
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (this.mode === 'imap') {
          const [tag, command] = line.split(' ')
          if (command?.toUpperCase() === 'STARTTLS') {
            if (!this.offerStartTls) {
              socket.write(`${tag} BAD STARTTLS not supported\r\n`)
              continue
            }
            socket.off('data', onData)
            socket.write(`${tag} OK Begin TLS negotiation now\r\n`, upgrade)
            return
          }
        } else if (/^EHLO/i.test(line)) {
          socket.write('250-fake.bridge\r\n250-AUTH PLAIN\r\n250 STARTTLS\r\n')
        } else if (/^STARTTLS/i.test(line)) {
          if (!this.offerStartTls) {
            socket.write('502 5.5.1 Unrecognized command\r\n')
            continue
          }
          socket.off('data', onData)
          socket.write('220 2.0.0 Ready to start TLS\r\n', upgrade)
          return
        }
      }
    }
    socket.on('data', onData)
    socket.write(this.mode === 'imap' ? '* OK IMAP4rev1 ready\r\n' : '220 fake.bridge ESMTP\r\n')
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

/** Verbindet mit den gepinnten Optionen — so wie imapflow/nodemailer es tun. */
function connectWith(port: number, options: PinnedTlsOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host: '127.0.0.1', port, ...options }, () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', reject)
  })
}

function storedPins(db: Database.Database, accountId: number): Record<string, string> {
  const row = db.prepare('SELECT tls_fingerprint256 FROM accounts WHERE id = ?').get(accountId) as {
    tls_fingerprint256: string | null
  }
  return parsePins(row.tls_fingerprint256)
}

describe('Loopback-Zertifikat-Pinning (vuln-0010)', () => {
  let db: Database.Database
  let accountId: number

  beforeEach(() => {
    db = createTestDb()
    accountId = seedAccount(db)
  })
  afterEach(() => closeTestDb(db))

  for (const mode of ['imap', 'smtp'] as const) {
    describe(`${mode.toUpperCase()} mit STARTTLS`, () => {
      let bridge: FakeBridge
      beforeEach(async () => {
        bridge = new FakeBridge(mode)
        await bridge.start()
      })
      afterEach(() => bridge.stop())

      it('pinnt beim ersten Verbinden und akzeptiert danach dasselbe Zertifikat', async () => {
        await pinnedLoopbackTls(accountId, '127.0.0.1', bridge.port, mode, false)
        expect(storedPins(db, accountId)).toEqual({ [`127.0.0.1:${bridge.port}`]: FP_A })
        const again = await pinnedLoopbackTls(accountId, '127.0.0.1', bridge.port, mode, false)
        expect(again.rejectUnauthorized).toBe(true)
      })

      it('bricht bei geändertem Zertifikat ab, bis der Nutzer neu bestätigt', async () => {
        await pinnedLoopbackTls(accountId, '127.0.0.1', bridge.port, mode, false)
        bridge.swapCert()
        const error = await pinnedLoopbackTls(
          accountId,
          '127.0.0.1',
          bridge.port,
          mode,
          false
        ).catch((e: unknown) => e)
        expect(isTlsPinMismatch(error)).toBe(true)
        expect(storedPins(db, accountId)[`127.0.0.1:${bridge.port}`]).toBe(FP_A)

        clearTlsPins(accountId)
        await pinnedLoopbackTls(accountId, '127.0.0.1', bridge.port, mode, false)
        expect(storedPins(db, accountId)[`127.0.0.1:${bridge.port}`]).toBe(FP_B)
      })

      it('lehnt einen Server ohne STARTTLS ab (kein Klartext-Fallback)', async () => {
        bridge.offerStartTls = false
        await expect(
          pinnedLoopbackTls(accountId, '127.0.0.1', bridge.port, mode, false)
        ).rejects.toThrow(/STARTTLS/)
        expect(storedPins(db, accountId)).toEqual({})
      })
    })
  }

  describe('implizites TLS', () => {
    let bridge: FakeBridge
    beforeEach(async () => {
      bridge = new FakeBridge('implicit')
      await bridge.start()
    })
    afterEach(() => bridge.stop())

    it('bindet die eigentliche Verbindung kryptografisch an den Pin', async () => {
      const options = await pinnedLoopbackTls(accountId, '127.0.0.1', bridge.port, 'smtp', true)
      // Selbstsigniertes Zertifikat wird mit rejectUnauthorized=true akzeptiert …
      await expect(connectWith(bridge.port, options)).resolves.toBeUndefined()
      // … ein anderes Zertifikat (Port-Übernahme nach der Probe) dagegen nicht
      bridge.swapCert()
      await expect(connectWith(bridge.port, options)).rejects.toBeTruthy()
    })

    it('speichert ohne Konto-ID (Verbindungstest) nichts', async () => {
      await pinnedLoopbackTls(null, '127.0.0.1', bridge.port, 'imap', true)
      expect(storedPins(db, accountId)).toEqual({})
    })
  })
})

describe('buildImapOptions auf Loopback', () => {
  const bridgeAccount = {
    email: 'x@proton.me',
    provider: 'proton' as const,
    imap_host: '127.0.0.1',
    imap_port: 1143
  }
  const pinned: PinnedTlsOptions = {
    rejectUnauthorized: true,
    ca: [CERT_A],
    checkServerIdentity: () => undefined
  }

  it('erzwingt STARTTLS und nutzt die gepinnten TLS-Optionen', () => {
    const opts = buildImapOptions(bridgeAccount, { user: 'x', pass: 'p' }, pinned)
    expect(opts.doSTARTTLS).toBe(true)
    expect(opts.tls).toBe(pinned)
  })

  it('verweigert Loopback ohne Pin (kein rejectUnauthorized=false mehr)', () => {
    expect(() => buildImapOptions(bridgeAccount, { user: 'x', pass: 'p' })).toThrow(/gepinnt/)
  })
})
