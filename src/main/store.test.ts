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

test('reminders: due ones fire once, changing the time re-arms, done tasks are skipped', () => {
  const s = fresh()
  const a = s.createTask({ title: 'Позвонить маме', remindAt: '2026-10-21T15:00:00.000Z' })
  const b = s.createTask({ title: 'Выпить таблетку', remindAt: '2026-10-21T12:00:00+03:00' })
  s.createTask({ title: 'Без напоминания' })
  assert.equal(b.remindAt, '2026-10-21T09:00:00.000Z')
  assert.equal(s.nextReminderAt(), b.remindAt)

  assert.deepEqual(s.dueReminders(new Date('2026-10-21T10:00:00Z')).map((t) => t.title), ['Выпить таблетку'])
  s.markReminded(b.id)
  assert.ok(s.getTask(b.id)!.remindedAt)
  assert.equal(s.dueReminders(new Date('2026-10-21T10:00:00Z')).length, 0)
  assert.equal(s.nextReminderAt(), a.remindAt)

  // Other edits keep it marked; a new time re-arms it.
  s.updateTask(b.id, { title: 'Выпить таблетки' })
  assert.ok(s.getTask(b.id)!.remindedAt)
  s.updateTask(b.id, { remindAt: '2026-10-22T09:00:00.000Z' })
  assert.equal(s.getTask(b.id)!.remindedAt, null)

  s.completeTask(a.id)
  assert.equal(s.dueReminders(new Date('2026-10-23T00:00:00Z')).length, 1)
  assert.throws(() => s.updateTask(a.id, { remindAt: 'завтра' }))
})

test('trash: deleting moves to the trash, restore brings it back, delete forever erases', () => {
  const s = fresh()
  const note = s.createNote({ title: 'Идеи' })
  const task = s.createTask({ title: 'Позвонить' })
  assert.equal(s.deleteNote(note.id), true)
  assert.equal(s.deleteTask(task.id), true)
  assert.equal(s.getNote(note.id), null)
  assert.equal(s.listTasks().length, 0)
  assert.deepEqual(s.listTrash().map((i) => i.kind).sort(), ['note', 'task'])

  assert.equal(s.restoreFromTrash('task', task.id), true)
  assert.equal(s.getTask(task.id)!.title, 'Позвонить')
  assert.equal(s.deleteForever('note', note.id), true)
  assert.equal(s.listTrash().length, 0)
  assert.equal(s.restoreFromTrash('note', note.id), false)
  // Only trashed items can be erased.
  assert.equal(s.deleteForever('task', task.id), false)
})

test('trash: a trashed topic hides from its tasks and gives them back on restore', () => {
  const s = fresh()
  const topic = s.createTopic({ name: 'Работа' })
  const task = s.createTask({ title: 'Отчёт', topicId: topic.id })
  s.deleteTopic(topic.id)
  assert.equal(s.getTask(task.id)!.topicId, null)
  assert.equal(s.listTasks({ topicId: null }).length, 1)
  const [item] = s.listTrash()
  assert.equal(item.kind === 'topic' && item.taskCount, 1)

  // The name was reused meanwhile, so the restored topic gets a suffix.
  s.createTopic({ name: 'Работа' })
  s.restoreFromTrash('topic', topic.id)
  assert.equal(s.getTask(task.id)!.topicId, topic.id)
  assert.equal(s.getTopic(topic.id)!.name, 'Работа (2)')

  s.deleteTopic(topic.id)
  assert.equal(s.emptyTrash(), 1)
  assert.equal(s.getTask(task.id)!.topicId, null)
})
