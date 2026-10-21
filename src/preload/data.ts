import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { BackupInfo, ExportResult, SyncStatus } from '../shared/data'

export const dataApi = {
  /** Asks for a folder and writes notes and tasks there as Markdown; null if cancelled */
  exportMarkdown: (): Promise<ExportResult> => ipcRenderer.invoke('data:export-markdown'),
  backup: (): Promise<BackupInfo> => ipcRenderer.invoke('data:backup'),
  /** Newest first */
  listBackups: (): Promise<BackupInfo[]> => ipcRenderer.invoke('data:list-backups'),
  openBackups: (): Promise<string> => ipcRenderer.invoke('data:open-backups'),
  /** Asks for a backup file and confirmation, then relaunches the app; false if cancelled */
  restore: (): Promise<boolean> => ipcRenderer.invoke('data:restore'),
  syncStatus: (): Promise<SyncStatus> => ipcRenderer.invoke('data:sync-status'),
  setSyncEnabled: (enabled: boolean): Promise<SyncStatus> => ipcRenderer.invoke('data:sync-enable', enabled),
  syncNow: (): Promise<SyncStatus> => ipcRenderer.invoke('data:sync-now'),
  onSyncStatus: (cb: (s: SyncStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, s: SyncStatus): void => cb(s)
    ipcRenderer.on('data:sync-status', listener)
    return () => ipcRenderer.removeListener('data:sync-status', listener)
  }
}

export type DataApi = typeof dataApi
