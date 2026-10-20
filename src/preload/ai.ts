import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiApi, AiEvent } from '@shared/ai'

// Exposed to the renderer as window.api.ai (merged into the 'api' bridge in ./index.ts).
export const aiApi: AiApi = {
  getSettings: () => ipcRenderer.invoke('ai:getSettings'),
  setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  clearKey: () => ipcRenderer.invoke('ai:clearKey'),
  updateSettings: (patch) => ipcRenderer.invoke('ai:updateSettings', patch),
  send: (text, requestId) => ipcRenderer.invoke('ai:send', text, requestId),
  cancel: () => ipcRenderer.invoke('ai:cancel'),
  resetConversation: () => ipcRenderer.invoke('ai:reset'),
  codePrompt: (task) => ipcRenderer.invoke('ai:codePrompt', task),
  onEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: AiEvent): void => cb(event)
    ipcRenderer.on('ai:event', listener)
    return () => ipcRenderer.removeListener('ai:event', listener)
  }
}
