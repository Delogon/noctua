import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { detectImplicitTls, forgetTlsMode } from '@main/smtp/tls-mode'

/** Detection of the SMTP mode on loopback (Proton Bridge: SSL vs. STARTTLS). */

const servers: Server[] = []

function listen(server: Server): Promise<number> {
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port)
    })
  })
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve(null))))
  )
})

describe('detectImplicitTls', () => {
  it('erkennt STARTTLS-/Klartext-Modus an der sofortigen 220-Begrüßung', async () => {
    const port = await listen(
      createServer((socket) => socket.write('220 127.0.0.1 Proton Mail Bridge\r\n'))
    )
    forgetTlsMode('127.0.0.1', port)
    expect(await detectImplicitTls('127.0.0.1', port, 500)).toBe(false)
  })

  it('erkennt SSL-Modus daran, dass der Server stumm auf den Handshake wartet', async () => {
    const port = await listen(createServer(() => {}))
    forgetTlsMode('127.0.0.1', port)
    expect(await detectImplicitTls('127.0.0.1', port, 300)).toBe(true)
  })

  it('cached die erkannte Betriebsart; forgetTlsMode erzwingt Neuerkennung', async () => {
    let connections = 0
    const port = await listen(
      createServer((socket) => {
        connections += 1
        socket.write('220 bereit\r\n')
      })
    )
    forgetTlsMode('127.0.0.1', port)
    await detectImplicitTls('127.0.0.1', port, 500)
    await detectImplicitTls('127.0.0.1', port, 500)
    expect(connections).toBe(1)
    forgetTlsMode('127.0.0.1', port)
    await detectImplicitTls('127.0.0.1', port, 500)
    expect(connections).toBe(2)
  })

  it('cached Verbindungsfehler nicht (Bridge war nur gerade nicht da)', async () => {
    const server = createServer((socket) => socket.write('220 da\r\n'))
    const port = await listen(server)
    await new Promise((resolve) => server.close(() => resolve(null)))
    // Server gone → error, no verdict on the mode, no cache
    expect(await detectImplicitTls('127.0.0.1', port, 300)).toBe(false)
    // Back again → freshly detected instead of served from cache
    const server2 = createServer(() => {})
    servers.push(server2)
    await new Promise((resolve) => server2.listen(port, '127.0.0.1', () => resolve(null)))
    expect(await detectImplicitTls('127.0.0.1', port, 300)).toBe(true)
  })
})
