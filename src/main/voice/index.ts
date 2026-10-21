import { BrowserWindow, app, globalShortcut, ipcMain, systemPreferences } from 'electron'
import { loadTranscriber, transcribe, type ModelProgress } from './transcriber'

// Global push-to-talk: press once to start dictating, press again to stop and transcribe.
// In the focused main window it dictates into the assistant panel; anywhere else it opens
// quick capture under the notch. Electron global shortcuts have no key-up event,
// so a true hold-to-talk is only possible inside the window (see VoiceButton).
export const VOICE_SHORTCUT = process.env.VOICE_SHORTCUT || 'CommandOrControl+Shift+Space'

export function registerVoice(getWindow: () => BrowserWindow | null, openCapture: () => void): void {
  // Both the main window and quick capture show model download progress.
  const sendProgress = (p: ModelProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('voice:model-progress', p)
  }

  ipcMain.handle('voice:ensure-mic', async () => {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
    return systemPreferences.askForMediaAccess('microphone')
  })

  ipcMain.handle('voice:warmup', async () => {
    await loadTranscriber(sendProgress)
  })

  ipcMain.handle('voice:transcribe', async (_e, audio: Float32Array) => {
    return transcribe(audio, sendProgress)
  })

  ipcMain.handle('voice:shortcut', () => (globalShortcut.isRegistered(VOICE_SHORTCUT) ? VOICE_SHORTCUT : null))

  app.whenReady().then(() => {
    const ok = globalShortcut.register(VOICE_SHORTCUT, () => {
      const win = getWindow()
      if (!win || !win.isFocused()) return openCapture()
      win.webContents.send('voice:toggle')
    })
    if (!ok) console.warn(`[voice] could not register global shortcut ${VOICE_SHORTCUT}`)
  })

  app.on('will-quit', () => globalShortcut.unregister(VOICE_SHORTCUT))
}
