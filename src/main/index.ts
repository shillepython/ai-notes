import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { registerAiIpc } from './ai/ipc'
import { registerVoice } from './voice'
import { startReminders } from './reminders'
import { prepareDatabase, registerData } from './data'

// Keep data in ~/Library/Application Support/ai-notes for both `npm run dev` and the
// packaged "AI Notes.app" (whose name would otherwise pick a different folder).
app.setPath('userData', join(app.getPath('appData'), 'ai-notes'))

// One window per app: a second launch (e.g. from the Dock while running) focuses it.
if (!app.requestSingleInstanceLock()) app.exit(0)

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
  // Links in notes and assistant answers open in the browser instead of replacing the app.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL'])) return
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'ai-notes.db')
  prepareDatabase(dbPath)
  const store = initStore(dbPath)
  registerIpc(store)
  registerData(store, dbPath)
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
