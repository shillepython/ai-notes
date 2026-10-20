import { useCallback, useEffect, useState } from 'react'
import type { Note, Task } from '@shared/types'

/** Loads all notes and tasks and reloads them whenever the main process reports a change. */
export function useData(): { notes: Note[]; tasks: Task[]; reload: () => Promise<void> } {
  const [notes, setNotes] = useState<Note[]>([])
  const [tasks, setTasks] = useState<Task[]>([])

  const reload = useCallback(async () => {
    const [n, t] = await Promise.all([window.api.notes.list(), window.api.tasks.list()])
    setNotes(n)
    setTasks(t)
  }, [])

  useEffect(() => {
    reload()
    return window.api.onDataChanged(() => reload())
  }, [reload])

  return { notes, tasks, reload }
}
