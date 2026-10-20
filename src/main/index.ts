import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { registerAiIpc } from './ai/ipc'
import { registerVoice } from './voice'
import { startReminders } from './reminders'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    // Native translucent sidebar on macOS; the renderer keeps the content area opaque.
    ...(process.platform === 'darwin' && {
      vibrancy: 'sidebar' as const,
      visualEffectState: 'active' as const,
      backgroundColor: '#00000000'
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const store = initStore(join(app.getPath('userData'), 'ai-notes.db'))
  registerIpc(store)
  registerAiIpc()
  registerVoice(() => {
    if (!mainWindow) createWindow()
    return mainWindow
  })
  createWindow()
  startReminders(store, () => {
    if (!mainWindow) createWindow()
    return mainWindow!
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
