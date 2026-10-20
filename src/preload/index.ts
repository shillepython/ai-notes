import { contextBridge, ipcRenderer } from 'electron'
import type {
  CompleteTaskOptions,
  DataChange,
  Note,
  NoteInput,
  NotePatch,
  NoteQuery,
  Task,
  TaskInput,
  TaskPatch,
  TaskQuery
} from '../shared/types'
import { aiApi } from './ai'

const api = {
  notes: {
    list: (q?: NoteQuery): Promise<Note[]> => ipcRenderer.invoke('notes:list', q),
    get: (id: string): Promise<Note | null> => ipcRenderer.invoke('notes:get', id),
    create: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('notes:create', input),
    update: (id: string, patch: NotePatch): Promise<Note> => ipcRenderer.invoke('notes:update', id, patch),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('notes:delete', id)
  },
  tasks: {
    list: (q?: TaskQuery): Promise<Task[]> => ipcRenderer.invoke('tasks:list', q),
    get: (id: string): Promise<Task | null> => ipcRenderer.invoke('tasks:get', id),
    create: (input: TaskInput): Promise<Task> => ipcRenderer.invoke('tasks:create', input),
    update: (id: string, patch: TaskPatch): Promise<Task> => ipcRenderer.invoke('tasks:update', id, patch),
    complete: (id: string, opts?: CompleteTaskOptions): Promise<Task> =>
      ipcRenderer.invoke('tasks:complete', id, opts),
    reopen: (id: string): Promise<Task> => ipcRenderer.invoke('tasks:reopen', id),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:delete', id)
  },
  /** Claude assistant: API key settings and chat. */
  ai: aiApi,
  /** Fires after any change, including ones made by the AI assistant. Returns an unsubscribe fn. */
  onDataChanged: (cb: (change: DataChange) => void): (() => void) => {
    const listener = (_e: unknown, change: DataChange): void => cb(change)
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
