import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { INVOKE_CHANNELS, PUSH_CHANNELS, type NoctuaApi } from '@shared/ipc-contract'

const invokeChannels: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const pushChannels: ReadonlySet<string> = new Set(PUSH_CHANNELS)

/**
 * Generic but whitelist-protected bridge: only the channels declared in the
 * IPC contract are reachable. Payload validation happens on the main side
 * (the renderer is considered less trustworthy).
 */
const api: NoctuaApi = {
  invoke: (channel, input) => {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, input)
  },
  on: (channel, callback) => {
    if (!pushChannels.has(channel)) {
      throw new Error(`Unknown push channel: ${channel}`)
    }
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      callback(payload as Parameters<typeof callback>[0])
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('noctua', api)
