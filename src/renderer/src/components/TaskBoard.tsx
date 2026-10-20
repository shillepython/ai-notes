import { useEffect, useMemo, useRef, useState } from 'react'
import { TOPIC_COLORS, type Task, type TaskPatch, type TaskPriority, type TaskStatus, type Topic } from '@shared/types'
import { TASK_VIEWS, filterTasks, groupTasks, pluralTasks, type TaskFilter, type TaskGroup } from '../taskViews'
import { addDays, formatDue, formatReminder, nextWeek, toLocalInput, today } from '../dates'
import { isTyping, matches, onUi } from '../hotkeys'
import { Icon, Kbd } from './Icon'
import Collapse from './Collapse'
import CodePromptButton from './CodePromptButton'
import { toast } from './Toasts'
import { TopicMark } from './Sidebar'

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Низкий' },
  { value: 'medium', label: 'Средний' },
  { value: 'high', label: 'Высокий' }
]
const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'К выполнению' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Готово' }
]

const EMPTY: Record<TaskFilter, { title: string; hint: string }> = {
  today: { title: 'На сегодня всё', hint: 'Добавь задачу выше или надиктуй ассистенту справа.' },
  upcoming: { title: 'Впереди пусто', hint: 'Задачи с датой в будущем появятся здесь.' },
  all: { title: 'Задач нет', hint: 'Нажми N, чтобы добавить первую.' },
  done: { title: 'Пока ничего не выполнено', hint: 'Закрытые задачи будут собираться здесь.' }
}

/** How long the "checked" animation plays before the task actually leaves the list. */
const COMPLETE_DELAY = 450

interface Props {
  tasks: Task[]
  topics: Topic[]
  filter: TaskFilter
  /** When set, shows only this topic's tasks and files new ones into it */
  topicId?: string
  onTopicDeleted?: () => void
  onTopicRestored?: (id: string) => void
}

