import type { Task } from '@shared/types'
import type { IconName } from './components/Icon'
import { today } from './dates'

export type TaskFilter = 'today' | 'upcoming' | 'all' | 'done'
export type View = { kind: 'tasks'; filter: TaskFilter } | { kind: 'topic'; id: string } | { kind: 'note'; id: string }

export const TASK_VIEWS: { filter: TaskFilter; label: string; icon: IconName; shortcut: string }[] = [
  { filter: 'today', label: 'Сегодня', icon: 'sun', shortcut: 'mod+1' },
  { filter: 'upcoming', label: 'Предстоящие', icon: 'calendar', shortcut: 'mod+2' },
  { filter: 'all', label: 'Все задачи', icon: 'inbox', shortcut: 'mod+3' },
  { filter: 'done', label: 'Выполненные', icon: 'checkCircle', shortcut: 'mod+4' }
]

/** Date first, then the manual (drag & drop) order within a day. */
const byDueThenOrder = (a: Task, b: Task): number =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.sortOrder - b.sortOrder

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  const t = today()
  switch (filter) {
    case 'today':
      return tasks.filter((x) => x.status !== 'done' && x.dueDate !== null && x.dueDate <= t).sort(byDueThenOrder)
    case 'upcoming':
      return tasks.filter((x) => x.status !== 'done' && x.dueDate !== null && x.dueDate > t).sort(byDueThenOrder)
    case 'all':
      return tasks.filter((x) => x.status !== 'done').sort(byDueThenOrder)
    case 'done':
      return tasks
        .filter((x) => x.status === 'done')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  }
}

export interface TaskGroup {
  key: string
  label: string | null
  tone?: 'danger'
  /** Due date a task gets when dropped into this group; undefined = keep its own. */
  dueDate?: string | null
  tasks: Task[]
}

/** Splits a filtered list into labelled sections: overdue / per day / without date. */
export function groupTasks(tasks: Task[], filter: TaskFilter): TaskGroup[] {
  if (filter === 'done') return [{ key: 'all', label: null, tasks }]
  const t = today()
  const groups = new Map<string, TaskGroup>()
  const push = (key: string, label: string, task: Task, dueDate: string | null | undefined, tone?: 'danger'): void => {
    if (!groups.has(key)) groups.set(key, { key, label, tone, dueDate, tasks: [] })
    groups.get(key)!.tasks.push(task)
  }
  for (const task of tasks) {
    if (task.dueDate === null) push('none', 'Без срока', task, null)
    else if (task.dueDate < t) push('overdue', 'Просрочено', task, undefined, 'danger')
    else if (filter === 'today') push('today', 'Сегодня', task, t)
    else push(task.dueDate, dayLabel(task.dueDate), task, task.dueDate)
  }
  const list = [...groups.values()]
  // Inside a group the manual order wins (overdue tasks from different days included).
  for (const g of list) g.tasks.sort((a, b) => a.sortOrder - b.sortOrder)
  // Keep "без срока" last; the rest is already in date order.
  list.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : 0))
  if (list.length === 1 && filter === 'today' && list[0].key === 'today') list[0].label = null
  return list
}

export function dayLabel(date: string): string {
  const d = new Date(date + 'T00:00:00')
  const diff = Math.round((d.getTime() - new Date(today() + 'T00:00:00').getTime()) / 86_400_000)
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long' })
  const dayMonth = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  if (diff === 0) return `Сегодня · ${dayMonth}`
  if (diff === 1) return `Завтра · ${dayMonth}`
  return `${weekday[0].toUpperCase()}${weekday.slice(1)} · ${dayMonth}`
}

export function pluralTasks(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} задача`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} задачи`
  return `${n} задач`
}
