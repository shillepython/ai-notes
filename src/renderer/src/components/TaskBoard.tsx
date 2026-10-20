import { useState } from 'react'
import type { Task, TaskPriority, TaskStatus } from '@shared/types'
import { filterTasks, type TaskFilter } from './Sidebar'
import { formatDue, today } from '../dates'

const TITLES: Record<TaskFilter, string> = {
  today: 'Сегодня',
  upcoming: 'Предстоящие',
  all: 'Все задачи',
  done: 'Выполненные'
}

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' }
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'К выполнению', in_progress: 'В работе', done: 'Готово' }

export default function TaskBoard({ tasks, filter }: { tasks: Task[]; filter: TaskFilter }): React.JSX.Element {
  const [newTitle, setNewTitle] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const visible = filterTasks(tasks, filter)

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    await window.api.tasks.create({ title, dueDate: filter === 'today' ? today() : null })
    setNewTitle('')
  }

  return (
    <div className="tasks">
      <h1>{TITLES[filter]}</h1>
      {filter !== 'done' && (
        <form className="quick-add" onSubmit={add}>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="＋ Новая задача… (Enter)"
          />
        </form>
      )}
      {visible.length === 0 && <div className="empty">Здесь пусто 🎉</div>}
      <ul className="task-list">
        {visible.map((t) => (
          <TaskRow key={t.id} task={t} open={openId === t.id} onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)} />
        ))}
      </ul>
    </div>
  )
}

function TaskRow({ task, open, onToggleOpen }: { task: Task; open: boolean; onToggleOpen: () => void }): React.JSX.Element {
  const done = task.status === 'done'
  const overdue = !done && task.dueDate !== null && task.dueDate < today()

  const toggleDone = (): void => {
    if (done) window.api.tasks.reopen(task.id)
    else window.api.tasks.complete(task.id)
  }

  return (
    <li className={`task ${done ? 'done' : ''} ${open ? 'open' : ''}`}>
      <div className="task-row">
        <button className={`check prio-${task.priority}`} onClick={toggleDone} title={done ? 'Вернуть' : 'Выполнить'}>
          {done ? '✓' : ''}
        </button>
        <div className="task-main" onClick={onToggleOpen}>
          <div className="task-title">{task.title}</div>
          {!open && task.description && <div className="task-desc-preview">{task.description.split('\n')[0]}</div>}
        </div>
        {task.status === 'in_progress' && <span className="badge">в работе</span>}
        {task.dueDate && <span className={`due ${overdue ? 'overdue' : ''}`}>{formatDue(task.dueDate)}</span>}
      </div>
      {open && <TaskDetails task={task} />}
    </li>
  )
}

function TaskDetails({ task }: { task: Task }): React.JSX.Element {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const update = (patch: Parameters<typeof window.api.tasks.update>[1]): void => {
    window.api.tasks.update(task.id, patch)
  }

  return (
    <div className="task-details">
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== task.title && update({ title: title.trim() })} />
      <textarea
        className="field"
        rows={4}
        placeholder="Описание…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== task.description && update({ description })}
      />
      <div className="task-meta">
        <label>
          Срок
          <input type="date" value={task.dueDate ?? ''} onChange={(e) => update({ dueDate: e.target.value || null })} />
        </label>
        <label>
          Приоритет
          <select value={task.priority} onChange={(e) => update({ priority: e.target.value as TaskPriority })}>
            {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Статус
          <select value={task.status} onChange={(e) => update({ status: e.target.value as TaskStatus })}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button className="danger-btn" onClick={() => window.api.tasks.delete(task.id)}>
          Удалить
        </button>
      </div>
    </div>
  )
}
