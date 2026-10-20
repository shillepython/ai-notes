import { ipcRenderer, type IpcRendererEvent } from 'electron'

export type VoiceModelProgress = { status: string; file?: string; progress?: number }

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const voiceApi = {
  ensureMicAccess: (): Promise<boolean> => ipcRenderer.invoke('voice:ensure-mic'),
  warmup: (): Promise<void> => ipcRenderer.invoke('voice:warmup'),
  transcribe: (audio: Float32Array): Promise<string> => ipcRenderer.invoke('voice:transcribe', audio),
  getShortcut: (): Promise<string | null> => ipcRenderer.invoke('voice:shortcut'),
  onToggle: (cb: () => void): (() => void) => subscribe('voice:toggle', cb),
  onModelProgress: (cb: (p: VoiceModelProgress) => void): (() => void) =>
    subscribe('voice:model-progress', cb)
}

export type VoiceApi = typeof voiceApi