export default function TaskBoard({ tasks, topics, filter, topicId, onTopicDeleted, onTopicRestored }: Props): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ group: string; index: number; overId: string; after: boolean } | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)

  const topic = topicId ? topics.find((t) => t.id === topicId) : undefined
  const visible = filterTasks(tasks, filter).filter((t) => !topicId || t.topicId === topicId)
  const groups = useMemo(() => groupTasks(visible, filter), [visible, filter])
  const ordered = groups.flatMap((g) => g.tasks)
  const meta = TASK_VIEWS.find((v) => v.filter === filter)!

  useEffect(() => onUi('quick-add:focus', () => quickRef.current?.focus()), [])

  // Opened from the command palette: select, expand and scroll to the task.
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      setSelectedId(id)
      setOpenId(id)
      requestAnimationFrame(() => document.getElementById(`task-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    }
    window.addEventListener('ui:open-task', onOpen)
    return () => window.removeEventListener('ui:open-task', onOpen)
  }, [])

  useEffect(() => {
    setOpenId(null)
    setSelectedId(null)
  }, [filter, topicId])

  const complete = (task: Task): void => {
    if (task.status === 'done') {
      void window.api.tasks.reopen(task.id)
      return
    }
    setCompleting((s) => new Set(s).add(task.id))
    setTimeout(async () => {
      await window.api.tasks.complete(task.id)
      setCompleting((s) => {
        const next = new Set(s)
        next.delete(task.id)
        return next
      })
      toast(`Выполнено: ${task.title}`, { label: 'Отменить', run: () => window.api.tasks.reopen(task.id) })
    }, COMPLETE_DELAY)
  }

  const remove = async (task: Task): Promise<void> => {
    const idx = ordered.findIndex((t) => t.id === task.id)
    setSelectedId(ordered[idx + 1]?.id ?? ordered[idx - 1]?.id ?? null)
    if (openId === task.id) setOpenId(null)
    await window.api.tasks.delete(task.id)
    toast('Задача в корзине', {
      label: 'Отменить',
      run: () => void window.api.trash.restore('task', task.id)
    })
  }

  /** Puts a task at `index` of a group (index among the group's other tasks); may change its due date. */
  const moveTo = (task: Task, group: TaskGroup, index: number): void => {
    const others = group.tasks.filter((t) => t.id !== task.id)
    const sameGroup = group.tasks.some((t) => t.id === task.id)
    if (sameGroup && group.tasks.indexOf(task) === index) return
    const prev = others[index - 1]
    const next = others[index]
    const sortOrder =
      prev && next ? (prev.sortOrder + next.sortOrder) / 2 : prev ? prev.sortOrder + 1000 : next ? next.sortOrder - 1000 : Date.now()
    const patch: TaskPatch = { sortOrder }
    if (!sameGroup && group.dueDate !== undefined) patch.dueDate = group.dueDate
    void window.api.tasks.update(task.id, patch)
  }

  const groupOf = (id: string): TaskGroup | undefined => groups.find((g) => g.tasks.some((t) => t.id === id))

  const onDragOverTask = (e: React.DragEvent, group: TaskGroup, over: Task): void => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    if (over.id === dragId) return setDrop(null)
    const others = group.tasks.filter((t) => t.id !== dragId)
    const index = others.findIndex((t) => t.id === over.id) + (after ? 1 : 0)
    if (drop?.overId !== over.id || drop.after !== after) setDrop({ group: group.key, index, overId: over.id, after })
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const task = ordered.find((t) => t.id === dragId)
    const group = groups.find((g) => g.key === drop?.group)
    if (task && group && drop) moveTo(task, group, drop.index)
    setDragId(null)
    setDrop(null)
  }

  // Keyboard navigation inside the list. Ignored while typing in a field.
  const stateRef = useRef({ ordered, selectedId, openId })
  stateRef.current = { ordered, selectedId, openId }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isTyping(e) || document.querySelector('.palette')) return
      const { ordered, selectedId, openId } = stateRef.current
      const idx = ordered.findIndex((t) => t.id === selectedId)
      const selected = idx >= 0 ? ordered[idx] : null
      const move = (delta: number): void => {
        if (!ordered.length) return
        const next = idx < 0 ? (delta > 0 ? 0 : ordered.length - 1) : Math.min(ordered.length - 1, Math.max(0, idx + delta))
        setSelectedId(ordered[next].id)
        document.getElementById(`task-${ordered[next].id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      if (selected && (matches(e, 'alt+up') || matches(e, 'alt+down'))) {
        // ⌥↑ / ⌥↓ moves the selected task within its group.
        const g = groupOf(selected.id)!
        const i = g.tasks.indexOf(selected)
        const target = matches(e, 'alt+up') ? i - 1 : i + 1
        if (target >= 0 && target < g.tasks.length) moveTo(selected, g, target)
      } else if (matches(e, 'down') || matches(e, 'j')) move(1)
      else if (matches(e, 'up') || matches(e, 'k')) move(-1)
      else if (matches(e, 'n')) quickRef.current?.focus()
      else if (matches(e, 'esc')) {
        if (openId) setOpenId(null)
        else setSelectedId(null)
      } else if (!selected) return
      else if (matches(e, 'enter')) setOpenId(openId === selected.id ? null : selected.id)
      else if (matches(e, 'space') || matches(e, 'x')) complete(selected)
      else if (matches(e, 'e')) setEditingId(selected.id)
      else if (matches(e, 'backspace') || matches(e, 'delete')) void remove(selected)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const subtitle =
    filter === 'today'
      ? new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
      : null

  return (
    <div className="tasks view-enter">
      <header className="page-header">
        {topic ? (
          <TopicHeader topic={topic} onDeleted={onTopicDeleted} onRestored={onTopicRestored} />
        ) : (
          <h1>
            <Icon name={meta.icon} size={26} className={`view-icon view-icon--${filter}`} />
            {meta.label}
          </h1>
        )}
        <div className="page-sub">
          {subtitle && <span className="capitalize">{subtitle}</span>}
          {subtitle && visible.length > 0 && <span className="dot">·</span>}
          {visible.length > 0 && <span>{pluralTasks(visible.length)}</span>}
        </div>
      </header>

      {filter !== 'done' && (
        <QuickAdd inputRef={quickRef} filter={topicId ? 'topic' : filter} topics={topics} topicId={topicId} onAdded={setSelectedId} />
      )}

      {visible.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name={filter === 'done' ? 'checkCircle' : 'sparkles'} size={28} />
          </div>
          <div className="empty-title">{EMPTY[filter].title}</div>
          <div className="empty-hint">{EMPTY[filter].hint}</div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="task-group">
          {g.label && (
            <h3 className={`group-label ${g.tone ?? ''}`}>
              {g.label}
              <span className="group-count">{g.tasks.length}</span>
            </h3>
          )}
          <ul className="task-list">
            {g.tasks.map((t, i) => (
              <TaskRow
                key={t.id}
                draggable={filter !== 'done' && openId !== t.id && editingId !== t.id}
                dragging={dragId === t.id}
                dropAt={drop?.overId === t.id ? (drop.after ? 'after' : 'before') : null}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', t.title)
                  setDragId(t.id)
                  setSelectedId(t.id)
                }}
                onDragOver={(e) => onDragOverTask(e, g, t)}
                onDrop={onDrop}
                onDragEnd={() => {
                  setDragId(null)
                  setDrop(null)
                }}
                task={t}
                topics={topics}
                showTopic={!topicId}
                showDue={!(filter === 'today' && t.dueDate === today())}
                index={i}
                open={openId === t.id}
                selected={selectedId === t.id}
                editing={editingId === t.id}
                completing={completing.has(t.id)}
                onSelect={() => setSelectedId(t.id)}
                onToggleOpen={() => setOpenId(openId === t.id ? null : t.id)}
                onClose={() => setOpenId(null)}
                onComplete={() => complete(t)}
                onDelete={() => void remove(t)}
                onEdit={(on) => setEditingId(on ? t.id : null)}
              />
            ))}
          </ul>
        </section>
      ))}

      {visible.length > 0 && (
        <div className="keys-hint">
          <span>
            <Kbd keys="up" /> <Kbd keys="down" /> выбрать
          </span>
          <span>
            <Kbd keys="space" /> выполнить
          </span>
          <span>
            <Kbd keys="enter" /> подробнее
          </span>
          <span>
            <Kbd keys="e" /> переименовать
          </span>
          {filter !== 'done' && (
            <span>
              <Kbd keys="alt+up" /> <Kbd keys="alt+down" /> или мышью — порядок
            </span>
          )}
          <span>
            <Kbd keys="backspace" /> удалить
          </span>
        </div>
      )}
    </div>
  )
}

