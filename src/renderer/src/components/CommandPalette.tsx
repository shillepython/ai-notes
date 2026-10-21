import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note, SemanticSearchResult, Task, Topic } from '@shared/types'
import { TASK_VIEWS, type View } from '../taskViews'
import { formatDue } from '../dates'
import { matches } from '../hotkeys'
import { Icon, Kbd, type IconName } from './Icon'
import { TopicMark } from './Sidebar'

export interface Command {
  id: string
  group: string
  label: string
  icon?: IconName
  topic?: Topic
  hint?: string
  shortcut?: string
  /** Extra text that search matches but the list does not show. */
  keywords?: string
  run: () => void
}

interface Props {
  notes: Note[]
  tasks: Task[]
  topics: Topic[]
  actions: Command[]
  onNavigate: (v: View) => void
  onOpenTask: (task: Task) => void
  onAsk: (text: string) => void
  onCreateTask: (title: string) => void
  onClose: () => void
}

/** Ranks a candidate against the query: prefix > word start > substring > in-order letters. 0 = no match. */
function score(text: string, q: string): number {
  const t = text.toLocaleLowerCase()
  if (!q) return 1
  if (t.startsWith(q)) return 100 - t.length / 100
  const i = t.indexOf(q)
  if (i > 0 && /[\s«"(—-]/.test(t[i - 1])) return 80 - i / 100
  if (i >= 0) return 60 - i / 100
  let pos = 0
  for (const ch of q) {
    pos = t.indexOf(ch, pos)
    if (pos < 0) return 0
    pos++
  }
  return 20
}

export default function CommandPalette(p: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [closing, setClosing] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLocaleLowerCase()
  const semantic = useSemantic(query.trim())

  const close = (): void => {
    setClosing(true)
    setTimeout(p.onClose, 140)
  }
  const runAndClose = (c: Command): void => {
    close()
    c.run()
  }

  const all = useMemo<Command[]>(() => {
    const nav: Command[] = TASK_VIEWS.map((v) => ({
      id: `view-${v.filter}`,
      group: 'Перейти',
      label: v.label,
      icon: v.icon,
      shortcut: v.shortcut,
      run: () => p.onNavigate({ kind: 'tasks', filter: v.filter })
    }))
    const topics: Command[] = p.topics.map((t) => ({
      id: `topic-${t.id}`,
      group: 'Топики',
      label: t.name,
      topic: t,
      keywords: 'топик',
      run: () => p.onNavigate({ kind: 'topic', id: t.id })
    }))
    const notes: Command[] = p.notes.map((n) => ({
      id: `note-${n.id}`,
      group: 'Заметки',
      label: n.title || 'Без названия',
      icon: 'file',
      keywords: n.content.slice(0, 400),
      run: () => p.onNavigate({ kind: 'note', id: n.id })
    }))
    const tasks: Command[] = p.tasks.map((t) => ({
      id: `task-${t.id}`,
      group: 'Задачи',
      label: t.title,
      icon: t.status === 'done' ? 'checkCircle' : 'inbox',
      hint: t.status === 'done' ? 'выполнена' : formatDue(t.dueDate),
      keywords: t.description,
      run: () => p.onOpenTask(t)
    }))
    return [...p.actions, ...nav, ...topics, ...notes, ...tasks]
  }, [p.actions, p.notes, p.tasks, p.topics])

  const results = useMemo(() => {
    if (!q) return all.filter((c) => c.group !== 'Задачи' && c.group !== 'Заметки').concat(all.filter((c) => c.group === 'Заметки').slice(0, 5))
    const scored = all
      .map((c) => ({ c, s: Math.max(score(c.label, q), score(c.keywords ?? '', q) * 0.5) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.c)
    const free: Command[] = [
      {
        id: 'free-ask',
        group: 'Ассистент',
        label: `Спросить ассистента: «${query.trim()}»`,
        icon: 'sparkles',
        shortcut: 'mod+enter',
        run: () => p.onAsk(query.trim())
      },
      {
        id: 'free-create',
        group: 'Ассистент',
        label: `Создать задачу «${query.trim()}»`,
        icon: 'plus',
        shortcut: 'shift+enter',
        run: () => p.onCreateTask(query.trim())
      }
    ]
    // Notes and tasks found by meaning that the word match missed.
    const shown = new Set(scored.map((c) => c.id))
    const byMeaning: Command[] = (semantic?.status === 'ready' ? semantic.hits : [])
      .map((h): Command | null => {
        const id = `${h.kind}-${h.id}`
        if (shown.has(id)) return null
        if (h.kind === 'note') {
          return { id, group: 'По смыслу', label: h.title, icon: 'file', hint: h.snippet, run: () => p.onNavigate({ kind: 'note', id: h.id }) }
        }
        const task = p.tasks.find((t) => t.id === h.id)
        if (!task) return null
        return { id, group: 'По смыслу', label: h.title, icon: task.status === 'done' ? 'checkCircle' : 'inbox', hint: h.snippet, run: () => p.onOpenTask(task) }
      })
      .filter((c): c is Command => c !== null)
      .slice(0, 6)
    // Real matches first; the free-text actions are always available below them.
    return [...scored, ...byMeaning, ...free]
  }, [all, q, query, semantic, p.tasks])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (matches(e, 'esc')) {
      e.preventDefault()
      close()
    } else if (matches(e, 'down') || matches(e, 'ctrl+n')) {
      e.preventDefault()
      setActive((a) => (a + 1) % results.length)
    } else if (matches(e, 'up') || matches(e, 'ctrl+p')) {
      e.preventDefault()
      setActive((a) => (a - 1 + results.length) % results.length)
    } else if (matches(e, 'mod+enter') && q) {
      e.preventDefault()
      runAndClose(results.find((c) => c.id === 'free-ask')!)
    } else if (matches(e, 'shift+enter') && q) {
      e.preventDefault()
      runAndClose(results.find((c) => c.id === 'free-create')!)
    } else if (matches(e, 'enter') && results[active]) {
      e.preventDefault()
      runAndClose(results[active])
    }
  }

  let lastGroup = ''
  return (
    <div className={`palette-backdrop ${closing ? 'closing' : ''}`} onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти задачу, заметку, топик или спросить ассистента…"
          />
          <Kbd keys="esc" />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  className={`palette-item ${i === active ? 'active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runAndClose(c)}
                >
                  {c.topic ? <TopicMark topic={c.topic} /> : c.icon && <Icon name={c.icon} size={15} />}
                  <span className="palette-label">{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                  {c.shortcut && <Kbd keys={c.shortcut} />}
                </button>
              </div>
            )
          })}
        </div>
        {semantic?.status === 'loading' && (
          <div className="palette-status">
            <span className="palette-spinner" />
            Готовлю поиск по смыслу: загружаю модель (один раз, ~120 МБ)
            {semantic.progress !== null && semantic.progress > 0 ? ` · ${Math.round(semantic.progress)}%` : '…'}
          </div>
        )}
        <div className="palette-footer">
          <span>
            <Kbd keys="up" /> <Kbd keys="down" /> выбрать
          </span>
          <span>
            <Kbd keys="enter" /> открыть
          </span>
          <span>
            <Kbd keys="mod+enter" /> спросить ИИ
          </span>
          <span>
            <Kbd keys="shift+enter" /> в задачи
          </span>
        </div>
      </div>
    </div>
  )
}

/** Search by meaning for queries of 3+ characters, debounced; polls while the model is loading. */
function useSemantic(query: string): SemanticSearchResult | null {
  const [result, setResult] = useState<SemanticSearchResult | null>(null)
  useEffect(() => {
    setResult(null)
    if (query.length < 3) return
    let cancelled = false
    let timer = setTimeout(function run() {
      window.api.search.semantic(query).then((res) => {
        if (cancelled) return
        setResult(res)
        if (res.status === 'loading') timer = setTimeout(run, 1500)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])
  return result
}
