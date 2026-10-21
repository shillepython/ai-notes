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
  TopicPatch,
  TrashItem,
  TrashKind
} from '../shared/types'
import { TOPIC_COLORS, trashItemId } from '../shared/types.ts'

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
CREATE TABLE IF NOT EXISTS purged (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  purged_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
`

type Row = Record<string, unknown>

/** Tasks whose topic is in the trash read as having no topic until the topic is restored. */
const TASK_SELECT = `SELECT *, CASE WHEN topic_id IN (SELECT id FROM topics WHERE deleted_at IS NULL) THEN topic_id END
  AS live_topic_id FROM tasks`

const TABLES: Record<TrashKind, string> = { note: 'notes', task: 'tasks', topic: 'topics' }

/** All rows of every table, trashed ones included, plus what was erased for good. Used for sync between Macs. */
export interface Snapshot {
  format: 1
  notes: Row[]
  tasks: Row[]
  topics: Row[]
  purged: { kind: TrashKind; id: string; purgedAt: string }[]
}

/** When a row last changed in any way, including a move to or from the trash. */
const rowStamp = (r: Row): string => {
  const updated = r.updated_at as string
  const deleted = (r.deleted_at as string | null) ?? ''
  return deleted > updated ? deleted : updated
}

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
  topicId: (r.live_topic_id as string | null) ?? null,
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
    // Soft delete: a set deleted_at means the row is in the trash.
    for (const table of Object.values(TABLES)) {
      const tableCols = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => c.name)
      if (!tableCols.includes('deleted_at')) this.db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`)
    }
  }

  close(): void {
    this.db.close()
  }

  /** Writes a consistent copy of the whole database to a new file (which must not exist). */
  backupTo(path: string): void {
    this.db.prepare('VACUUM INTO ?').run(path)
  }

  // ---- Sync ----

  snapshot(): Snapshot {
    const all = (table: string): Row[] => this.db.prepare(`SELECT * FROM ${table}`).all() as Row[]
    return {
      format: 1,
      notes: all('notes'),
      tasks: all('tasks'),
      topics: all('topics'),
      purged: all('purged').map((r) => ({ kind: r.kind as TrashKind, id: r.id as string, purgedAt: r.purged_at as string }))
    }
  }

  /**
   * Brings in another device's snapshot. Per row, the most recent change wins (edit, move to
   * the trash or restore); things erased for good stay erased everywhere. Returns how many rows changed.
   */
  mergeSnapshot(snap: Snapshot): number {
    if (snap.format !== 1) throw new Error(`Unsupported snapshot format: ${String(snap.format)}`)
    const changes: DataChange[] = []
    const isPurged = this.db.prepare('SELECT 1 FROM purged WHERE kind = ? AND id = ?')
    this.db.exec('BEGIN')
    try {
      for (const p of snap.purged) {
        if (!TABLES[p.kind]) continue
        this.db.prepare('INSERT OR IGNORE INTO purged (kind, id, purged_at) VALUES (?, ?, ?)').run(p.kind, p.id, p.purgedAt)
        const res = this.db.prepare(`DELETE FROM ${TABLES[p.kind]} WHERE id = ?`).run(p.id)
        if (res.changes) changes.push({ entity: p.kind, action: 'purged', id: p.id })
      }
      const kinds: [TrashKind, Row[]][] = [
        ['topic', snap.topics],
        ['note', snap.notes],
        ['task', snap.tasks]
      ]
      for (const [kind, rows] of kinds) {
        const table = TABLES[kind]
        const cols = (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((c) => c.name as string)
        for (const row of rows) {
          const id = row.id as string
          if (typeof id !== 'string' || typeof row.updated_at !== 'string' || isPurged.get(kind, id)) continue
          const local = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined
          if (local && rowStamp(row) <= rowStamp(local)) continue
          const present = cols.filter((c) => c in row)
          this.db
            .prepare(`INSERT OR REPLACE INTO ${table} (${present.join(', ')}) VALUES (${present.map(() => '?').join(', ')})`)
            .run(...present.map((c) => row[c] as string | number | null))
          if (kind === 'topic' && !row.deleted_at) this.dedupeTopicName(id)
          const trashed = Boolean(row.deleted_at)
          const action: DataChange['action'] = !local
            ? trashed ? 'deleted' : 'created'
            : trashed && !local.deleted_at ? 'deleted' : !trashed && local.deleted_at ? 'created' : 'updated'
          if (!(trashed && !local)) changes.push({ entity: kind, action, id })
          if (kind === 'topic' && Boolean(local?.deleted_at) !== trashed) {
            for (const taskId of this.topicTaskIds(id)) changes.push({ entity: 'task', action: 'updated', id: taskId })
          }
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    for (const c of changes) this.emitChange(c)
    return changes.length
  }

  /** Topics made separately on two Macs may share a name; names must stay unique, so the incoming one gets a suffix. */
  private dedupeTopicName(id: string): void {
    const row = this.db.prepare('SELECT name FROM topics WHERE id = ?').get(id) as Row
    const base = row.name as string
    const taken = (name: string): boolean =>
      this.listTopics().some((t) => t.id !== id && t.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (!taken(base)) return
    let name = base
    for (let n = 2; taken(name); n++) name = `${base} (${n})`
    this.db.prepare('UPDATE topics SET name = ? WHERE id = ?').run(name, id)
  }

  private emitChange(change: DataChange): void {
    this.emit('changed', change)
  }

  // ---- Notes ----

  listNotes(q: NoteQuery = {}): Note[] {
    const rows = this.db.prepare('SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as Row[]
    return rows.map(toNote).filter((n) => matches(q.query, n.title, n.content))
  }

  getNote(id: string): Note | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
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

  /** Moves the note to the trash. */
  deleteNote(id: string): boolean {
    return this.moveToTrash('note', id)
  }

  // ---- Tasks ----

  listTasks(q: TaskQuery = {}): Task[] {
    const rows = this.db
      .prepare(
        `${TASK_SELECT} WHERE deleted_at IS NULL ORDER BY
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
    const row = this.db.prepare(`${TASK_SELECT} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined
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

  /** Moves the task to the trash. */
  deleteTask(id: string): boolean {
    return this.moveToTrash('task', id)
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
    const ts = now()
    const res = this.db.prepare('UPDATE tasks SET reminded_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, id)
    if (res.changes) this.emitChange({ entity: 'task', action: 'updated', id })
  }

  private pendingReminders(): Task[] {
    const rows = this.db
      .prepare(
        `${TASK_SELECT} WHERE remind_at IS NOT NULL AND reminded_at IS NULL AND status != 'done' AND deleted_at IS NULL`
      )
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
    const rows = this.db.prepare('SELECT * FROM topics WHERE deleted_at IS NULL').all() as Row[]
    return rows.map(toTopic).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }

  getTopic(id: string): Topic | null {
    const row = this.db.prepare('SELECT * FROM topics WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined
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

  /** Moves the topic to the trash; its tasks are kept and show without a topic until it is restored. */
  deleteTopic(id: string): boolean {
    return this.moveToTrash('topic', id)
  }

  // ---- Trash ----

  /** Everything in the trash, most recently deleted first. */
  listTrash(): TrashItem[] {
    const rows = (table: string): Row[] =>
      this.db.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NOT NULL`).all() as Row[]
    const items: TrashItem[] = [
      ...rows('notes').map((r): TrashItem => ({ kind: 'note', deletedAt: r.deleted_at as string, note: toNote(r) })),
      ...(this.db.prepare(`${TASK_SELECT} WHERE deleted_at IS NOT NULL`).all() as Row[]).map(
        (r): TrashItem => ({ kind: 'task', deletedAt: r.deleted_at as string, task: toTask(r) })
      ),
      ...rows('topics').map(
        (r): TrashItem => ({
          kind: 'topic',
          deletedAt: r.deleted_at as string,
          topic: toTopic(r),
          taskCount: this.topicTaskIds(r.id as string).length
        })
      )
    ]
    return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  /** Brings an item back from the trash. A restored topic gets its tasks back. */
  restoreFromTrash(kind: TrashKind, id: string): boolean {
    if (kind === 'topic') {
      const row = this.db.prepare('SELECT name FROM topics WHERE id = ? AND deleted_at IS NOT NULL').get(id) as
        | Row
        | undefined
      if (!row) return false
      // A topic with the same name may have been created meanwhile; names must stay unique.
      let name = row.name as string
      for (let n = 2; this.findTopicByName(name); n++) name = `${row.name} (${n})`
      this.db.prepare('UPDATE topics SET name = ? WHERE id = ?').run(name, id)
    }
    // Bumping updated_at lets sync tell the restore apart from the older move to the trash.
    const res = this.db
      .prepare(`UPDATE ${TABLES[kind]} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`)
      .run(now(), id)
    if (!res.changes) return false
    if (kind === 'topic') this.emitTasksUpdated(this.topicTaskIds(id))
    this.emitChange({ entity: kind, action: 'created', id })
    return true
  }

  /** Erases an item that is in the trash. Tasks of an erased topic stay, without a topic. */
  deleteForever(kind: TrashKind, id: string): boolean {
    const res = this.db.prepare(`DELETE FROM ${TABLES[kind]} WHERE id = ? AND deleted_at IS NOT NULL`).run(id)
    if (!res.changes) return false
    // Remembered so that sync erases it on other Macs too instead of bringing it back.
    this.db.prepare('INSERT OR REPLACE INTO purged (kind, id, purged_at) VALUES (?, ?, ?)').run(kind, id, now())
    if (kind === 'topic') this.db.prepare('UPDATE tasks SET topic_id = NULL WHERE topic_id = ?').run(id)
    this.emitChange({ entity: kind, action: 'purged', id })
    return true
  }

  /** Erases everything in the trash. Returns how many items were erased. */
  emptyTrash(): number {
    const items = this.listTrash()
    for (const item of items) this.deleteForever(item.kind, trashItemId(item))
    return items.length
  }

  private moveToTrash(kind: TrashKind, id: string): boolean {
    const res = this.db.prepare(`UPDATE ${TABLES[kind]} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now(), id)
    if (!res.changes) return false
    if (kind === 'topic') this.emitTasksUpdated(this.topicTaskIds(id))
    this.emitChange({ entity: kind, action: 'deleted', id })
    return true
  }

  /** Ids of the live tasks filed under a topic, whether or not the topic is in the trash. */
  private topicTaskIds(topicId: string): string[] {
    const rows = this.db.prepare('SELECT id FROM tasks WHERE topic_id = ? AND deleted_at IS NULL').all(topicId) as Row[]
    return rows.map((r) => r.id as string)
  }

  private emitTasksUpdated(ids: string[]): void {
    for (const id of ids) this.emitChange({ entity: 'task', action: 'updated', id })
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