function QuickAdd({
  inputRef,
  filter,
  topics,
  topicId,
  onAdded
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  filter: TaskFilter | 'topic'
  topics: Topic[]
  topicId?: string
  onAdded: (id: string) => void
}): React.JSX.Element {
  const defaultDue = filter === 'today' ? today() : filter === 'upcoming' ? addDays(1) : null
  const [title, setTitle] = useState('')
  const [due, setDue] = useState<string | null>(defaultDue)
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [topic, setTopic] = useState<string | null>(topicId ?? null)
  const [focused, setFocused] = useState(false)

  useEffect(() => setDue(defaultDue), [defaultDue])
  useEffect(() => setTopic(topicId ?? null), [topicId])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    setTitle('')
    const task = await window.api.tasks.create({ title: t, dueDate: due, priority, topicId: topic })
    onAdded(task.id)
  }

  const dueOptions: { label: string; value: string | null }[] = [
    { label: 'Сегодня', value: today() },
    { label: 'Завтра', value: addDays(1) },
    { label: 'След. неделя', value: nextWeek() },
    { label: 'Без срока', value: null }
  ]

  return (
    <form className={`quick-add ${focused || title ? 'active' : ''}`} onSubmit={submit}>
      <div className="quick-add-row">
        <Icon name="plus" size={18} className="quick-add-plus" />
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setTitle('')
              e.currentTarget.blur()
            }
          }}
          placeholder="Новая задача"
        />
        <Kbd keys="enter" />
      </div>
      <div className="quick-add-options" onMouseDown={(e) => e.preventDefault()}>
        {dueOptions.map((o) => (
          <button
            type="button"
            key={o.label}
            className={`chip ${due === o.value ? 'on' : ''}`}
            onClick={() => setDue(o.value)}
          >
            {o.label}
          </button>
        ))}
        <span className="chip-sep" />
        <button
          type="button"
          className={`chip chip--high ${priority === 'high' ? 'on' : ''}`}
          onClick={() => setPriority(priority === 'high' ? 'medium' : 'high')}
          title="Высокий приоритет"
        >
          <Icon name="flag" size={12} /> Важно
        </button>
        {topics.length > 0 && !topicId && <TopicSelect topics={topics} value={topic} onChange={setTopic} />}
      </div>
    </form>
  )
}

interface RowProps {
  draggable: boolean
  dragging: boolean
  dropAt: 'before' | 'after' | null
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  task: Task
  topics: Topic[]
  showTopic: boolean
  showDue: boolean
  index: number
  open: boolean
  selected: boolean
  editing: boolean
  completing: boolean
  onSelect: () => void
  onToggleOpen: () => void
  onClose: () => void
  onComplete: () => void
  onDelete: () => void
  onEdit: (on: boolean) => void
}

