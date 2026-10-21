import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import type { CaptureOpen } from '../shared/capture'

// Quick capture: a global hotkey drops a small "island" out of the MacBook notch (or the
// top edge of the screen) where you type or dictate something for the assistant.
export const CAPTURE_SHORTCUT = process.env.CAPTURE_SHORTCUT || 'Alt+Space'

// The window is a fixed transparent canvas at the top of the screen; the island inside it
// animates its own size. Transparent parts let clicks through (see capture:interactive).
const WIDTH = 640
const HEIGHT = 520
// Electron can't read the notch size; 14" and 16" MacBook notches are about this wide.
const NOTCH_WIDTH = 196

let win: BrowserWindow | null = null
let ready: Promise<void> | null = null

function create(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // NSPanel: takes keyboard focus without activating the app, so the main window
    // doesn't jump to the front, and it floats over full-screen apps.
    type: 'panel',
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  // Above the menu bar, on every Space, including full-screen ones.
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.setHiddenInMissionControl(true)
  w.setIgnoreMouseEvents(true, { forward: true })
  w.on('closed', () => {
    if (win === w) {
      win = null
      ready = null
    }
  })

  ready = new Promise((resolve) => w.webContents.once('did-finish-load', () => resolve()))
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    w.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/capture.html`)
  } else {
    w.loadFile(join(__dirname, '../renderer/capture.html'))
  }
  return w
}

function getWin(): BrowserWindow {
  if (!win || win.isDestroyed()) win = create()
  return win
}

/** Shows the island on the display under the cursor; if it's already up, toggles or focuses it. */
export async function openCapture(voice: boolean): Promise<void> {
  const w = getWin()
  if (w.isVisible()) {
    if (voice) w.webContents.send('capture:voice')
    else if (w.isFocused()) w.webContents.send('capture:close')
    else w.focus()
    return
  }
  await ready
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { bounds, workArea } = display
  // The menu bar is ~24pt high without a notch and ~32-38pt on notched MacBooks.
  const menuBar = workArea.y - bounds.y
  const notched = process.platform === 'darwin' && display.internal && menuBar >= 30
  w.setBounds({ x: Math.round(bounds.x + (bounds.width - WIDTH) / 2), y: bounds.y, width: WIDTH, height: HEIGHT })
  const payload: CaptureOpen = {
    voice,
    notch: notched ? { width: NOTCH_WIDTH, height: menuBar } : null
  }
  w.webContents.send('capture:open', payload)
  w.show()
  w.focus()
}

export function registerCapture(showMain: (taskId?: string) => void): { shortcut: string | null } {
  // Create early so the first open is instant.
  getWin()

  ipcMain.on('capture:hidden', () => win?.hide())
  ipcMain.on('capture:interactive', (_e, on: boolean) => {
    win?.setIgnoreMouseEvents(!on, { forward: true })
  })
  ipcMain.on('capture:openMain', () => {
    win?.webContents.send('capture:close')
    showMain()
  })

  const ok = globalShortcut.register(CAPTURE_SHORTCUT, () => void openCapture(false))
  if (!ok) console.warn(`[capture] could not register global shortcut ${CAPTURE_SHORTCUT}`)
  app.on('will-quit', () => globalShortcut.unregister(CAPTURE_SHORTCUT))
  return { shortcut: ok ? CAPTURE_SHORTCUT : null }
}
