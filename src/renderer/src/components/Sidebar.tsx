import { useState } from 'react'
import type { Note, Task, Topic } from '@shared/types'
import { today } from '../dates'

export type TaskFilter = 'today' | 'upcoming' | 'all' | 'done'
export type View = { kind: 'tasks'; filter: TaskFilter } | { kind: 'topic'; id: string } | { kind: 'note'; id: string }

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
  topics: Topic[]
  view: View
  onSelect: (v: View) => void
  onCreateNote: () => void
}

export default function Sidebar({ notes, tasks, topics, view, onSelect, onCreateNote }: Props): React.JSX.Element {
  const [newTopic, setNewTopic] = useState<string | null>(null)

  const addTopic = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const name = newTopic?.trim()
    setNewTopic(null)
    if (!name) return
    const existing = topics.find((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    const topic = existing ?? (await window.api.topics.create({ name }))
    onSelect({ kind: 'topic', id: topic.id })
  }

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
        <span>Топики</span>
        <button className="icon-btn" title="Новый топик" onClick={() => setNewTopic('')}>
          +
        </button>
      </div>
      {topics.map((t) => {
        const count = filterTasks(tasks, 'all').filter((x) => x.topicId === t.id).length
        return (
          <button
            key={t.id}
            className={`sidebar-item ${view.kind === 'topic' && view.id === t.id ? 'active' : ''}`}
            onClick={() => onSelect({ kind: 'topic', id: t.id })}
          >
            <span className="icon">{t.icon || <span className="topic-dot" style={{ background: t.color }} />}</span>
            <span className="label">{t.name}</span>
            {count > 0 && <span className="count">{count}</span>}
          </button>
        )
      })}
      {newTopic !== null && (
        <form onSubmit={addTopic}>
          <input
            className="field sidebar-input"
            autoFocus
            placeholder="Название топика"
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            onBlur={() => setNewTopic(null)}
            onKeyDown={(e) => e.key === 'Escape' && setNewTopic(null)}
          />
        </form>
      )}
      {topics.length === 0 && newTopic === null && <div className="sidebar-hint">Группы задач: Работа, Дом…</div>}

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
