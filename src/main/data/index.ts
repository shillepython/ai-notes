import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { Store } from '../store'
import type { ExportResult, SyncStatus } from '../../shared/data'
import { buildMarkdownExport } from './markdown'
import { applyPendingRestore, createBackup, listBackups, scheduleRestore, startAutoBackup } from './backup'
import { SyncService } from './sync'

const backupDir = (): string => join(app.getPath('userData'), 'backups')

/** Call before the store opens: puts a restore the user chose into place. */
export function prepareDatabase(dbPath: string): void {
  try {
    applyPendingRestore(dbPath, backupDir())
  } catch (err) {
    console.error('Restore failed:', err)
  }
}

const dialogParent = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => w.isVisible())

async function exportMarkdown(store: Store): Promise<ExportResult> {
  const win = dialogParent()
  const options: Electron.OpenDialogOptions = {
    title: 'Куда сохранить заметки и задачи в Markdown?',
    buttonLabel: 'Экспортировать сюда',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled || !res.filePaths[0]) return null
  const folder = join(res.filePaths[0], `AI Notes ${new Date().toLocaleDateString('sv')}`)
  const files = buildMarkdownExport({ notes: store.listNotes(), tasks: store.listTasks(), topics: store.listTopics() })
  for (const f of files) {
    const path = join(folder, ...f.path.split('/'))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, f.content)
  }
  shell.openPath(folder)
  return { folder, notes: files.length - 1 }
}

async function restoreBackup(dbPath: string): Promise<boolean> {
  const win = dialogParent()
  const pick: Electron.OpenDialogOptions = {
    title: 'Выбери резервную копию',
    defaultPath: backupDir(),
    filters: [{ name: 'База AI Notes', extensions: ['db'] }],
    properties: ['openFile']
  }
  const res = win ? await dialog.showOpenDialog(win, pick) : await dialog.showOpenDialog(pick)
  if (res.canceled || !res.filePaths[0]) return false
  const confirm: Electron.MessageBoxOptions = {
    type: 'warning',
    message: 'Восстановить данные из этой копии?',
    detail:
      'Все текущие заметки и задачи заменятся содержимым копии, приложение перезапустится. ' +
      'Текущее состояние сначала сохранится отдельной копией, так что это можно отменить. ' +
      'Если включена синхронизация, более новые правки с других Mac подтянутся снова.',
    buttons: ['Восстановить', 'Отмена'],
    defaultId: 0,
    cancelId: 1
  }
  const answer = win ? await dialog.showMessageBox(win, confirm) : await dialog.showMessageBox(confirm)
  if (answer.response !== 0) return false
  scheduleRestore(dbPath, res.filePaths[0])
  app.relaunch()
  app.exit(0)
  return true
}

/**
 * Backups, Markdown export and iCloud sync: `data:*` IPC channels, the "Данные" menu,
 * a daily automatic backup, and the sync service.
 */
export function registerData(store: Store, dbPath: string): void {
  const sendStatus = (s: SyncStatus): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('data:sync-status', s)
    buildMenu()
  }
  const sync = new SyncService(store, join(app.getPath('userData'), 'sync.json'), sendStatus)
  startAutoBackup(store, backupDir())

  const backupNow = (): ReturnType<typeof createBackup> => createBackup(store, backupDir())

  ipcMain.handle('data:export-markdown', () => exportMarkdown(store))
  ipcMain.handle('data:backup', () => backupNow())
  ipcMain.handle('data:list-backups', () => listBackups(backupDir()))
  ipcMain.handle('data:open-backups', () => {
    mkdirSync(backupDir(), { recursive: true })
    return shell.openPath(backupDir())
  })
  ipcMain.handle('data:restore', () => restoreBackup(dbPath))
  ipcMain.handle('data:sync-status', () => sync.status())
  ipcMain.handle('data:sync-enable', (_e, enabled: boolean) => sync.setEnabled(enabled))
  ipcMain.handle('data:sync-now', () => sync.syncNow())

  const report = (fn: () => unknown): (() => Promise<void>) => async () => {
    try {
      await fn()
    } catch (err) {
      dialog.showErrorBox('AI Notes', err instanceof Error ? err.message : String(err))
    }
  }

  function buildMenu(): void {
    const s = sync.status()
    const dataMenu: MenuItemConstructorOptions[] = [
      { label: 'Экспорт в Markdown…', accelerator: 'CmdOrCtrl+Shift+E', click: report(() => exportMarkdown(store)) },
      { type: 'separator' },
      {
        label: 'Создать резервную копию',
        click: report(() => {
          const b = backupNow()
          shell.showItemInFolder(b.path)
        })
      },
      { label: 'Восстановить из копии…', click: report(() => restoreBackup(dbPath)) },
      { label: 'Открыть папку с копиями', click: report(() => (mkdirSync(backupDir(), { recursive: true }), shell.openPath(backupDir()))) },
      { type: 'separator' },
      {
        label: 'Синхронизация через iCloud Drive',
        type: 'checkbox',
        checked: s.enabled,
        enabled: s.available,
        click: report(() => sync.setEnabled(!sync.status().enabled))
      },
      { label: 'Синхронизировать сейчас', enabled: s.enabled, click: report(() => sync.syncNow()) },
      { label: 'Показать папку синхронизации', enabled: s.enabled, click: report(() => shell.openPath(s.folder)) }
    ]
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { label: 'Данные', submenu: dataMenu },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
  }

  buildMenu()
  sync.resume()
  // A last snapshot on quit, so the other Macs see edits made just before closing.
  app.on('before-quit', () => sync.syncNow())
}
