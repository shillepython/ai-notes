import type { Note, Task } from '@shared/types'
import { today } from '../dates'

export type TaskFilter = 'today' | 'upcoming' | 'all' | 'done'
export type View = { kind: 'tasks'; filter: TaskFilter } | { kind: 'note'; id: string }

const TASK_VIEWS: { filter: TaskFilter; label: string; icon: string }[] = [
  { filter: 'today', label: 'Сегодня', icon: '☀️' },
  { filter: 'upcoming', label: 'Предстоящие', icon: '📅' },
  { filter: 'all', label: 'Все задачи', icon: '📋' },
  { filter: 'done', label: 'Выполненные', icon: '✅' }
]

export function countFor(tasks: Task[], filter: TaskFilter): number {
  return filterTasks(tasks, filter).length
}

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  const t = today()
  switch (filter) {
    case 'today':
      return tasks.filter((x) => x.status !== 'done' && x.dueDate !== null && x.dueDate <= t)
    case 'upcoming':
      return tasks.filter((x) => x.status !== 'done' && x.dueDate !== null && x.dueDate > t)
    case 'all':
      return tasks.filter((x) => x.status !== 'done')
    case 'done':
      return tasks
        .filter((x) => x.status === 'done')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  }
}

interface Props {
  notes: Note[]
  tasks: Task[]
  view: View
  onSelect: (v: View) => void
  onCreateNote: () => void
}

export default function Sidebar({ notes, tasks, view, onSelect, onCreateNote }: Props): React.JSX.Element {
  return (
    <nav className="sidebar">
      <div className="sidebar-drag" />
      <div className="sidebar-section">Планер</div>
      {TASK_VIEWS.map((v) => {
        const active = view.kind === 'tasks' && view.filter === v.filter
        const count = countFor(tasks, v.filter)
        return (
          <button
            key={v.filter}
            className={`sidebar-item ${active ? 'active' : ''}`}
            onClick={() => onSelect({ kind: 'tasks', filter: v.filter })}
          >
            <span className="icon">{v.icon}</span>
            <span className="label">{v.label}</span>
            {v.filter !== 'done' && count > 0 && <span className="count">{count}</span>}
          </button>
        )
      })}

      <div className="sidebar-section row">
        <span>Заметки</span>
        <button className="icon-btn" title="Новая заметка" onClick={onCreateNote}>
          +
        </button>
      </div>
      <div className="sidebar-notes">
        {notes.length === 0 && <div className="sidebar-hint">Пока нет заметок</div>}
        {notes.map((n) => (
          <button
            key={n.id}
            className={`sidebar-item ${view.kind === 'note' && view.id === n.id ? 'active' : ''}`}
            onClick={() => onSelect({ kind: 'note', id: n.id })}
          >
            <span className="icon">📄</span>
            <span className="label">{n.title || 'Без названия'}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
