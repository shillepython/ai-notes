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

test('create_tasks with a topic name creates the topic once and files tasks into it', () => {
  const s = fresh()
  const res = executeTool(s, 'create_tasks', {
    topic: 'Работа',
    tasks: [{ title: 'Отчёт' }, { title: 'Созвон' }, { title: 'Купить хлеб', topic: 'Дом' }]
  })
  assert.equal(res.isError, false)
  assert.match(res.summary, /новые топики: Работа, Дом/)
  assert.equal(s.listTopics().length, 2)

  const work = JSON.parse(executeTool(s, 'list_tasks', { topic: 'работа' }).content)
  assert.equal(work.length, 2)
  assert.equal(work[0].topic, 'Работа')
  assert.equal(executeTool(s, 'list_tasks', { topic: 'Нет такого' }).isError, true)

  // A second mention reuses the existing topic regardless of case.
  executeTool(s, 'create_tasks', { topic: 'работа', tasks: [{ title: 'Ревью' }] })
  assert.equal(s.listTopics().length, 2)

  const bread = s.listTasks({ query: 'хлеб' })[0]
  executeTool(s, 'update_task', { id: bread.id, topic: null })
  assert.equal(s.getTask(bread.id)!.topicId, null)

  const topics = JSON.parse(executeTool(s, 'list_topics', {}).content)
  assert.deepEqual(
    topics.map((t: { name: string; openTasks: number }) => [t.name, t.openTasks]),
    [['Дом', 0], ['Работа', 3]]
  )
  assert.equal(executeTool(s, 'delete_topic', { id: topics[1].id }).isError, false)
  assert.equal(s.listTasks().length, 4)
})

test('reminders: local times round-trip and update_task moves or clears them', () => {
  const s = fresh()
  const res = executeTool(s, 'create_tasks', {
    tasks: [{ title: 'Позвонить маме', remindAt: '2026-10-21T18:00', dueDate: '2026-10-21' }]
  })
  assert.equal(res.isError, false)
  assert.match(res.summary, /напоминаний: 1/)
  const [view] = JSON.parse(res.content)
  assert.equal(view.remindAt, '2026-10-21T18:00')
  assert.equal(s.getTask(view.id)!.remindAt, new Date('2026-10-21T18:00').toISOString())

  const moved = JSON.parse(executeTool(s, 'update_task', { id: view.id, remindAt: '2026-10-22T09:30' }).content)
  assert.equal(moved.remindAt, '2026-10-22T09:30')
  executeTool(s, 'update_task', { id: view.id, remindAt: null })
  assert.equal(s.getTask(view.id)!.remindAt, null)
  assert.equal(executeTool(s, 'create_tasks', { tasks: [{ title: 'x', remindAt: 'в 18:00' }] }).isError, true)
})
