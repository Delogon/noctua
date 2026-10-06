import { ipcMain, type BrowserWindow } from 'electron'
import {
  invokeContract,
  INVOKE_CHANNELS,
  type IpcHandlers,
  type PushChannel,
  type PushPayload
} from '@shared/ipc-contract'
import { isTrustedIpcSender, sanitizeIpcError, type TrustedAppPages } from '../security'

/**
 * Bindet den IPC-Vertrag an konkrete Handler. Input und Output jedes Aufrufs
 * werden gegen das zod-Schema des Kanals validiert. Jeder Aufruf muss vom
 * Top-Frame des Hauptfensters auf der App-Seite kommen (SEC-7); Fehler gehen
 * bereinigt an den Renderer, Details nur ins Main-Log (SEC-8).
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
        // TS kann die Korrelation Kanal↔Handler-Signatur über die Map-Iteration
        // nicht verfolgen; der Contract-Typ IpcHandlers stellt sie sicher.
        const result = await (handlers[channel] as (i: unknown) => unknown)(input)
        phase = 'output'
        return spec.output.parse(result)
      } catch (error) {
        console.error(`[ipc] ${channel} (${phase}) fehlgeschlagen:`, error)
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
  window.webContents.send(channel, payload)
}
