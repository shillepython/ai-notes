import { useState } from 'react'
import { useData } from './useData'
import Sidebar, { type View } from './components/Sidebar'
import NoteEditor from './components/NoteEditor'
import TaskBoard from './components/TaskBoard'
import AssistantPanel from './components/AssistantPanel'

export default function App(): React.JSX.Element {
  const { notes, tasks, topics } = useData()
  const [view, setView] = useState<View>({ kind: 'tasks', filter: 'today' })

  const createNote = async (): Promise<void> => {
    const note = await window.api.notes.create({ title: 'Без названия', content: '' })
    setView({ kind: 'note', id: note.id })
  }

  const currentNote = view.kind === 'note' ? notes.find((n) => n.id === view.id) : undefined

  return (
    <div className="app">
      <Sidebar notes={notes} tasks={tasks} topics={topics} view={view} onSelect={setView} onCreateNote={createNote} />
      <main className="content">
        {view.kind === 'tasks' && <TaskBoard tasks={tasks} topics={topics} filter={view.filter} />}
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
