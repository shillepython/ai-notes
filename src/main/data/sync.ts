import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import type { Snapshot, Store } from '../store'
import type { SyncStatus } from '../../shared/data'

/*
 * Sync between Macs through iCloud Drive without putting the live SQLite database there
 * (iCloud copies files whenever it likes and would corrupt a database that is being written).
 *
 * Every Mac writes a JSON snapshot of all its rows to "AI Notes/devices/<its id>.json" and
 * only ever writes its own file, so iCloud never has two Macs editing one file. Each Mac
 * reads the other Macs' files and merges them row by row: the most recent change wins,
 * and things erased from the trash stay erased (see Store.mergeSnapshot).
 */

const ICLOUD_DRIVE = join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
const DEFAULT_FOLDER = join(ICLOUD_DRIVE, 'AI Notes')
const POLL_EVERY = 60 * 1000
const AFTER_CHANGE = 5 * 1000

interface Settings {
  enabled: boolean
  deviceId: string
  folder: string
}

interface DeviceFile {
  format: 1
  deviceId: string
  deviceName: string
  writtenAt: string
  data: Snapshot
}

export class SyncService {
  private settings: Settings
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private merging = false
  private seen = new Map<string, number>()
  private lastWritten = ''
  private lastSyncAt: string | null = null
  private lastError: string | null = null
  private devices: SyncStatus['devices'] = []

  private store: Store
  private settingsPath: string
  private onStatus: (s: SyncStatus) => void

  constructor(store: Store, settingsPath: string, onStatus: (s: SyncStatus) => void) {
    this.store = store
    this.settingsPath = settingsPath
    this.onStatus = onStatus
    this.settings = this.readSettings()
    store.on('changed', () => {
      if (this.merging || !this.settings.enabled) return
      if (this.debounce) clearTimeout(this.debounce)
      this.debounce = setTimeout(() => this.syncNow(), AFTER_CHANGE)
    })
  }

  /** Starts syncing if the user turned it on earlier. */
  resume(): void {
    if (this.settings.enabled) this.start()
  }

  private readSettings(): Settings {
    try {
      const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<Settings>
      return {
        enabled: raw.enabled === true,
        deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : randomUUID(),
        folder: typeof raw.folder === 'string' && raw.folder ? raw.folder : DEFAULT_FOLDER
      }
    } catch {
      return { enabled: false, deviceId: randomUUID(), folder: DEFAULT_FOLDER }
    }
  }

  private saveSettings(): void {
    writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2))
  }

  private get devicesDir(): string {
    return join(this.settings.folder, 'devices')
  }

  status(): SyncStatus {
    return {
      enabled: this.settings.enabled,
      available: existsSync(ICLOUD_DRIVE) || this.settings.folder !== DEFAULT_FOLDER,
      folder: this.settings.folder,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      devices: this.devices
    }
  }

  setEnabled(enabled: boolean): SyncStatus {
    if (enabled && !this.status().available) {
      throw new Error('iCloud Drive не найден. Включи его в Системных настройках → Apple ID → iCloud → iCloud Drive.')
    }
    this.settings.enabled = enabled
    this.saveSettings()
    if (enabled) this.start()
    else this.stop()
    this.publish()
    return this.status()
  }

  private start(): void {
    this.stop()
    this.syncNow()
    this.timer = setInterval(() => this.syncNow(), POLL_EVERY)
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    this.timer = this.debounce = null
  }

  /** Merges the other Macs' snapshots, then writes this Mac's own. */
  syncNow(): SyncStatus {
    if (!this.settings.enabled) return this.status()
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = null
    try {
      mkdirSync(this.devicesDir, { recursive: true })
      this.mergeOthers()
      this.writeOwn()
      this.lastSyncAt = new Date().toISOString()
      this.lastError = null
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      console.error('Sync failed:', err)
    }
    this.publish()
    return this.status()
  }

  private mergeOthers(): void {
    const own = `${this.settings.deviceId}.json`
    const devices: SyncStatus['devices'] = []
    for (const name of readdirSync(this.devicesDir)) {
      const path = join(this.devicesDir, name)
      // A file iCloud has not downloaded yet shows up as ".<name>.icloud"; ask for it and pick it up next time.
      if (name.startsWith('.') && name.endsWith('.icloud')) {
        download(path)
        continue
      }
      if (name === own || !name.endsWith('.json')) continue
      let file: DeviceFile
      try {
        file = JSON.parse(readFileSync(path, 'utf8')) as DeviceFile
      } catch {
        // Probably still being downloaded; try again on the next round.
        continue
      }
      devices.push({ name: file.deviceName, writtenAt: file.writtenAt })
      const mtime = statSync(path).mtimeMs
      if (this.seen.get(path) === mtime) continue
      this.merging = true
      try {
        this.store.mergeSnapshot(file.data)
      } finally {
        this.merging = false
      }
      this.seen.set(path, mtime)
    }
    this.devices = devices.sort((a, b) => b.writtenAt.localeCompare(a.writtenAt))
  }

  private writeOwn(): void {
    const data = this.store.snapshot()
    const json = JSON.stringify(data)
    const hash = createHash('sha256').update(json).digest('hex')
    const path = join(this.devicesDir, `${this.settings.deviceId}.json`)
    // Unchanged data is not rewritten, so iCloud has nothing to upload.
    if (hash === this.lastWritten && existsSync(path)) return
    const file: DeviceFile = {
      format: 1,
      deviceId: this.settings.deviceId,
      deviceName: hostname().replace(/\.local$/, ''),
      writtenAt: new Date().toISOString(),
      data
    }
    // Write next to it and rename, so iCloud never uploads a half-written file.
    const tmp = join(this.settings.folder, `.${this.settings.deviceId}.tmp`)
    writeFileSync(tmp, JSON.stringify(file))
    renameSync(tmp, path)
    this.lastWritten = hash
  }

  private publish(): void {
    this.onStatus(this.status())
  }

  dispose(): void {
    this.stop()
  }
}

function download(placeholder: string): void {
  if (process.platform !== 'darwin') return
  try {
    spawn('brctl', ['download', placeholder], { stdio: 'ignore' }).on('error', () => {})
  } catch {
    // brctl missing: iCloud will download the file on its own eventually.
  }
}
