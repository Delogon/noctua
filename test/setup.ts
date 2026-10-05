import { vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Electron ist im Test-Runtime nicht vorhanden — alle im Main-Prozess
 * genutzten APIs werden hier gemockt. Reine Logik und die DB-Integrationstests
 * laufen dadurch unter Node/Vitest, ohne den Electron-Kontext zu brauchen.
 */
const cipherPrefix = Buffer.from('enc:')

vi.mock('electron', () => {
  const notificationInstances: Array<{ show: () => void; on: () => void }> = []
  class MockNotification {
    static isSupported(): boolean {
      return true
    }
    on(): this {
      return this
    }
    show(): void {}
    constructor() {
      notificationInstances.push(this)
    }
  }
  return {
    app: {
      getPath: () => tmpdir(),
      getVersion: () => '0.0.0-test',
      setBadgeCount: vi.fn(),
      getName: () => 'noctua-test',
      isPackaged: false,
      getAppPath: () => process.cwd(),
      on: vi.fn()
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      // Reversibles „Verschlüsseln" fürs Vault-Verhalten in Tests
      encryptString: (s: string) => Buffer.concat([cipherPrefix, Buffer.from(s, 'utf8')]),
      decryptString: (b: Buffer) => b.subarray(cipherPrefix.length).toString('utf8')
    },
    Notification: MockNotification,
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openExternal: vi.fn() },
    powerMonitor: { on: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() }
  }
})

// Deterministischer Modell-Cache-Pfad für evtl. transitive Importe
process.env.NOCTUA_TEST = '1'
void join
