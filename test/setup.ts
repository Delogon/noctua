import { vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Electron is not available in the test runtime — all APIs used in the main
 * process are mocked here. This lets pure logic and the DB integration tests
 * run under Node/Vitest without needing the Electron context.
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
    show(): void {
      // Test double: notifications are only recorded, not shown
    }
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
    powerMonitor: {
      isOnBatteryPower: () => false,
      on: vi.fn()
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      // Reversible „encryption" for vault behavior in tests
      encryptString: (s: string) => Buffer.concat([cipherPrefix, Buffer.from(s, 'utf8')]),
      decryptString: (b: Buffer) => b.subarray(cipherPrefix.length).toString('utf8')
    },
    Notification: MockNotification,
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openExternal: vi.fn() },
    ipcMain: { handle: vi.fn(), on: vi.fn() }
  }
})

// Deterministic model cache path for possible transitive imports
process.env.NOCTUA_TEST = '1'
void join
