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
