import { app, BrowserWindow, ipcMain, Notification, powerMonitor } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from './store'
import type { DigestSettings } from '../shared/types'
import { briefingHeadline, buildBriefing, buildWeeklyReview, isEmptyBriefing, localDate, weeklyHeadline } from './digest'

// The morning briefing (every day) and the weekly review (Sunday) arrive as macOS
// notifications; clicking one opens the app and asks the assistant for the full
// summary. Each fires at most once a day. If the Mac was asleep or the app closed
// at that time, it fires on the next launch or wake the same day, until noon for
// the briefing and until midnight for the review.

export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  dailyEnabled: true,
  dailyTime: '09:00',
  weeklyEnabled: true,
  weeklyTime: '18:00'
}

interface Saved extends DigestSettings {
  lastDaily?: string
  lastWeekly?: string
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const SUNDAY = 0
const SOUND = 'Glass'
const CHECK_EVERY = 5 * 60 * 1000

const path = (): string => join(app.getPath('userData'), 'digest-settings.json')

function read(): Saved {
  try {
    const raw = JSON.parse(readFileSync(path(), 'utf8')) as Partial<Saved>
    return {
      dailyEnabled: typeof raw.dailyEnabled === 'boolean' ? raw.dailyEnabled : DEFAULT_DIGEST_SETTINGS.dailyEnabled,
      dailyTime: raw.dailyTime && HHMM.test(raw.dailyTime) ? raw.dailyTime : DEFAULT_DIGEST_SETTINGS.dailyTime,
      weeklyEnabled: typeof raw.weeklyEnabled === 'boolean' ? raw.weeklyEnabled : DEFAULT_DIGEST_SETTINGS.weeklyEnabled,
      weeklyTime: raw.weeklyTime && HHMM.test(raw.weeklyTime) ? raw.weeklyTime : DEFAULT_DIGEST_SETTINGS.weeklyTime,
      lastDaily: raw.lastDaily,
      lastWeekly: raw.lastWeekly
    }
  } catch {
    return { ...DEFAULT_DIGEST_SETTINGS }
  }
}

const write = (s: Saved): void => writeFileSync(path(), JSON.stringify(s, null, 2))

export function getDigestSettings(): DigestSettings {
  const { lastDaily: _d, lastWeekly: _w, ...settings } = read()
  return settings
}

/** Applies a patch; invalid times are rejected with an error. Returns the new settings. */
export function updateDigestSettings(patch: Partial<DigestSettings>): DigestSettings {
  for (const key of ['dailyTime', 'weeklyTime'] as const) {
    if (patch[key] !== undefined && !HHMM.test(patch[key]!)) throw new Error(`Время в формате ЧЧ:ММ, а не «${patch[key]}»`)
  }
  const next = { ...read() }
  if (typeof patch.dailyEnabled === 'boolean') next.dailyEnabled = patch.dailyEnabled
  if (typeof patch.weeklyEnabled === 'boolean') next.weeklyEnabled = patch.weeklyEnabled
  if (patch.dailyTime) next.dailyTime = patch.dailyTime
  if (patch.weeklyTime) next.weeklyTime = patch.weeklyTime
  write(next)
  reschedule?.()
  return getDigestSettings()
}

let reschedule: (() => void) | null = null

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

export function startDigests(store: Store, getWindow: () => BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const shown = new Set<Notification>()

  const notify = (title: string, body: string, kind: 'briefing' | 'weekly'): void => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, sound: SOUND })
    const forget = (): void => {
      shown.delete(n)
    }
    n.on('click', () => {
      forget()
      const win = getWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('digest:open', kind)
    })
    n.on('close', forget)
    shown.add(n)
    n.show()
  }

  const tick = (): void => {
    const now = new Date()
    const today = localDate(now)
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const s = read()
    let changed = false

    if (s.dailyEnabled && s.lastDaily !== today && nowMin >= minutes(s.dailyTime) && now.getHours() < 12) {
      s.lastDaily = today
      changed = true
      const b = buildBriefing(store, now)
      if (!isEmptyBriefing(b)) notify('☀️ Утренний брифинг', briefingHeadline(b), 'briefing')
    }
    if (s.weeklyEnabled && now.getDay() === SUNDAY && s.lastWeekly !== today && nowMin >= minutes(s.weeklyTime)) {
      s.lastWeekly = today
      changed = true
      notify('🗓 Итоги недели', weeklyHeadline(buildWeeklyReview(store, now)), 'weekly')
    }
    if (changed) write(s)
    schedule()
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    // Wake at the next full minute when a time is close, otherwise check every few minutes.
    const now = new Date()
    const s = read()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const targets = [s.dailyEnabled && s.dailyTime, s.weeklyEnabled && s.weeklyTime]
      .filter((t): t is string => !!t)
      .map((t) => minutes(t) - nowMin)
      .filter((d) => d > 0)
    const delay = targets.length ? Math.min(Math.min(...targets) * 60_000 - now.getSeconds() * 1000, CHECK_EVERY) : CHECK_EVERY
    timer = setTimeout(tick, Math.max(delay, 1000))
  }

  reschedule = tick
  powerMonitor.on('resume', tick)
  // After startup settles, so the window is there to open on click.
  setTimeout(tick, 5000)

  ipcMain.handle('digest:getSettings', () => getDigestSettings())
  ipcMain.handle('digest:updateSettings', (_e, patch: Partial<DigestSettings>) => updateDigestSettings(patch ?? {}))
}
