import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.ts'

const fresh = (): Store => new Store(':memory:')

test('notes: create, update, search, delete', () => {
  const s = fresh()
  const n = s.createNote({ title: 'Идеи', content: '# Проект\nсделать AI заметки' })
  assert.equal(s.listNotes().length, 1)
  assert.equal(s.listNotes({ query: 'ai ЗАМЕТКИ' }).length, 1)
  assert.equal(s.listNotes({ query: 'нет такого' }).length, 0)
  const u = s.updateNote(n.id, { title: 'Идеи 2' })
  assert.equal(u.title, 'Идеи 2')
  assert.equal(u.content, n.content)
  assert.equal(s.deleteNote(n.id), true)
  assert.equal(s.getNote(n.id), null)
})

test('tasks: create, filter, complete with comment, reopen', () => {
  const s = fresh()
  const changes: unknown[] = []
  s.on('changed', (c) => changes.push(c))
  const a = s.createTask({ title: 'Купить молоко', dueDate: '2026-10-21', priority: 'high' })
  s.createTask({ title: 'Позвонить', dueDate: '2026-10-25' })
  s.createTask({ title: 'Без даты' })
  assert.equal(s.listTasks({ dueFrom: '2026-10-21', dueTo: '2026-10-22' }).length, 1)
  assert.equal(s.listTasks({ status: 'todo' }).length, 3)

  const done = s.completeTask(a.id, { comment: 'купил 2 литра' })
  assert.equal(done.status, 'done')
  assert.ok(done.completedAt)
  assert.match(done.description, /купил 2 литра/)
  assert.equal(s.listTasks({ status: ['todo', 'in_progress'] }).length, 2)

  const reopened = s.reopenTask(a.id)
  assert.equal(reopened.status, 'todo')
  assert.equal(reopened.completedAt, null)
  assert.equal(changes.length, 5)
})

test('topics: create, assign, filter, rename, delete keeps tasks', () => {
  const s = fresh()
  const work = s.createTopic({ name: 'Работа', icon: '💼' })
  assert.ok(work.color)
  assert.throws(() => s.createTopic({ name: ' работа ' }))
  assert.equal(s.findTopicByName('РАБОТА')?.id, work.id)

  const a = s.createTask({ title: 'Отчёт', topicId: work.id })
  s.createTask({ title: 'Магазин' })
  assert.equal(s.listTasks({ topicId: work.id }).length, 1)
  assert.equal(s.listTasks({ topicId: null }).length, 1)
  assert.throws(() => s.createTask({ title: 'x', topicId: 'nope' }))

  assert.equal(s.updateTopic(work.id, { name: 'Офис' }).name, 'Офис')
  assert.equal(s.updateTask(a.id, { topicId: null }).topicId, null)
  s.updateTask(a.id, { topicId: work.id })

  assert.equal(s.deleteTopic(work.id), true)
  assert.equal(s.listTopics().length, 0)
  assert.equal(s.getTask(a.id)!.topicId, null)
})

test('opening a database from before topics adds the topic_id column', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const path = join(mkdtempSync(join(tmpdir(), 'ai-notes-')), 'old.db')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo', priority TEXT NOT NULL DEFAULT 'medium', due_date TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
    INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t1', 'Старая', 'x', 'x');`)
  old.close()
  const s = new Store(path)
  assert.equal(s.getTask('t1')!.topicId, null)
  const topic = s.createTopic({ name: 'Дом' })
  assert.equal(s.updateTask('t1', { topicId: topic.id }).topicId, topic.id)
  s.close()
})

test('tasks: manual sort order survives updates', () => {
  const s = fresh()
  const a = s.createTask({ title: 'A' })
  const b = s.createTask({ title: 'B' })
  assert.ok(b.sortOrder >= a.sortOrder)
  const moved = s.updateTask(b.id, { sortOrder: a.sortOrder - 1 })
  assert.equal(moved.sortOrder, a.sortOrder - 1)
  assert.equal(s.updateTask(b.id, { title: 'B2' }).sortOrder, a.sortOrder - 1)
  assert.equal(s.createTask({ title: 'C', sortOrder: 5 }).sortOrder, 5)
})
