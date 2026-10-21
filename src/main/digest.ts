import type { Store } from './store'
import type { Task } from '../shared/types'
import { checklistProgress } from '../shared/links.ts'

// Morning briefing and weekly review: the facts are collected here, without the
// model, so the numbers are always right. The assistant (get_briefing /
// get_weekly_review tools) turns them into a short summary, and the daily
// notification uses briefingHeadline() as is.

const DAY = 86_400_000

/** YYYY-MM-DD in local time. */
export const localDate = (d: Date): string => d.toLocaleDateString('sv-SE')
const shiftDays = (date: string, n: number): string => localDate(new Date(Date.parse(date + 'T12:00:00') + n * DAY))
const localTime = (iso: string): string => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

export interface DigestTask {
  id: string
  title: string
  priority: Task['priority']
  status: Task['status']
  dueDate: string | null
  topic: string | null
  /** Checklist progress in the description, e.g. "2/5", or null without a checklist. */
  steps: string | null
}

export interface Briefing {
  date: string
  weekday: string
  overdue: DigestTask[]
  today: DigestTask[]
  /** In progress without a due date today or earlier. */
  inProgress: DigestTask[]
  reminders: { id: string; title: string; time: string }[]
  /** Due in the next three days. */
  soon: DigestTask[]
  doneYesterday: number
}

export interface WeeklyReview {
  from: string
  to: string
  completed: (DigestTask & { completedOn: string })[]
  completedByTopic: { topic: string; count: number }[]
  createdTasks: number
  notes: { id: string; title: string; created: boolean }[]
  overdue: DigestTask[]
  inProgress: DigestTask[]
  /** Due in the next seven days. */
  nextWeek: DigestTask[]
  /** Open tasks created more than two weeks ago, with no due date: candidates to drop or plan. */
  stale: DigestTask[]
}

/** "2/5" when the description has a checklist, otherwise null. */
const steps = (description: string): string | null => {
  const { done, total } = checklistProgress(description)
  return total ? `${done}/${total}` : null
}

const view = (store: Store, t: Task): DigestTask => ({
  id: t.id,
  title: t.title,
  priority: t.priority,
  status: t.status,
  dueDate: t.dueDate,
  topic: t.topicId ? (store.getTopic(t.topicId)?.name ?? null) : null,
  steps: steps(t.description)
})

const PRIORITY = { high: 0, medium: 1, low: 2 } as const
const byPriority = (a: Task, b: Task): number => PRIORITY[a.priority] - PRIORITY[b.priority] || a.sortOrder - b.sortOrder

export function buildBriefing(store: Store, now: Date = new Date()): Briefing {
  const today = localDate(now)
  const open = store.listTasks({ status: ['todo', 'in_progress'] })
  const yesterday = shiftDays(today, -1)
  const soonTo = shiftDays(today, 3)
  return {
    date: today,
    weekday: now.toLocaleDateString('ru-RU', { weekday: 'long' }),
    overdue: open.filter((t) => t.dueDate !== null && t.dueDate < today).sort(byPriority).map((t) => view(store, t)),
    today: open.filter((t) => t.dueDate === today).sort(byPriority).map((t) => view(store, t)),
    inProgress: open
      .filter((t) => t.status === 'in_progress' && (t.dueDate === null || t.dueDate > today))
      .map((t) => view(store, t)),
    reminders: open
      .filter((t) => t.remindAt && t.remindedAt === null && localDate(new Date(t.remindAt)) === today)
      .sort((a, b) => a.remindAt!.localeCompare(b.remindAt!))
      .map((t) => ({ id: t.id, title: t.title, time: localTime(t.remindAt!) })),
    soon: open.filter((t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= soonTo).map((t) => view(store, t)),
    doneYesterday: store
      .listTasks({ status: 'done' })
      .filter((t) => t.completedAt && localDate(new Date(t.completedAt)) === yesterday).length
  }
}

export function buildWeeklyReview(store: Store, now: Date = new Date()): WeeklyReview {
  const to = localDate(now)
  const from = shiftDays(to, -6)
  const inWeek = (iso: string | null): boolean => {
    if (!iso) return false
    const d = localDate(new Date(iso))
    return d >= from && d <= to
  }
  const all = store.listTasks()
  const open = all.filter((t) => t.status !== 'done')
  const completed = all
    .filter((t) => t.status === 'done' && inWeek(t.completedAt))
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!))
  const topics = new Map<string, number>()
  for (const t of completed) {
    const name = (t.topicId && store.getTopic(t.topicId)?.name) || 'Без топика'
    topics.set(name, (topics.get(name) ?? 0) + 1)
  }
  const staleBefore = new Date(now.getTime() - 14 * DAY).toISOString()
  return {
    from,
    to,
    completed: completed.map((t) => ({ ...view(store, t), completedOn: localDate(new Date(t.completedAt!)) })),
    completedByTopic: [...topics].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count),
    createdTasks: all.filter((t) => inWeek(t.createdAt)).length,
    notes: store
      .listNotes()
      .filter((n) => inWeek(n.updatedAt))
      .map((n) => ({ id: n.id, title: n.title || 'Без названия', created: inWeek(n.createdAt) })),
    overdue: open.filter((t) => t.dueDate !== null && t.dueDate < to).sort(byPriority).map((t) => view(store, t)),
    inProgress: open.filter((t) => t.status === 'in_progress').map((t) => view(store, t)),
    nextWeek: open
      .filter((t) => t.dueDate !== null && t.dueDate > to && t.dueDate <= shiftDays(to, 7))
      .map((t) => view(store, t)),
    stale: open.filter((t) => t.dueDate === null && t.createdAt < staleBefore).map((t) => view(store, t))
  }
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

/** One line for the morning notification, e.g. "Сегодня 3 задачи · 1 просрочена · напоминание в 18:00". */
export function briefingHeadline(b: Briefing): string {
  const parts: string[] = []
  parts.push(b.today.length ? `Сегодня ${plural(b.today.length, 'задача', 'задачи', 'задач')}` : 'На сегодня задач нет')
  if (b.overdue.length) parts.push(plural(b.overdue.length, 'просрочена', 'просрочены', 'просрочено'))
  if (b.reminders.length === 1) parts.push(`напоминание в ${b.reminders[0].time}`)
  else if (b.reminders.length > 1) parts.push(plural(b.reminders.length, 'напоминание', 'напоминания', 'напоминаний'))
  if (b.inProgress.length) parts.push(`в работе ${b.inProgress.length}`)
  return parts.join(' · ')
}

/** One line for the weekly notification. */
export function weeklyHeadline(r: WeeklyReview): string {
  const parts = [`Закрыто ${plural(r.completed.length, 'задача', 'задачи', 'задач')}`]
  if (r.overdue.length) parts.push(`${r.overdue.length} висят с просрочкой`)
  if (r.nextWeek.length) parts.push(`на неделю ${r.nextWeek.length}`)
  return parts.join(' · ')
}

/** True when there is nothing worth a morning notification. */
export const isEmptyBriefing = (b: Briefing): boolean =>
  !b.overdue.length && !b.today.length && !b.reminders.length && !b.inProgress.length
