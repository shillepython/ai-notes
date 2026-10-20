import { useEffect, useState } from 'react'
import { useData } from './useData'
import Sidebar, { type View } from './components/Sidebar'
import NoteEditor from './components/NoteEditor'
import TaskBoard from './components/TaskBoard'
import AssistantPanel from './components/AssistantPanel'

export default function App(): React.JSX.Element {
  const { notes, tasks, topics } = useData()
  const [view, setView] = useState<View>({ kind: 'tasks', filter: 'today' })
  // Task to expand after a reminder notification is clicked; `at` re-triggers for the same task.
  const [focus, setFocus] = useState<{ id: string; at: number } | null>(null)

  useEffect(
    () =>
      window.api.onReminderOpen((id) => {
        setView({ kind: 'tasks', filter: 'all' })
        setFocus({ id, at: Date.now() })
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
          : { kind: 'tasks', filter: view.filter }
    )
  }, [view])

  const createNote = async (): Promise<void> => {
    const note = await window.api.notes.create({ title: 'Без названия', content: '' })
    setView({ kind: 'note', id: note.id })
  }

  const currentNote = view.kind === 'note' ? notes.find((n) => n.id === view.id) : undefined

  return (
    <div className="app">
      <Sidebar notes={notes} tasks={tasks} topics={topics} view={view} onSelect={setView} onCreateNote={createNote} />
      <main className="content">
        {view.kind === 'tasks' && <TaskBoard tasks={tasks} topics={topics} filter={view.filter} focus={focus} />}
        {view.kind === 'topic' && (
          <TaskBoard
            key={view.id}
            tasks={tasks}
            topics={topics}
            filter="all"
            topicId={view.id}
            onTopicDeleted={() => setView({ kind: 'tasks', filter: 'all' })}
          />
        )}
        {view.kind === 'note' &&
          (currentNote ? (
            <NoteEditor
              key={currentNote.id}
              note={currentNote}
              onDeleted={() => setView({ kind: 'tasks', filter: 'today' })}
            />
          ) : (
            <div className="empty">Заметка не найдена</div>
          ))}
      </main>
      <AssistantPanel />
    </div>
  )
}