function TaskRow(p: RowProps): React.JSX.Element {
  const { task } = p
  const done = task.status === 'done' || p.completing
  const overdue = !done && task.dueDate !== null && task.dueDate < today()
  const topic = p.showTopic && task.topicId ? p.topics.find((t) => t.id === task.topicId) : undefined

  const cls = [
    'task',
    done && 'done',
    p.completing && 'completing',
    p.open && 'open',
    p.selected && 'selected',
    p.dragging && 'dragging',
    p.dropAt && `drop-${p.dropAt}`
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li
      id={`task-${task.id}`}
      className={cls}
      style={{ animationDelay: `${Math.min(p.index, 12) * 18}ms` }}
      onMouseDown={p.onSelect}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      onDragEnd={p.onDragEnd}
    >
      <div className="task-row">
        <button
          className={`check prio-${task.priority}`}
          onClick={(e) => {
            e.stopPropagation()
            p.onComplete()
          }}
          title={task.status === 'done' ? 'Вернуть в работу' : 'Выполнить (Space)'}
        >
          <Icon name="check" size={12} />
        </button>
        <div className="task-main" onClick={p.editing ? undefined : p.onToggleOpen}>
          {p.editing ? (
            <InlineTitle task={task} onDone={() => p.onEdit(false)} />
          ) : (
            <div className="task-title">{task.title}</div>
          )}
          {!p.open && task.description && <div className="task-desc-preview">{task.description.split('\n')[0]}</div>}
        </div>
        <div className="task-trail">
          {task.priority === 'high' && !done && <Icon name="flag" size={13} className="flag-high" />}
          {topic && (
            <span className="topic-chip" style={{ '--topic': topic.color } as React.CSSProperties}>
              <TopicMark topic={topic} />
              {topic.name}
            </span>
          )}
          {task.status === 'in_progress' && <span className="badge">в работе</span>}
          {!done && task.remindAt && !task.remindedAt && (
            <span className="reminder" title="Напоминание">
              <Icon name="bell" size={12} />
              {formatReminder(task.remindAt)}
            </span>
          )}
          {task.dueDate && p.showDue && (
            <span className={`due ${overdue ? 'overdue' : ''}`}>
              <Icon name="calendar" size={12} />
              {formatDue(task.dueDate)}
            </span>
          )}
          <div className="row-actions">
            <button className="icon-btn" title="Переименовать (E)" onClick={() => p.onEdit(true)}>
              <Icon name="pencil" size={13} />
            </button>
            <button className="icon-btn danger" title="Удалить (⌫)" onClick={p.onDelete}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      </div>
      <Collapse open={p.open}>
        <TaskDetails task={task} topics={p.topics} onClose={p.onClose} onDelete={p.onDelete} />
      </Collapse>
    </li>
  )
}

function InlineTitle({ task, onDone }: { task: Task; onDone: () => void }): React.JSX.Element {
  const [value, setValue] = useState(task.title)
  const save = (): void => {
    const v = value.trim()
    if (v && v !== task.title) void window.api.tasks.update(task.id, { title: v })
    onDone()
  }
  return (
    <input
      className="inline-title"
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') onDone()
        e.stopPropagation()
      }}
    />
  )
}

