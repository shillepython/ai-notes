import { useEffect, useMemo, useState } from 'react'
import type { Task } from '@shared/types'
import { useData } from './useData'
import { TASK_VIEWS, type View } from './taskViews'
import { today } from './dates'
import { emitUi, matches } from './hotkeys'
import Sidebar from './components/Sidebar'
import NoteEditor from './components/NoteEditor'
import TaskBoard from './components/TaskBoard'
import AssistantPanel from './components/AssistantPanel'
import CommandPalette, { type Command } from './components/CommandPalette'
import Toasts, { toast } from './components/Toasts'
import { Icon } from './components/Icon'

/** Remembers a UI flag (sidebar/assistant visibility) between launches. */
function usePersistentFlag(key: string, initial: boolean): [boolean, (v: boolean | ((v: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? initial : stored === '1'
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      // Storage unavailable: the flag just won't persist.
    }
  }, [key, value])
  return [value, setValue]
}

export default function App(): React.JSX.Element {
  const { notes, tasks, topics } = useData()
  const [view, setView] = useState<View>({ kind: 'tasks', filter: 'today' })
  const [sidebarOpen, setSidebarOpen] = usePersistentFlag('ui.sidebar', true)
  const [assistantOpen, setAssistantOpen] = usePersistentFlag('ui.assistant', true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [assistantWidth, setAssistantWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('ui.assistantWidth')) || 400
    } catch {
      return 400
    }
  })

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = assistantWidth
    document.body.classList.add('resizing')
    const onMove = (ev: MouseEvent): void => {
      setAssistantWidth(Math.min(640, Math.max(320, startW + startX - ev.clientX)))
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    try {
      localStorage.setItem('ui.assistantWidth', String(assistantWidth))
    } catch {
      // Not persisted; fine.
    }
  }, [assistantWidth])

  const createNote = async (): Promise<void> => {
    const note = await window.api.notes.create({ title: '', content: '' })
    setView({ kind: 'note', id: note.id })
  }

  const newTask = (): void => {
    if (view.kind === 'note' || (view.kind === 'tasks' && view.filter === 'done')) setView({ kind: 'tasks', filter: 'today' })
    // After the view switch has rendered the quick-add field.
    setTimeout(() => emitUi('quick-add:focus'), 30)
  }

  const focusAssistant = (): void => {
    setAssistantOpen(true)
    setTimeout(() => emitUi('assistant:focus'), 30)
  }

  const askAssistant = (text: string): void => {
    setAssistantOpen(true)
    setTimeout(() => window.dispatchEvent(new CustomEvent('assistant:submit', { detail: text })), 30)
  }

  const openTask = (task: Task): void => {
    if (task.status === 'done') setView({ kind: 'tasks', filter: 'done' })
    else if (task.topicId) setView({ kind: 'topic', id: task.topicId })
    else setView({ kind: 'tasks', filter: 'all' })
    setTimeout(() => window.dispatchEvent(new CustomEvent('ui:open-task', { detail: task.id })), 60)
  }

  const actions = useMemo<Command[]>(
    () => [
      { id: 'new-task', group: 'Действия', label: 'Новая задача', icon: 'plus', shortcut: 'mod+n', run: newTask },
      { id: 'new-note', group: 'Действия', label: 'Новая заметка', icon: 'file', shortcut: 'mod+shift+n', run: createNote },
      { id: 'ask', group: 'Действия', label: 'Спросить ассистента', icon: 'sparkles', shortcut: 'mod+j', run: focusAssistant },
      {
        id: 'toggle-sidebar',
        group: 'Действия',
        label: sidebarOpen ? 'Скрыть боковую панель' : 'Показать боковую панель',
        icon: 'sidebar',
        shortcut: 'mod+\\',
        run: () => setSidebarOpen((v) => !v)
      },
      {
        id: 'toggle-assistant',
        group: 'Действия',
        label: assistantOpen ? 'Скрыть ассистента' : 'Показать ассистента',
        icon: 'panelRight',
        shortcut: 'mod+.',
        run: () => setAssistantOpen((v) => !v)
      }
    ],
    [sidebarOpen, assistantOpen, view]
  )

  // Global shortcuts. Letters match physical keys, so they work in the Russian layout too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const run = (fn: () => void): void => {
        e.preventDefault()
        fn()
      }
      if (matches(e, 'mod+k')) run(() => setPaletteOpen((v) => !v))
      else if (matches(e, 'mod+n')) run(newTask)
      else if (matches(e, 'mod+shift+n')) run(createNote)
      else if (matches(e, 'mod+j')) run(focusAssistant)
      else if (matches(e, 'mod+\\')) run(() => setSidebarOpen((v) => !v))
      else if (matches(e, 'mod+.')) run(() => setAssistantOpen((v) => !v))
      else {
        const v = TASK_VIEWS.find((x) => matches(e, x.shortcut))
        if (v) run(() => setView({ kind: 'tasks', filter: v.filter }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const currentNote = view.kind === 'note' ? notes.find((n) => n.id === view.id) : undefined
  const viewKey = view.kind === 'tasks' ? view.filter : view.id

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'} ${assistantOpen ? '' : 'assistant-hidden'}`}>
      <div className="sidebar-wrap">
        <Sidebar
          notes={notes}
          tasks={tasks}
          topics={topics}
          view={view}
          onSelect={setView}
          onCreateNote={createNote}
          onOpenPalette={() => setPaletteOpen(true)}
        />
      </div>

      <main className="content">
        <div className="topbar">
          <button className="icon-btn" title="Боковая панель (⌘\)" onClick={() => setSidebarOpen((v) => !v)}>
            <Icon name="sidebar" size={16} />
          </button>
          <div className="topbar-spacer" />
          {!assistantOpen && (
            <button className="ask-pill" onClick={focusAssistant} title="Ассистент (⌘J)">
              <Icon name="sparkles" size={14} /> Спросить ИИ
            </button>
          )}
          <button
            className={`icon-btn ${assistantOpen ? 'on' : ''}`}
            title="Ассистент (⌘.)"
            onClick={() => setAssistantOpen((v) => !v)}
          >
            <Icon name="panelRight" size={16} />
          </button>
        </div>

        <div className="content-scroll" key={viewKey}>
          {view.kind === 'tasks' && <TaskBoard tasks={tasks} topics={topics} filter={view.filter} />}
          {view.kind === 'topic' && (
            <TaskBoard
              tasks={tasks}
              topics={topics}
              filter="all"
              topicId={view.id}
              onTopicDeleted={() => setView({ kind: 'tasks', filter: 'all' })}
              onTopicRestored={(id) => setView({ kind: 'topic', id })}
            />
          )}
          {view.kind === 'note' &&
            (currentNote ? (
              <NoteEditor
                note={currentNote}
                onDeleted={() => setView({ kind: 'tasks', filter: 'today' })}
                onRestored={(id) => setView({ kind: 'note', id })}
              />
            ) : (
              <div className="empty">Заметка не найдена</div>
            ))}
        </div>
      </main>

      <div className="assistant-wrap" style={{ '--assistant-w': `${assistantWidth}px` } as React.CSSProperties}>
        <div className="resize-handle" onMouseDown={startResize} title="Потяни, чтобы изменить ширину" />
        <AssistantPanel onClose={() => setAssistantOpen(false)} />
      </div>

      {paletteOpen && (
        <CommandPalette
          notes={notes}
          tasks={tasks}
          topics={topics}
          actions={actions}
          onNavigate={setView}
          onOpenTask={openTask}
          onAsk={askAssistant}
          onCreateTask={async (title) => {
            await window.api.tasks.create({ title, dueDate: today() })
            toast(`Задача «${title}» добавлена на сегодня`)
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      <Toasts />
    </div>
  )
}
