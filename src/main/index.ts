import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, shell, type Tray } from 'electron'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { registerAiIpc } from './ai/ipc'
import { registerVoice } from './voice'
import { startReminders } from './reminders'
import { prepareDatabase, registerData } from './data'
import { registerAttachments, registerAttachmentScheme, SCHEME } from './attachments'
import { initTemplates } from './templates'
import { createTray, openedAtLogin } from './tray'
import { openCapture, registerCapture } from './capture'
import { VOICE_SHORTCUT } from './voice'
import { startDigests } from './digestSchedule'
import { registerSemantic } from './semantic'

// Keep data in ~/Library/Application Support/ai-notes for both `npm run dev` and the
// packaged "AI Notes.app" (whose name would otherwise pick a different folder).
app.setPath('userData', join(app.getPath('appData'), 'ai-notes'))

// One window per app: a second launch (e.g. from the Dock while running) focuses it.
if (!app.requestSingleInstanceLock()) app.exit(0)

registerAttachmentScheme()

let mainWindow: BrowserWindow | null = null
// Held so the menu bar icon isn't garbage collected.
let tray: Tray | null = null

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
  app.dock?.show()
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // With the window closed AI Notes lives in the menu bar only (reminders keep firing).
    if (process.platform === 'darwin') app.dock?.hide()
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  // Links in notes and assistant answers open in the browser instead of replacing the app.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${SCHEME}:`)) return event.preventDefault()
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

/** Brings the main window up (creating it if closed); with a task id, opens that task. */
function showMain(taskId?: string): BrowserWindow {
  if (!mainWindow) createWindow()
  const win = mainWindow!
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  app.focus({ steal: true })
  if (taskId) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('reminders:open', taskId))
    else win.webContents.send('reminders:open', taskId)
  }
  return win
}

app.on('second-instance', () => showMain())

app.whenReady().then(() => {
  const dbPath = join(app.getPath('userData'), 'ai-notes.db')
  prepareDatabase(dbPath)
  const store = initStore(dbPath)
  registerIpc(store)
  registerData(store, dbPath)
  initTemplates(join(app.getPath('userData'), 'templates.json'))
  registerAttachments(store, app.getPath('userData'))
  registerAiIpc()
  registerVoice(
    () => mainWindow,
    () => void openCapture(true)
  )
  const capture = registerCapture(showMain)
  // Started by macOS at login: stay in the menu bar until the user asks for the window.
  if (openedAtLogin()) app.dock?.hide()
  else createWindow()
  startReminders(store, () => showMain())
  tray = createTray(store, {
    showMain,
    openCapture: (voice) => void openCapture(voice),
    // Read when the menu opens: the voice hotkey registers a moment after this runs.
    shortcuts: () => ({
      capture: capture.shortcut,
      voice: globalShortcut.isRegistered(VOICE_SHORTCUT) ? VOICE_SHORTCUT : null
    })
  })
  startDigests(store, () => showMain())
  registerSemantic(store)

  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