function TaskDetails({
  task,
  topics,
  onClose,
  onDelete
}: {
  task: Task
  topics: Topic[]
  onClose: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const update = (patch: Parameters<typeof window.api.tasks.update>[1]): void => {
    void window.api.tasks.update(task.id, patch)
  }

  // Save text fields when the panel closes, not only on blur.
  const latest = useRef({ title, description, task })
  latest.current = { title, description, task }
  useEffect(
    () => () => {
      const { title, description, task } = latest.current
      const patch: Parameters<typeof window.api.tasks.update>[1] = {}
      if (title.trim() && title.trim() !== task.title) patch.title = title.trim()
      if (description !== task.description) patch.description = description
      if (Object.keys(patch).length) void window.api.tasks.update(task.id, patch)
    },
    []
  )

  useEffect(() => autosize(descRef.current), [description])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      ;(document.activeElement as HTMLElement | null)?.blur()
      onClose()
    }
  }

  const dueOptions = [
    { label: 'Сегодня', value: today() },
    { label: 'Завтра', value: addDays(1) },
    { label: 'След. неделя', value: nextWeek() }
  ]

  return (
    <div className="task-details" onKeyDown={onKeyDown} onMouseDown={(e) => e.stopPropagation()}>
      <input
        className="details-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title.trim() !== task.title && update({ title: title.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && descRef.current?.focus()}
      />
      <textarea
        ref={descRef}
        className="details-desc"
        rows={2}
        placeholder="Добавить описание…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== task.description && update({ description })}
      />

      <div className="prop">
        <span className="prop-label">Срок</span>
        <div className="chips">
          {dueOptions.map((o) => (
            <button key={o.label} className={`chip ${task.dueDate === o.value ? 'on' : ''}`} onClick={() => update({ dueDate: o.value })}>
              {o.label}
            </button>
          ))}
          <input
            type="date"
            className={`chip chip-date ${task.dueDate && !dueOptions.some((o) => o.value === task.dueDate) ? 'on' : ''}`}
            value={task.dueDate ?? ''}
            onChange={(e) => update({ dueDate: e.target.value || null })}
          />
          {task.dueDate && (
            <button className="chip chip-clear" title="Убрать срок" onClick={() => update({ dueDate: null })}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="prop">
        <span className="prop-label">Напомнить</span>
        <div className="chips">
          <input
            type="datetime-local"
            className={`chip chip-date ${task.remindAt ? 'on' : ''}`}
            value={toLocalInput(task.remindAt)}
            onChange={(e) => update({ remindAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
          {task.remindAt && (
            <button className="chip chip-clear" title="Убрать напоминание" onClick={() => update({ remindAt: null })}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="prop">
        <span className="prop-label">Топик</span>
        <div className="chips">
          <button className={`chip ${task.topicId === null ? 'on' : ''}`} onClick={() => update({ topicId: null })}>
            Без топика
          </button>
          {topics.map((t) => (
            <button
              key={t.id}
              className={`chip chip-topic ${task.topicId === t.id ? 'on' : ''}`}
              style={{ '--topic': t.color } as React.CSSProperties}
              onClick={() => update({ topicId: t.id })}
            >
              <TopicMark topic={t} />
              {t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="prop">
        <span className="prop-label">Приоритет</span>
        <div className="segmented">
          {PRIORITIES.map((o) => (
            <button key={o.value} className={task.priority === o.value ? 'on' : ''} onClick={() => update({ priority: o.value })}>
              <span className={`prio-dot prio-${o.value}`} />
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="prop">
        <span className="prop-label">Статус</span>
        <div className="segmented">
          {STATUSES.map((o) => (
            <button key={o.value} className={task.status === o.value ? 'on' : ''} onClick={() => update({ status: o.value })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="details-footer">
        <button className="ghost-btn danger" onClick={onDelete}>
          <Icon name="trash" size={13} /> Удалить
        </button>
        <CodePromptButton task={task} title={title} description={description} />
        <span className="muted small details-esc">
          <Kbd keys="esc" /> закрыть
        </span>
      </div>
    </div>
  )
}

export function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function TopicSelect({
  topics,
  value,
  onChange
}: {
  topics: Topic[]
  value: string | null
  onChange: (id: string | null) => void
}): React.JSX.Element {
  const current = topics.find((t) => t.id === value)
  return (
    <label
      className={`chip chip-topic chip-select ${current ? 'on' : ''}`}
      style={current ? ({ '--topic': current.color } as React.CSSProperties) : undefined}
    >
      {current ? <TopicMark topic={current} /> : <Icon name="hash" size={12} />}
      {current ? current.name : 'Топик'}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Без топика</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>
            {t.icon ? `${t.icon} ` : ''}
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function TopicHeader({
  topic,
  onDeleted,
  onRestored
}: {
  topic: Topic
  onDeleted?: () => void
  onRestored?: (id: string) => void
}): React.JSX.Element {
  const [name, setName] = useState(topic.name)
  const [icon, setIcon] = useState(topic.icon)
  useEffect(() => setName(topic.name), [topic.name])
  useEffect(() => setIcon(topic.icon), [topic.icon])

  const saveName = (): void => {
    const next = name.trim()
    if (next && next !== topic.name)
      window.api.topics.update(topic.id, { name: next }).catch(() => {
        setName(topic.name)
        toast('Топик с таким названием уже есть')
      })
    else setName(topic.name)
  }

  const remove = async (): Promise<void> => {
    await window.api.topics.delete(topic.id)
    onDeleted?.()
    toast(`Топик «${topic.name}» в корзине, задачи остались`, {
      label: 'Отменить',
      run: async () => {
        await window.api.trash.restore('topic', topic.id)
        onRestored?.(topic.id)
      }
    })
  }

  return (
    <div className="topic-header" style={{ '--topic': topic.color } as React.CSSProperties}>
      <h1>
        <input
          className="topic-icon-input"
          value={icon}
          placeholder="#"
          title="Эмодзи топика (необязательно)"
          maxLength={4}
          onChange={(e) => setIcon(e.target.value)}
          onBlur={() => icon.trim() !== topic.icon && window.api.topics.update(topic.id, { icon: icon.trim() })}
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
            title="Цвет топика"
            onClick={() => window.api.topics.update(topic.id, { color: c })}
          />
        ))}
        <button className="ghost-btn danger" title="В корзину. Задачи останутся, но без топика" onClick={remove}>
          <Icon name="trash" size={13} /> Удалить топик
        </button>
      </div>
    </div>
  )
}
