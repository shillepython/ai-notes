export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Note {
  id: string
  title: string
  /** Markdown */
  content: string
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** YYYY-MM-DD or null */
  dueDate: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface NoteQuery {
  query?: string
}

export interface NoteInput {
  title: string
  content?: string
}

export type NotePatch = Partial<Pick<Note, 'title' | 'content'>>

export interface TaskQuery {
  status?: TaskStatus | TaskStatus[]
  query?: string
  /** Inclusive, YYYY-MM-DD */
  dueFrom?: string
  /** Inclusive, YYYY-MM-DD */
  dueTo?: string
}

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: string | null
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate'>>

export interface CompleteTaskOptions {
  /** Appended to the task description, e.g. "what was done" */
  comment?: string
}

export type DataChange = { entity: 'note' | 'task'; action: 'created' | 'updated' | 'deleted'; id: string }
