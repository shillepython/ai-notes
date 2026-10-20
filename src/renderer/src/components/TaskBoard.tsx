import { useEffect, useState } from 'react'
import { TOPIC_COLORS, type Task, type TaskPriority, type TaskStatus, type Topic } from '@shared/types'
import { filterTasks, type TaskFilter } from './Sidebar'
import { formatDue, formatReminder, toLocalInput, today } from '../dates'
import CodePromptButton from './CodePromptButton'

const TITLES: Record<TaskFilter, string> = {
  today: 'Сегодня',
  upcoming: 'Предстоящие',
  all: 'Все задачи',
  done: 'Выполненные'
}

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' }
const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'К выполнению', in_progress: 'В работе', done: 'Готово' }

interface Props {
  tasks: Task[]
  topics: Topic[]
  filter: TaskFilter
  /** When set, shows only this topic's open tasks and files new ones into it */
  topicId?: string
  onTopicDeleted?: () => void
  /** Expands this task, e.g. after its reminder notification was clicked */
  focus?: { id: string; at: number } | null
}

export default function TaskBoard({ tasks, topics, filter, topicId, onTopicDeleted, focus }: Props): React.JSX.Element {
  const [newTitle, setNewTitle] = useState('')
  const [openId, setOpenId] = useState<string | null>(focus?.id ?? null)
  useEffect(() => {
    if (focus) setOpenId(focus.id)
  }, [focus])
  const topic = topicId ? topics.find((t) => t.id === topicId) : undefined
  const visible = filterTasks(tasks, filter).filter((t) => !topicId || t.topicId === topicId)

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    await window.api.tasks.create({ title, dueDate: filter === 'today' ? today() : null, topicId: topicId ?? null })
    setNewTitle('')
  }

  return (
    <div className="tasks">
      {topic ? <TopicHeader topic={topic} onDeleted={onTopicDeleted} /> : <h1>{TITLES[filter]}</h1>}
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
          <TaskRow
            key={t.id}
            task={t}
            topics={topics}
            showTopic={!topicId}
            open={openId === t.id}
            onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function TopicHeader({ topic, onDeleted }: { topic: Topic; onDeleted?: () => void }): React.JSX.Element {
  const [name, setName] = useState(topic.name)
  const saveName = (): void => {
    const next = name.trim()
    if (next && next !== topic.name) window.api.topics.update(topic.id, { name: next }).catch(() => setName(topic.name))
    else setName(topic.name)
  }
  const remove = async (): Promise<void> => {
    await window.api.topics.delete(topic.id)
    onDeleted?.()
  }

  return (
    <div className="topic-header">
      <h1>
        <input
          className="topic-icon-input"
          value={topic.icon}
          placeholder="🏷️"
          title="Эмодзи топика"
          onChange={(e) => window.api.topics.update(topic.id, { icon: e.target.value.trim() })}
        />
        <input
          className="topic-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </h1>
      <div className="topic-tools">
        {TOPIC_COLORS.map((c) => (
          <button
            key={c}
            className={`topic-swatch ${c === topic.color ? 'active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => window.api.topics.update(topic.id, { color: c })}
          />
        ))}
        <button className="danger-btn" title="Задачи останутся, но без топика" onClick={remove}>
          Удалить топик
        </button>
      </div>
    </div>
  )
}

function TaskRow({
  task,
  topics,
  showTopic,
  open,
  onToggleOpen
}: {
  task: Task
  topics: Topic[]
  showTopic: boolean
  open: boolean
  onToggleOpen: () => void
}): React.JSX.Element {
  const done = task.status === 'done'
  const topic = showTopic && task.topicId ? topics.find((t) => t.id === task.topicId) : undefined
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
        {topic && (
          <span className="topic-chip" style={{ borderColor: topic.color, color: topic.color }}>
            {topic.icon} {topic.name}
          </span>
        )}
        {task.status === 'in_progress' && <span className="badge">в работе</span>}
        {!done && task.remindAt && !task.remindedAt && (
          <span className="reminder" title="Напоминание">
            🔔 {formatReminder(task.remindAt)}
          </span>
        )}
        {task.dueDate && <span className={`due ${overdue ? 'overdue' : ''}`}>{formatDue(task.dueDate)}</span>}
      </div>
      {open && <TaskDetails task={task} topics={topics} />}
    </li>
  )
}

function TaskDetails({ task, topics }: { task: Task; topics: Topic[] }): React.JSX.Element {
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
          Напоминание
          <input
            type="datetime-local"
            value={toLocalInput(task.remindAt)}
            onChange={(e) => update({ remindAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
        </label>
        <label>
          Топик
          <select value={task.topicId ?? ''} onChange={(e) => update({ topicId: e.target.value || null })}>
            <option value="">Без топика</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon ? `${t.icon} ` : ''}
                {t.name}
              </option>
            ))}
          </select>
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
        <CodePromptButton task={task} title={title} description={description} />
        <button className="danger-btn" onClick={() => window.api.tasks.delete(task.id)}>
          Удалить
        </button>
      </div>
    </div>
  )
}
