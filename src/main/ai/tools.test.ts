import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../store.ts'
import { executeTool, toolDefinitions } from './tools.ts'

const fresh = (): Store => new Store(':memory:')

test('tool schemas are plain JSON Schema objects', () => {
  for (const def of toolDefinitions) {
    assert.equal(def.input_schema.type, 'object')
    assert.equal('$schema' in def.input_schema, false)
  }
})

test('create_tasks then complete_task with a comment', () => {
  const s = fresh()
  const created = executeTool(s, 'create_tasks', {
    tasks: [{ title: 'Позвонить в банк', dueDate: '2026-10-21', priority: 'high' }, { title: 'Купить продукты' }]
  })
  assert.equal(created.isError, false)
  assert.equal(s.listTasks().length, 2)

  const [bank] = s.listTasks({ query: 'банк' })
  const done = executeTool(s, 'complete_task', { id: bank.id, comment: 'Договорились о новом лимите' })
  assert.equal(done.isError, false)
  const task = s.getTask(bank.id)!
  assert.equal(task.status, 'done')
  assert.match(task.description, /новом лимите/)
})

test('invalid input and unknown ids come back as tool errors', () => {
  const s = fresh()
  assert.equal(executeTool(s, 'create_tasks', { tasks: [{ title: 'x', dueDate: 'завтра' }] }).isError, true)
  assert.equal(executeTool(s, 'complete_task', { id: 'nope' }).isError, true)
  assert.equal(executeTool(s, 'no_such_tool', {}).isError, true)
})

test('update_note append keeps existing content; search spans notes and tasks', () => {
  const s = fresh()
  const note = s.createNote({ title: 'Идеи', content: 'первая' })
  executeTool(s, 'update_note', { id: note.id, append: 'вторая' })
  assert.equal(s.getNote(note.id)!.content, 'первая\n\nвторая')

  s.createTask({ title: 'Идеи для отпуска' })
  const res = JSON.parse(executeTool(s, 'search', { query: 'идеи' }).content)
  assert.equal(res.notes.length, 1)
  assert.equal(res.tasks.length, 1)
})
