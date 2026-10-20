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

/** A user-created group for tasks, e.g. "Работа" or "Дом". */
export interface Topic {
  id: string
  name: string
  /** Hex color, e.g. '#3b82f6' */
  color: string
  /** Emoji or '' */
  icon: string
  createdAt: string
  updatedAt: string
}

/** Suggested colors for topic pickers; the first one is the default. */
export const TOPIC_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#eab308', '#14b8a6', '#ec4899', '#64748b']

export interface TopicInput {
  name: string
  color?: string
  icon?: string
}

export type TopicPatch = Partial<Pick<Topic, 'name' | 'color' | 'icon'>>

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** Topic id or null */
  topicId: string | null
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
  /** A topic id, or null for tasks without a topic. Omit for all tasks. */
  topicId?: string | null
}

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: string | null
  topicId?: string | null
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'dueDate' | 'topicId'>>

export interface CompleteTaskOptions {
  /** Appended to the task description, e.g. "what was done" */
  comment?: string
}

export type DataChange = { entity: 'note' | 'task' | 'topic'; action: 'created' | 'updated' | 'deleted'; id: string }
