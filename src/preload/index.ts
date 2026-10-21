import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Attachment,
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
import type { NoteTemplate } from '../shared/templates'
import { aiApi } from './ai'
import { voiceApi } from './voice'
import { dataApi } from './data'
import { captureApi } from './capture'

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
  attachments: {
    /** Copies pasted or dropped files into the app's storage. Files from disk are copied by path, pasted ones by bytes. */
    add: async (files: File[]): Promise<Attachment[]> => {
      const out: Attachment[] = []
      for (const file of files) {
        const path = webUtils.getPathForFile(file)
        if (path) out.push(...((await ipcRenderer.invoke('attachments:copy', [path])) as Attachment[]))
        else {
          const name = file.name || `Вставка ${new Date().toLocaleString('sv-SE').replace(/:/g, '-')}.${file.type.split('/')[1] || 'bin'}`
          out.push(await ipcRenderer.invoke('attachments:save', name, new Uint8Array(await file.arrayBuffer())))
        }
      }
      return out
    },
    /** Opens the system file picker; returns the copied files, or [] if cancelled */
    pick: (): Promise<Attachment[]> => ipcRenderer.invoke('attachments:pick'),
    /** Opens an attachment:// file in its default app */
    open: (url: string): Promise<boolean> => ipcRenderer.invoke('attachments:open', url),
    reveal: (url: string): Promise<boolean> => ipcRenderer.invoke('attachments:reveal', url)
  },
  templates: {
    /** Built-in first, then the user's own */
    list: (): Promise<NoteTemplate[]> => ipcRenderer.invoke('templates:list'),
    create: (input: { name: string; title?: string; content: string; icon?: string }): Promise<NoteTemplate> =>
      ipcRenderer.invoke('templates:create', input),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke('templates:delete', id)
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
  /** Markdown export, backups and iCloud sync. */
  data: dataApi,
  /** Quick capture window (the island under the notch). */
  capture: captureApi,
  /** Fires when the user clicks a reminder notification. Returns an unsubscribe fn. */
  onReminderOpen: (cb: (taskId: string) => void): (() => void) => {
    const listener = (_e: unknown, taskId: string): void => cb(taskId)
    ipcRenderer.on('reminders:open', listener)
    return () => ipcRenderer.removeListener('reminders:open', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
