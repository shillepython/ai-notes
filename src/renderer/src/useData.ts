import { useCallback, useEffect, useState } from 'react'
import type { Note, Task, Topic } from '@shared/types'

/** Loads all notes, tasks and topics and reloads them whenever the main process reports a change. */
export function useData(): { notes: Note[]; tasks: Task[]; topics: Topic[]; reload: () => Promise<void> } {
  const [notes, setNotes] = useState<Note[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [topics, setTopics] = useState<Topic[]>([])

  const reload = useCallback(async () => {
    const [n, t, tp] = await Promise.all([window.api.notes.list(), window.api.tasks.list(), window.api.topics.list()])
    setNotes(n)
    setTasks(t)
    setTopics(tp)
  }, [])

  useEffect(() => {
    reload()
    return window.api.onDataChanged(() => reload())
  }, [reload])

  return { notes, tasks, topics, reload }
}
