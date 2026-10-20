import { useCallback, useEffect, useState } from 'react'
import type { Note, Task, Topic, TrashItem } from '@shared/types'

/** Loads all notes, tasks, topics and the trash, and reloads them whenever the main process reports a change. */
export function useData(): {
  notes: Note[]
  tasks: Task[]
  topics: Topic[]
  trash: TrashItem[]
  reload: () => Promise<void>
} {
  const [notes, setNotes] = useState<Note[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [trash, setTrash] = useState<TrashItem[]>([])

  const reload = useCallback(async () => {
    const [n, t, tp, tr] = await Promise.all([
      window.api.notes.list(),
      window.api.tasks.list(),
      window.api.topics.list(),
      window.api.trash.list()
    ])
    setNotes(n)
    setTasks(t)
    setTopics(tp)
    setTrash(tr)
  }, [])

  useEffect(() => {
    reload()
    return window.api.onDataChanged(() => reload())
  }, [reload])

  return { notes, tasks, topics, trash, reload }
}
