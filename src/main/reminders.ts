import { BrowserWindow, Notification, powerMonitor } from 'electron'
import type { Store } from './store'
import type { Task } from '../shared/types'

// macOS system sound played with every reminder (one of /System/Library/Sounds).
const SOUND = 'Glass'
// Re-check at least this often: long timers drift while the Mac sleeps.
const MAX_DELAY = 60 * 60 * 1000

/**
 * Shows a macOS notification for every task whose remindAt has come. Reminders
 * live in the database, so ones that came due while the app was closed fire on
 * the next launch. Clicking a notification opens the task in the window.
 */
export function startReminders(store: Store, getWindow: () => BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  // Notifications are garbage collected (and lose their click handler) unless referenced.
  const shown = new Set<Notification>()

  const notify = (task: Task): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: `⏰ ${task.title}`,
      body: task.description.split('\n').find((l) => l.trim()) ?? 'Напоминание',
      sound: SOUND
    })
    const forget = (): void => {
      shown.delete(n)
    }
    n.on('click', () => {
      forget()
      const win = getWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('reminders:open', task.id)
    })
    n.on('close', forget)
    shown.add(n)
    n.show()
  }

  const tick = (): void => {
    for (const task of store.dueReminders()) {
      store.markReminded(task.id)
      notify(task)
    }
    schedule()
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    const next = store.nextReminderAt()
    if (!next) return
    const delay = Math.min(Math.max(Date.parse(next) - Date.now(), 0), MAX_DELAY)
    timer = setTimeout(tick, delay)
  }

  store.on('changed', schedule)
  powerMonitor.on('resume', tick)
  tick()
}
