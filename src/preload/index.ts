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
  TaskQuery,
  Topic,
  TopicInput,
  TopicPatch,
  TrashItem,
  TrashKind
} from '../shared/types'
import { aiApi } from './ai'
import { voiceApi } from './voice'

const api = {
  notes: {
    list: (q?: NoteQuery): Promise<Note[]> => ipcRenderer.invoke('notes:list', q),
    get: (id: string): Promise<Note | null> => ipcRenderer.invoke('notes:get', id),
    create: (input: NoteInput): Promise<Note> => ipcRenderer.invoke('notes:create', input),
    update: (id: string, patch: NotePatch): Promise<Note> => ipcRenderer.invoke('notes:update', id, patch),
    /** Moves the note to the trash */
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
    /** Moves the task to the trash */
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('tasks:delete', id)
  },
  topics: {
    /** Sorted by name */
    list: (): Promise<Topic[]> => ipcRenderer.invoke('topics:list'),
    get: (id: string): Promise<Topic | null> => ipcRenderer.invoke('topics:get', id),
    create: (input: TopicInput): Promise<Topic> => ipcRenderer.invoke('topics:create', input),
    update: (id: string, patch: TopicPatch): Promise<Topic> => ipcRenderer.invoke('topics:update', id, patch),
    /** Moves the topic to the trash; its tasks are kept and show without a topic until it is restored */
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('topics:delete', id)
  },
  trash: {
    /** Most recently deleted first */
    list: (): Promise<TrashItem[]> => ipcRenderer.invoke('trash:list'),
    restore: (kind: TrashKind, id: string): Promise<boolean> => ipcRenderer.invoke('trash:restore', kind, id),
    /** Erases an item for good */
    delete: (kind: TrashKind, id: string): Promise<boolean> => ipcRenderer.invoke('trash:delete', kind, id),
    /** Erases everything in the trash; returns how many items */
    empty: (): Promise<number> => ipcRenderer.invoke('trash:empty')
  },
  /** Claude assistant: API key settings and chat. */
  ai: aiApi,
  /** Fires after any change, including ones made by the AI assistant. Returns an unsubscribe fn. */
  onDataChanged: (cb: (change: DataChange) => void): (() => void) => {
    const listener = (_e: unknown, change: DataChange): void => cb(change)
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  },
  voice: voiceApi,
  /** Fires when the user clicks a reminder notification. Returns an unsubscribe fn. */
  onReminderOpen: (cb: (taskId: string) => void): (() => void) => {
    const listener = (_e: unknown, taskId: string): void => cb(taskId)
    ipcRenderer.on('reminders:open', listener)
    return () => ipcRenderer.removeListener('reminders:open', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
