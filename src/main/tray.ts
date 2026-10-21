import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import type { Store } from './store'
import { trayIcon } from './trayIcon'

// Menu bar icon: keeps AI Notes reachable (and reminders firing) when the window is closed,
// plus the launch-at-login switch.

interface TrayActions {
  showMain(taskId?: string): void
  openCapture(voice: boolean): void
  /** Accelerators for the menu hints, or null when a shortcut could not be registered. */
  shortcuts(): { capture: string | null; voice: string | null }
}

const prefsPath = (): string => join(app.getPath('userData'), 'app-settings.json')

function readPrefs(): { loginItemOffered?: boolean } {
  try {
    return JSON.parse(readFileSync(prefsPath(), 'utf8'))
  } catch {
    return {}
  }
}

/**
 * The packaged app turns launch at login on once, the first time it runs, so reminders
 * keep working after a reboot; after that the menu bar switch decides. Dev builds never
 * register (the login item would point at the bare Electron binary).
 */
function ensureLoginItemDefault(): void {
  if (!app.isPackaged || process.platform !== 'darwin') return
  const prefs = readPrefs()
  if (prefs.loginItemOffered) return
  app.setLoginItemSettings({ openAtLogin: true })
  writeFileSync(prefsPath(), JSON.stringify({ ...prefs, loginItemOffered: true }, null, 2))
}

/** True when macOS started the app at login: then it stays in the menu bar without a window. */
export function openedAtLogin(): boolean {
  return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
}

const time = (iso: string): string => {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${hm}`
}

const clip = (s: string, n = 40): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function createTray(store: Store, actions: TrayActions): Tray {
  ensureLoginItemDefault()
  const tray = new Tray(trayIcon())
  tray.setToolTip('AI Notes')

  const build = (): Menu => {
    const reminders = store.upcomingReminders(3)
    const reminderItems: MenuItemConstructorOptions[] = reminders.length
      ? [
          { label: 'Ближайшие напоминания', enabled: false },
          ...reminders.map((t) => ({
            label: `${time(t.remindAt!)}  ${clip(t.title)}`,
            click: () => actions.showMain(t.id)
          })),
          { type: 'separator' as const }
        ]
      : []
    const login = app.getLoginItemSettings()
    const keys = actions.shortcuts()
    return Menu.buildFromTemplate([
      {
        label: 'Быстрый захват…',
        accelerator: keys.capture ?? undefined,
        registerAccelerator: false,
        click: () => actions.openCapture(false)
      },
      {
        label: 'Надиктовать…',
        accelerator: keys.voice ?? undefined,
        registerAccelerator: false,
        click: () => actions.openCapture(true)
      },
      { label: 'Открыть AI Notes', click: () => actions.showMain() },
      { type: 'separator' },
      ...reminderItems,
      {
        label: 'Открывать при входе в систему',
        type: 'checkbox',
        checked: login.openAtLogin,
        enabled: app.isPackaged,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { type: 'separator' },
      { label: 'Выйти из AI Notes', accelerator: 'Command+Q', registerAccelerator: false, click: () => app.quit() }
    ])
  }

  // Rebuilt on every open so reminders and the login switch are current.
  const open = (): void => tray.popUpContextMenu(build())
  tray.on('click', open)
  tray.on('right-click', open)
  return tray
}
