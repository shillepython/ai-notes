/** iCloud Drive sync state, shown in the command palette and the "Данные" menu. */
export interface SyncStatus {
  enabled: boolean
  /** iCloud Drive is set up on this Mac */
  available: boolean
  folder: string
  lastSyncAt: string | null
  lastError: string | null
  /** The other Macs that sync into the folder, most recently synced first */
  devices: { name: string; writtenAt: string }[]
}

export interface BackupInfo {
  path: string
  name: string
  createdAt: string
  bytes: number
}

/** null when the user cancelled the folder dialog. */
export type ExportResult = { folder: string; notes: number } | null
