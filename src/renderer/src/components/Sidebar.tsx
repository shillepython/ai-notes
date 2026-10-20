import { useState } from 'react'
import type { Note, Task, Topic, TrashItem } from '@shared/types'
import { TASK_VIEWS, filterTasks, type View } from '../taskViews'
import { Icon, Kbd } from './Icon'

interface Props {
  notes: Note[]
  tasks: Task[]
  topics: Topic[]
  trash: TrashItem[]
  view: View
  onSelect: (v: View) => void
  onCreateNote: () => void
  onOpenPalette: () => void
}

export default function Sidebar({ notes, tasks, topics, trash, view, onSelect, onCreateNote, onOpenPalette }: Props): React.JSX.Element {
  const [newTopic, setNewTopic] = useState<string | null>(null)
  const open = filterTasks(tasks, 'all')

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
      <button className="search-btn" onClick={onOpenPalette}>
        <Icon name="search" size={14} />
        <span>Поиск и команды</span>
        <Kbd keys="mod+k" />
      </button>

      <div className="sidebar-scroll">
        <div className="sidebar-section">Планер</div>
        {TASK_VIEWS.map((v) => {
          const active = view.kind === 'tasks' && view.filter === v.filter
          const count = v.filter === 'done' ? 0 : filterTasks(tasks, v.filter).length
          return (
            <button
              key={v.filter}
              className={`sidebar-item ${active ? 'active' : ''}`}
              onClick={() => onSelect({ kind: 'tasks', filter: v.filter })}
            >
              <Icon name={v.icon} className={`view-icon view-icon--${v.filter}`} />
              <span className="label">{v.label}</span>
              {count > 0 && <span className="count">{count}</span>}
            </button>
          )
        })}

        <div className="sidebar-section row">
          <span>Топики</span>
          <button className="icon-btn" title="Новый топик" onClick={() => setNewTopic('')}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {topics.map((t) => {
          const count = open.filter((x) => x.topicId === t.id).length
          return (
            <button
              key={t.id}
              className={`sidebar-item ${view.kind === 'topic' && view.id === t.id ? 'active' : ''}`}
              onClick={() => onSelect({ kind: 'topic', id: t.id })}
              style={{ '--topic': t.color } as React.CSSProperties}
            >
              <TopicMark topic={t} />
              <span className="label">{t.name}</span>
              {count > 0 && <span className="count">{count}</span>}
            </button>
          )
        })}
        {newTopic !== null && (
          <form onSubmit={addTopic} className="sidebar-new">
            <span className="topic-dot" />
            <input
              autoFocus
              placeholder="Название, Enter"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onBlur={() => setNewTopic(null)}
              onKeyDown={(e) => e.key === 'Escape' && setNewTopic(null)}
            />
          </form>
        )}
        {topics.length === 0 && newTopic === null && (
          <button className="sidebar-hint" onClick={() => setNewTopic('')}>
            Группы задач: Работа, Дом…
          </button>
        )}

        <div className="sidebar-section row">
          <span>Заметки</span>
          <button className="icon-btn" title="Новая заметка (⌘⇧N)" onClick={onCreateNote}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {notes.length === 0 && (
          <button className="sidebar-hint" onClick={onCreateNote}>
            Создать первую заметку
          </button>
        )}
        {notes.map((n) => (
          <button
            key={n.id}
            className={`sidebar-item ${view.kind === 'note' && view.id === n.id ? 'active' : ''}`}
            onClick={() => onSelect({ kind: 'note', id: n.id })}
          >
            <Icon name="file" className="muted-icon" />
            <span className="label">{n.title || 'Без названия'}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <button
          className={`sidebar-item ${view.kind === 'trash' ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'trash' })}
        >
          <Icon name="trash" className="muted-icon" />
          <span className="label">Корзина</span>
          {trash.length > 0 && <span className="count">{trash.length}</span>}
        </button>
      </div>
    </nav>
  )
}

/** Topic emoji, or a colored dot when it has none. */
export function TopicMark({ topic }: { topic: Topic }): React.JSX.Element {
  return topic.icon ? (
    <span className="topic-emoji">{topic.icon}</span>
  ) : (
    <span className="topic-dot" style={{ background: topic.color }} />
  )
}
