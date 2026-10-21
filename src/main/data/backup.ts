import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Store } from '../store'
import type { BackupInfo } from '../../shared/data'

// Automatic copies are made at most this often, and this many of the newest are kept.
const AUTO_EVERY = 24 * 60 * 60 * 1000
const KEEP = 14
const CHECK_EVERY = 60 * 60 * 1000

const PREFIX = 'ai-notes-'

const stamp = (d: Date): string => d.toISOString().slice(0, 19).replace(/:/g, '-')

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    .map((name) => {
      const st = statSync(join(dir, name))
      return { path: join(dir, name), name, createdAt: st.mtime.toISOString(), bytes: st.size }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

/** Writes a consistent copy of the database into `dir` and drops the oldest copies beyond KEEP. */
export function createBackup(store: Store, dir: string, label = ''): BackupInfo {
  mkdirSync(dir, { recursive: true })
  const name = `${PREFIX}${stamp(new Date())}${label ? `-${label}` : ''}.db`
  const path = join(dir, name)
  rmSync(path, { force: true })
  store.backupTo(path)
  for (const old of listBackups(dir).slice(KEEP)) rmSync(old.path, { force: true })
  return listBackups(dir).find((b) => b.path === path)!
}

/** Makes a backup now if the newest one is older than a day, then keeps checking every hour. */
export function startAutoBackup(store: Store, dir: string): () => void {
  const check = (): void => {
    try {
      const newest = listBackups(dir)[0]
      if (!newest || Date.now() - Date.parse(newest.createdAt) > AUTO_EVERY) createBackup(store, dir)
    } catch (err) {
      console.error('Auto backup failed:', err)
    }
  }
  check()
  const timer = setInterval(check, CHECK_EVERY)
  return () => clearInterval(timer)
}

/** Throws unless the file is an AI Notes database. */
export function checkBackupFile(path: string): void {
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
    if (!tables.includes('notes') || !tables.includes('tasks')) throw new Error('not an AI Notes database')
  } catch {
    throw new Error('Этот файл не похож на резервную копию AI Notes')
  } finally {
    db?.close()
  }
}

const pendingPath = (dbPath: string): string => `${dbPath}.restore`

/**
 * Schedules a restore: the copy replaces the database on the next launch, before anything
 * opens it. The caller relaunches the app.
 */
export function scheduleRestore(dbPath: string, backupPath: string): void {
  checkBackupFile(backupPath)
  copyFileSync(backupPath, pendingPath(dbPath))
}

/** Runs at startup before the store opens: swaps in a scheduled restore, keeping the current database as a backup. */
export function applyPendingRestore(dbPath: string, backupDir: string): void {
  const pending = pendingPath(dbPath)
  if (!existsSync(pending)) return
  if (existsSync(dbPath)) {
    // Fold the WAL into the main file so the copy of the current state is complete.
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    mkdirSync(backupDir, { recursive: true })
    copyFileSync(dbPath, join(backupDir, `${PREFIX}${stamp(new Date())}-before-restore.db`))
  }
  for (const f of [`${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true })
  renameSync(pending, dbPath)
}
