import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type {
  CompleteTaskOptions,
  DataChange,
  Note,
  NoteInput,
  NotePatch,
  NoteQuery,
  Task,
  TaskInput,
  TaskPatch,
  TaskQuery,
  TaskStatus
} from '../shared/types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
`

type Row = Record<string, unknown>

const toNote = (r: Row): Note => ({
  id: r.id as string,
  title: r.title as string,
  content: r.content as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

const toTask = (r: Row): Task => ({
  id: r.id as string,
  title: r.title as string,
  description: r.description as string,
  status: r.status as TaskStatus,
  priority: r.priority as Task['priority'],
  dueDate: (r.due_date as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  completedAt: (r.completed_at as string | null) ?? null
})

const matches = (query: string | undefined, ...fields: string[]): boolean => {
  if (!query?.trim()) return true
  const q = query.trim().toLocaleLowerCase()
  return fields.some((f) => f.toLocaleLowerCase().includes(q))
}

const now = (): string => new Date().toISOString()

/**
 * Local data layer for notes and tasks. All methods are synchronous.
 * Emits 'changed' (DataChange) after every mutation.
 */
export class Store extends EventEmitter {
  private db: DatabaseSync

  constructor(dbPath: string) {
    super()
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(SCHEMA)
  }

  close(): void {
    this.db.close()
  }

  private emitChange(change: DataChange): void {
    this.emit('changed', change)
  }

  // ---- Notes ----

  listNotes(q: NoteQuery = {}): Note[] {
    const rows = this.db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all() as Row[]
    return rows.map(toNote).filter((n) => matches(q.query, n.title, n.content))
  }

  getNote(id: string): Note | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
    return row ? toNote(row) : null
  }

  createNote(input: NoteInput): Note {
    const ts = now()
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO notes (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.title, input.content ?? '', ts, ts)
    this.emitChange({ entity: 'note', action: 'created', id })
    return this.getNote(id)!
  }

  updateNote(id: string, patch: NotePatch): Note {
    const current = this.getNote(id)
    if (!current) throw new Error(`Note not found: ${id}`)
    const next = { ...current, ...stripUndefined(patch), updatedAt: now() }
    this.db
      .prepare('UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.content, next.updatedAt, id)
    this.emitChange({ entity: 'note', action: 'updated', id })
    return next
  }

  deleteNote(id: string): boolean {
    const res = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    if (res.changes) this.emitChange({ entity: 'note', action: 'deleted', id })
    return res.changes > 0
  }

  // ---- Tasks ----

  listTasks(q: TaskQuery = {}): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks ORDER BY
           CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
           due_date IS NULL, due_date,
           CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           created_at DESC`
      )
      .all() as Row[]
    const statuses = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : null
    return rows
      .map(toTask)
      .filter((t) => !statuses || statuses.includes(t.status))
      .filter((t) => !q.dueFrom || (t.dueDate !== null && t.dueDate >= q.dueFrom))
      .filter((t) => !q.dueTo || (t.dueDate !== null && t.dueDate <= q.dueTo))
      .filter((t) => matches(q.query, t.title, t.description))
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined
    return row ? toTask(row) : null
  }

  createTask(input: TaskInput): Task {
    const ts = now()
    const id = randomUUID()
    const status = input.status ?? 'todo'
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, status, priority, due_date, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.description ?? '',
        status,
        input.priority ?? 'medium',
        input.dueDate ?? null,
        ts,
        ts,
        status === 'done' ? ts : null
      )
    this.emitChange({ entity: 'task', action: 'created', id })
    return this.getTask(id)!
  }

  updateTask(id: string, patch: TaskPatch): Task {
    const current = this.getTask(id)
    if (!current) throw new Error(`Task not found: ${id}`)
    const ts = now()
    const next: Task = { ...current, ...stripUndefined(patch), updatedAt: ts }
    if (next.status === 'done' && current.status !== 'done') next.completedAt = ts
    if (next.status !== 'done') next.completedAt = null
    this.db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?,
           updated_at = ?, completed_at = ? WHERE id = ?`
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.priority,
        next.dueDate,
        next.updatedAt,
        next.completedAt,
        id
      )
    this.emitChange({ entity: 'task', action: 'updated', id })
    return next
  }

  completeTask(id: string, opts: CompleteTaskOptions = {}): Task {
    const current = this.getTask(id)
    if (!current) throw new Error(`Task not found: ${id}`)
    const comment = opts.comment?.trim()
    const description = comment
      ? [current.description.trim(), `✅ ${comment}`].filter(Boolean).join('\n\n')
      : current.description
    return this.updateTask(id, { status: 'done', description })
  }

  reopenTask(id: string): Task {
    return this.updateTask(id, { status: 'todo' })
  }

  deleteTask(id: string): boolean {
    const res = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    if (res.changes) this.emitChange({ entity: 'task', action: 'deleted', id })
    return res.changes > 0
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

let instance: Store | null = null

export function initStore(dbPath: string): Store {
  instance ??= new Store(dbPath)
  return instance
}

/** The app-wide store. Call initStore() first (done in main/index.ts). */
export function getStore(): Store {
  if (!instance) throw new Error('Store not initialized')
  return instance
}
