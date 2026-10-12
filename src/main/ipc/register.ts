import { ipcMain, type BrowserWindow } from 'electron'
import {
  invokeContract,
  INVOKE_CHANNELS,
  type IpcHandlers,
  type PushChannel,
  type PushPayload
} from '@shared/ipc-contract'
import { isTrustedIpcSender, sanitizeIpcError, type TrustedAppPages } from '../security'
import { metrics } from '../diagnostics/metrics'

/**
 * Binds the IPC contract to concrete handlers. Input and output of every call
 * are validated against the channel's zod schema. Every call must come from the
 * top frame of the main window on the app page (SEC-7); errors go to the
 * renderer sanitized, details only to the main log (SEC-8).
 */
export function registerIpcHandlers(
  handlers: IpcHandlers,
  getMainWindow: () => BrowserWindow | null,
  pages: () => TrustedAppPages
): void {
  for (const channel of INVOKE_CHANNELS) {
    const spec = invokeContract[channel]
    ipcMain.handle(channel, async (event, rawInput: unknown) => {
      const win = getMainWindow()
      const frame = event.senderFrame
      const trusted = isTrustedIpcSender(
        {
          isMainWindowTopFrame:
            !!win && !win.isDestroyed() && !!frame && frame === win.webContents.mainFrame,
          frameUrl: frame?.url
        },
        pages()
      )
      if (!trusted) {
        console.error(`[ipc] ${channel}: Sender abgelehnt (${frame?.url ?? 'kein Frame'})`)
        throw new Error('Nicht erlaubt')
      }

      let phase: 'input' | 'output' | 'handler' = 'input'
      try {
        const input = spec.input.parse(rawInput)
        phase = 'handler'
        const endCall = metrics.span(`ipc.${channel}`)
        // TS cannot track the channel↔handler signature correlation through the
        // map iteration; the contract type IpcHandlers guarantees it.
        let result: unknown
        try {
          result = await (handlers[channel] as (i: unknown) => unknown)(input)
        } finally {
          endCall()
        }
        phase = 'output'
        return spec.output.parse(result)
      } catch (error) {
        console.error(`[ipc] ${channel} (${phase}) fehlgeschlagen:`, error)
        metrics.count(`ipc.errors.${channel}`)
        throw sanitizeIpcError(error, phase)
      }
    })
  }
}

export function pushToWindow<C extends PushChannel>(
  window: BrowserWindow,
  channel: C,
  payload: PushPayload<C>
): void {
  if (window.isDestroyed()) return
  metrics.count(`push.${channel}`)
  window.webContents.send(channel, payload)
}
