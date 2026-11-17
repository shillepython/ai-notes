import { ipcRenderer, webUtils } from 'electron'
import type { DocFile, DocLibrary } from '../shared/docs'

export const docsApi = {
  /** Documents (newest first) and templates in ~/Documents/AI Notes, plus .md files opened from elsewhere */
  list: (): Promise<DocLibrary> => ipcRenderer.invoke('docs:list'),
  read: (path: string): Promise<string> => ipcRenderer.invoke('docs:read', path),
  /** Returns the new modification time */
  write: (path: string, content: string): Promise<number> => ipcRenderer.invoke('docs:write', path, content),
  /** New document or template; `fromTemplate` is a template's path */
  create: (input: { name?: string; content?: string; fromTemplate?: string; template?: boolean }): Promise<DocFile> =>
    ipcRenderer.invoke('docs:create', input),
  /** File picker; returns the opened paths, [] if cancelled */
  open: (): Promise<string[]> => ipcRenderer.invoke('docs:open'),
  /** Dropped files: opens the markdown ones in place */
  openFiles: (files: File[]): Promise<string[]> =>
    ipcRenderer.invoke('docs:open-paths', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  /** Copies .md files into the templates folder; asks for them when none are given */
  importTemplates: (files?: File[]): Promise<DocFile[]> =>
    ipcRenderer.invoke('docs:import-templates', files?.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  /** Returns the new path */
  rename: (path: string, name: string): Promise<string> => ipcRenderer.invoke('docs:rename', path, name),
  /** Ours go to the Trash, others are only removed from the list */
  remove: (path: string): Promise<'trashed' | 'forgotten'> => ipcRenderer.invoke('docs:remove', path),
  /** Save dialog (Downloads by default); returns the saved path or null */
  export: (content: string, name: string): Promise<string | null> => ipcRenderer.invoke('docs:export', content, name),
  /** Shows the file in Finder, or the documents folder without a path */
  reveal: (path?: string): Promise<boolean> => ipcRenderer.invoke('docs:reveal', path),
  onChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('docs:changed', listener)
    return () => ipcRenderer.removeListener('docs:changed', listener)
  },
  /** A file opened from Finder ("Open With" / Dock) */
  onOpenPath: (cb: (path: string) => void): (() => void) => {
    const listener = (_e: unknown, path: string): void => cb(path)
    ipcRenderer.on('docs:open-path', listener)
    return () => ipcRenderer.removeListener('docs:open-path', listener)
  }
}
