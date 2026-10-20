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
  TaskStatus,
  Topic,
  TopicInput,
  TopicPatch
} from '../shared/types'
import { TOPIC_COLORS } from '../shared/types.ts'

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
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  topicId: (r.topic_id as string | null) ?? null,
  sortOrder: (r.sort_order as number | null) ?? 0,
  dueDate: (r.due_date as string | null) ?? null,
  remindAt: (r.remind_at as string | null) ?? null,
  remindedAt: (r.reminded_at as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  completedAt: (r.completed_at as string | null) ?? null
})

const toTopic = (r: Row): Topic => ({
  id: r.id as string,
  name: r.name as string,
  color: r.color as string,
  icon: r.icon as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
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
    this.migrate()
  }

  /** Adds columns introduced after the first release to existing databases. */
  private migrate(): void {
    const cols = (this.db.prepare('PRAGMA table_info(tasks)').all() as Row[]).map((c) => c.name)
    if (!cols.includes('topic_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN topic_id TEXT')
    if (!cols.includes('sort_order')) {
      this.db.exec('ALTER TABLE tasks ADD COLUMN sort_order REAL')
      // Existing tasks keep their creation order.
      this.db.exec("UPDATE tasks SET sort_order = (julianday(created_at) - 2440587.5) * 86400000")
    }
    if (!cols.includes('remind_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN remind_at TEXT')
    if (!cols.includes('reminded_at')) this.db.exec('ALTER TABLE tasks ADD COLUMN reminded_at TEXT')
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
      .filter((t) => q.topicId === undefined || t.topicId === q.topicId)
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
        `INSERT INTO tasks (id, title, description, status, priority, due_date, topic_id, sort_order, remind_at,
           created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.title,
        input.description ?? '',
        status,
        input.priority ?? 'medium',
        input.dueDate ?? null,
        this.checkTopicId(input.topicId),
        input.sortOrder ?? Date.now(),
        checkTimestamp(input.remindAt),
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
    next.topicId = this.checkTopicId(next.topicId)
    next.remindAt = checkTimestamp(next.remindAt)
    if (next.remindAt !== current.remindAt) next.remindedAt = null
    if (next.status === 'done' && current.status !== 'done') next.completedAt = ts
    if (next.status !== 'done') next.completedAt = null
    this.db
      .prepare(
        `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, topic_id = ?,
           sort_order = ?, remind_at = ?, reminded_at = ?, updated_at = ?, completed_at = ? WHERE id = ?`
      )
      .run(
        next.title,
        next.description,
        next.status,
        next.priority,
        next.dueDate,
        next.topicId,
        next.sortOrder,
        next.remindAt,
        next.remindedAt,
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

  // ---- Reminders ----

  /** Open tasks whose reminder time has come and that were not shown yet, oldest first. */
  dueReminders(at: Date = new Date()): Task[] {
    return this.pendingReminders().filter((t) => Date.parse(t.remindAt!) <= at.getTime())
  }

  /** The earliest reminder not shown yet, or null. */
  nextReminderAt(): string | null {
    return this.pendingReminders()[0]?.remindAt ?? null
  }

  /** Records that the reminder was shown, so it does not fire again. */
  markReminded(id: string): void {
    const res = this.db.prepare('UPDATE tasks SET reminded_at = ? WHERE id = ?').run(now(), id)
    if (res.changes) this.emitChange({ entity: 'task', action: 'updated', id })
  }

  private pendingReminders(): Task[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE remind_at IS NOT NULL AND reminded_at IS NULL AND status != 'done'`)
      .all() as Row[]
    return rows.map(toTask).sort((a, b) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!))
  }

  private checkTopicId(topicId: string | null | undefined): string | null {
    if (!topicId) return null
    if (!this.getTopic(topicId)) throw new Error(`Topic not found: ${topicId}`)
    return topicId
  }

  // ---- Topics ----

  listTopics(): Topic[] {
    const rows = this.db.prepare('SELECT * FROM topics').all() as Row[]
    return rows.map(toTopic).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }

  getTopic(id: string): Topic | null {
    const row = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as Row | undefined
    return row ? toTopic(row) : null
  }

  /** Case-insensitive exact match on the name. */
  findTopicByName(name: string): Topic | null {
    const key = name.trim().toLocaleLowerCase()
    return this.listTopics().find((t) => t.name.toLocaleLowerCase() === key) ?? null
  }

  createTopic(input: TopicInput): Topic {
    const name = input.name.trim()
    if (!name) throw new Error('Topic name is required')
    if (this.findTopicByName(name)) throw new Error(`Topic already exists: ${name}`)
    const ts = now()
    const id = randomUUID()
    const color = input.color ?? TOPIC_COLORS[this.listTopics().length % TOPIC_COLORS.length]
    this.db
      .prepare('INSERT INTO topics (id, name, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, color, input.icon ?? '', ts, ts)
    this.emitChange({ entity: 'topic', action: 'created', id })
    return this.getTopic(id)!
  }

  updateTopic(id: string, patch: TopicPatch): Topic {
    const current = this.getTopic(id)
    if (!current) throw new Error(`Topic not found: ${id}`)
    const next = { ...current, ...stripUndefined(patch), updatedAt: now() }
    next.name = next.name.trim()
    if (!next.name) throw new Error('Topic name is required')
    const clash = this.findTopicByName(next.name)
    if (clash && clash.id !== id) throw new Error(`Topic already exists: ${next.name}`)
    this.db
      .prepare('UPDATE topics SET name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.color, next.icon, next.updatedAt, id)
    this.emitChange({ entity: 'topic', action: 'updated', id })
    return next
  }

  /** Deletes the topic; its tasks are kept and lose their topic. */
  deleteTopic(id: string): boolean {
    const res = this.db.prepare('DELETE FROM topics WHERE id = ?').run(id)
    if (!res.changes) return false
    const freed = this.db.prepare('SELECT id FROM tasks WHERE topic_id = ?').all(id) as Row[]
    this.db.prepare('UPDATE tasks SET topic_id = NULL WHERE topic_id = ?').run(id)
    for (const r of freed) this.emitChange({ entity: 'task', action: 'updated', id: r.id as string })
    this.emitChange({ entity: 'topic', action: 'deleted', id })
    return true
  }
}

/** Normalizes a timestamp to ISO (UTC), or throws on an unparseable one. */
function checkTimestamp(value: string | null | undefined): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${value}`)
  return new Date(ms).toISOString()
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
