import { useEffect, useMemo, useRef, useState } from 'react'
import type { DigestSettings, Task } from '@shared/types'
import type { SyncStatus } from '@shared/data'
import { applyTemplate, type NoteTemplate } from '@shared/templates'
import { useTemplates } from './templates'
import { useData } from './useData'
import { TASK_VIEWS, type View } from './taskViews'
import { today } from './dates'
import { emitUi, matches } from './hotkeys'
import Sidebar from './components/Sidebar'
import NoteEditor from './components/NoteEditor'
import TaskBoard from './components/TaskBoard'
import TrashView from './components/TrashView'
import DocsHome from './components/DocsHome'
import DocEditor from './components/DocEditor'
import { useDocLibrary } from './docs'
import AssistantPanel from './components/AssistantPanel'
import CommandPalette, { type Command } from './components/CommandPalette'
import Toasts, { toast } from './components/Toasts'
import { Icon } from './components/Icon'
import type { OpenLink } from './components/Links'
import { resolveLink } from '@shared/links'

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
  const { notes, tasks, topics, trash } = useData()
  const templates = useTemplates()
  const library = useDocLibrary()
  const [view, setView] = useState<View>({ kind: 'tasks', filter: 'today' })
  const [sidebarOpen, setSidebarOpen] = usePersistentFlag('ui.sidebar', true)
  const [assistantOpen, setAssistantOpen] = usePersistentFlag('ui.assistant', true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [digest, setDigest] = useState<DigestSettings | null>(null)
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

  const createNote = async (tpl?: NoteTemplate): Promise<void> => {
    const note = await window.api.notes.create(tpl ? applyTemplate(tpl) : { title: '', content: '' })
    setView({ kind: 'note', id: note.id })
  }

  const newTask = (): void => {
    if (view.kind !== 'topic' && (view.kind !== 'tasks' || view.filter === 'done')) setView({ kind: 'tasks', filter: 'today' })
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

  const askDigest = (kind: 'briefing' | 'weekly'): void => askAssistant(kind === 'briefing' ? 'Утренний брифинг' : 'Итоги недели')

  const toggleDigest = async (key: 'dailyEnabled' | 'weeklyEnabled'): Promise<void> => {
    if (!digest) return
    const next = await window.api.digest.updateSettings({ [key]: !digest[key] })
    setDigest(next)
    toast(
      key === 'dailyEnabled'
        ? next.dailyEnabled ? `Брифинг будет приходить в ${next.dailyTime}` : 'Ежедневный брифинг выключен'
        : next.weeklyEnabled ? `Итоги недели по воскресеньям в ${next.weeklyTime}` : 'Итоги недели выключены'
    )
  }

  useEffect(() => {
    window.api.digest.getSettings().then(setDigest)
    const offOpen = window.api.digest.onOpen(askDigest)
    const onUiDigest = (e: Event): void => askDigest((e as CustomEvent<'briefing' | 'weekly'>).detail)
    window.addEventListener('ui:digest', onUiDigest)
    return () => {
      offOpen()
      window.removeEventListener('ui:digest', onUiDigest)
    }
  }, [])

  const actions = useMemo<Command[]>(
    () => [
      { id: 'new-task', group: 'Действия', label: 'Новая задача', icon: 'plus', shortcut: 'mod+n', run: newTask },
      { id: 'new-note', group: 'Действия', label: 'Новая заметка', icon: 'file', shortcut: 'mod+shift+n', run: () => createNote() },
      ...templates.map(
        (t): Command => ({
          id: `new-note-${t.id}`,
          group: 'Шаблоны',
          label: `Новая заметка: ${t.name}`,
          icon: 'template',
          keywords: 'шаблон template',
          run: () => createNote(t)
        })
      ),
      { id: 'docs', group: 'Перейти', label: 'Документы', icon: 'book', keywords: 'markdown md файлы шаблоны', run: () => setView({ kind: 'docs' }) },
      {
        id: 'open-md',
        group: 'Документы',
        label: 'Открыть .md файл…',
        icon: 'folder',
        keywords: 'markdown открыть файл читалка',
        run: async () => {
          const paths = await window.api.docs.open()
          if (paths.length) setView({ kind: 'doc', path: paths[0] })
        }
      },
      ...library.templates.map(
        (t): Command => ({
          id: `new-doc-${t.path}`,
          group: 'Документы',
          label: `Новый документ: ${t.name}`,
          icon: 'template',
          keywords: 'шаблон markdown md заполнить',
          run: async () => {
            const doc = await window.api.docs.create({ fromTemplate: t.path })
            setView({ kind: 'doc', path: doc.path })
          }
        })
      ),
      ...library.docs.slice(0, 30).map(
        (d): Command => ({
          id: `doc-${d.path}`,
          group: 'Документы',
          label: d.title || d.name,
          hint: `${d.name}.md`,
          icon: 'file',
          keywords: 'документ markdown',
          run: () => setView({ kind: 'doc', path: d.path })
        })
      ),
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
      },
      {
        id: 'briefing',
        group: 'Сводки',
        label: 'Утренний брифинг',
        icon: 'sun',
        keywords: 'что у меня сегодня сводка план дня',
        run: () => askDigest('briefing')
      },
      {
        id: 'weekly',
        group: 'Сводки',
        label: 'Итоги недели',
        icon: 'calendar',
        keywords: 'обзор недели что сделал сводка',
        run: () => askDigest('weekly')
      },
      ...(digest
        ? [
            {
              id: 'toggle-daily',
              group: 'Сводки',
              label: digest.dailyEnabled ? `Не присылать брифинг в ${digest.dailyTime}` : 'Присылать брифинг каждое утро',
              icon: 'bell' as const,
              keywords: 'уведомление брифинг выключить включить',
              run: () => void toggleDigest('dailyEnabled')
            },
            {
              id: 'toggle-weekly',
              group: 'Сводки',
              label: digest.weeklyEnabled ? 'Не присылать итоги недели' : 'Присылать итоги недели по воскресеньям',
              icon: 'bell' as const,
              keywords: 'уведомление обзор итоги выключить включить',
              run: () => void toggleDigest('weeklyEnabled')
            }
          ]
        : []),
      { id: 'trash', group: 'Перейти', label: 'Корзина', icon: 'trash', keywords: 'удалённые', run: () => setView({ kind: 'trash' }) }
    ],
    [sidebarOpen, assistantOpen, view, templates, digest, library]
  )

  useEffect(() => {
    window.api.data.syncStatus().then(setSync)
    return window.api.data.onSyncStatus(setSync)
  }, [])

  const dataActions = useMemo<Command[]>(() => {
    const run = (fn: () => Promise<void>) => async (): Promise<void> => {
      try {
        await fn()
      } catch (err) {
        toast(`Не получилось: ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : err}`)
      }
    }
    const list: Command[] = [
      {
        id: 'export-md',
        group: 'Данные',
        label: 'Экспорт в Markdown',
        icon: 'download',
        shortcut: 'mod+shift+e',
        keywords: 'выгрузить сохранить md',
        run: run(async () => {
          const res = await window.api.data.exportMarkdown()
          if (res) toast(`Экспортировано: ${res.notes} заметок и все задачи`)
        })
      },
      {
        id: 'backup',
        group: 'Данные',
        label: 'Создать резервную копию',
        icon: 'archive',
        keywords: 'бэкап backup',
        run: run(async () => {
          await window.api.data.backup()
          toast('Резервная копия сохранена', { label: 'Показать', run: () => void window.api.data.openBackups() })
        })
      },
      {
        id: 'restore',
        group: 'Данные',
        label: 'Восстановить из резервной копии…',
        icon: 'undo',
        keywords: 'бэкап backup',
        run: run(async () => void (await window.api.data.restore()))
      }
    ]
    if (sync?.available) {
      list.push({
        id: 'sync-toggle',
        group: 'Данные',
        label: sync.enabled ? 'Выключить синхронизацию через iCloud' : 'Включить синхронизацию через iCloud',
        icon: 'cloud',
        keywords: 'icloud синк sync mac',
        run: run(async () => {
          const s = await window.api.data.setSyncEnabled(!sync.enabled)
          toast(s.enabled ? 'Синхронизация через iCloud Drive включена' : 'Синхронизация выключена')
        })
      })
      if (sync.enabled) {
        list.push({
          id: 'sync-now',
          group: 'Данные',
          label: 'Синхронизировать сейчас',
          icon: 'cloud',
          hint: sync.devices.length ? `ещё Mac: ${sync.devices.map((d) => d.name).join(', ')}` : 'других Mac пока нет',
          keywords: 'icloud sync',
          run: run(async () => {
            const s = await window.api.data.syncNow()
            toast(s.lastError ? `Синхронизация: ${s.lastError}` : 'Синхронизировано')
          })
        })
      }
    }
    return list
  }, [sync])

  // [[Links]] in notes and task details: open the target, or create a note for a title that does not exist yet.
  const linkState = useRef({ notes, tasks })
  linkState.current = { notes, tasks }
  useEffect(() => {
    const onOpen = async (e: Event): Promise<void> => {
      const detail = (e as CustomEvent<OpenLink>).detail
      const { notes, tasks } = linkState.current
      if ('id' in detail) {
        if (detail.kind === 'note') setView({ kind: 'note', id: detail.id })
        else {
          const task = tasks.find((t) => t.id === detail.id)
          if (task) openTask(task)
        }
        return
      }
      const target = resolveLink(detail.title, notes, tasks)
      if (target?.kind === 'note') setView({ kind: 'note', id: target.note.id })
      else if (target?.kind === 'task') openTask(target.task)
      else {
        const note = await window.api.notes.create({ title: detail.title, content: '' })
        setView({ kind: 'note', id: note.id })
        toast(`Создана заметка «${detail.title}»`)
      }
    }
    const listener = (e: Event): void => void onOpen(e)
    window.addEventListener('ui:open-link', listener)
    return () => window.removeEventListener('ui:open-link', listener)
  }, [])

  // .md files opened from Finder show up as documents.
  useEffect(() => window.api.docs.onOpenPath((path) => setView({ kind: 'doc', path })), [])

  // Clicking a reminder notification opens its task.
  useEffect(
    () =>
      window.api.onReminderOpen((id) => {
        setView({ kind: 'tasks', filter: 'all' })
        setTimeout(() => window.dispatchEvent(new CustomEvent('ui:open-task', { detail: id })), 60)
      }),
    []
  )

  // Lets the assistant file new tasks into the open topic and write into the open note.
  useEffect(() => {
    window.api.ai.setViewContext(
      view.kind === 'topic'
        ? { kind: 'topic', topicId: view.id }
        : view.kind === 'note'
          ? { kind: 'note', noteId: view.id }
          : { kind: 'tasks', filter: view.kind === 'tasks' ? view.filter : view.kind }
    )
  }, [view])

  // Global shortcuts. Letters match physical keys, so they work in the Russian layout too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const run = (fn: () => void): void => {
        e.preventDefault()
        fn()
      }
      if (matches(e, 'mod+k')) run(() => setPaletteOpen((v) => !v))
      else if (matches(e, 'mod+n')) run(newTask)
      else if (matches(e, 'mod+shift+n')) run(() => createNote())
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
  const viewKey =
    view.kind === 'tasks' ? view.filter : view.kind === 'trash' || view.kind === 'docs' ? view.kind : view.kind === 'doc' ? view.path : view.id

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'} ${assistantOpen ? '' : 'assistant-hidden'}`}>
      <div className="sidebar-wrap">
        <Sidebar
          notes={notes}
          tasks={tasks}
          topics={topics}
          trash={trash}
          docs={library.docs}
          view={view}
          onSelect={setView}
          onCreateNote={() => createNote()}
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
          {view.kind === 'tasks' && <TaskBoard tasks={tasks} notes={notes} topics={topics} filter={view.filter} />}
          {view.kind === 'topic' && (
            <TaskBoard
              tasks={tasks}
              notes={notes}
              topics={topics}
              filter="all"
              topicId={view.id}
              onTopicDeleted={() => setView({ kind: 'tasks', filter: 'all' })}
              onTopicRestored={(id) => setView({ kind: 'topic', id })}
            />
          )}
          {view.kind === 'trash' && <TrashView items={trash} />}
          {view.kind === 'docs' && <DocsHome library={library} onOpen={(path) => setView({ kind: 'doc', path })} />}
          {view.kind === 'doc' && (
            <DocEditor
              path={view.path}
              doc={[...library.docs, ...library.templates].find((d) => d.path === view.path)}
              onBack={() => setView({ kind: 'docs' })}
              onOpen={(path) => setView({ kind: 'doc', path })}
              onOpenNote={(id) => setView({ kind: 'note', id })}
            />
          )}
          {view.kind === 'note' &&
            (currentNote ? (
              <NoteEditor
                note={currentNote}
                notes={notes}
                tasks={tasks}
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
          actions={[...actions, ...dataActions]}
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
