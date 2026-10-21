import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CaptureApi, CaptureOpen } from '@shared/capture'

// Exposed as window.api.capture; used by the quick capture window only.
export const captureApi: CaptureApi = {
  onOpen: (cb) => {
    const listener = (_e: IpcRendererEvent, opts: CaptureOpen): void => cb(opts)
    ipcRenderer.on('capture:open', listener)
    return () => ipcRenderer.removeListener('capture:open', listener)
  },
  onClose: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('capture:close', listener)
    return () => ipcRenderer.removeListener('capture:close', listener)
  },
  onVoice: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('capture:voice', listener)
    return () => ipcRenderer.removeListener('capture:voice', listener)
  },
  hidden: () => ipcRenderer.send('capture:hidden'),
  setInteractive: (on) => ipcRenderer.send('capture:interactive', on),
  openMain: () => ipcRenderer.send('capture:openMain')
}
