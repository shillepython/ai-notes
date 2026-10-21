import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../store.ts'
import { executeTool, runTool, toolDefinitions } from './tools.ts'

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

test('create_tasks files into the open topic unless another topic or null is given', () => {
  const s = fresh()
  const work = s.createTopic({ name: 'Работа' })
  const ctx = { defaultTopicId: work.id }
  executeTool(s, 'create_tasks', { tasks: [{ title: 'Отчёт' }] }, ctx)
  executeTool(s, 'create_tasks', { topic: 'Дом', tasks: [{ title: 'Хлеб' }] }, ctx)
  executeTool(s, 'create_tasks', { tasks: [{ title: 'Без топика', topic: null }] }, ctx)
  executeTool(s, 'create_tasks', { tasks: [{ title: 'Вне топика' }] })

  const topicOf = (title: string): string | undefined => {
    const t = s.listTasks({ query: title })[0]
    return t.topicId ? s.getTopic(t.topicId)!.name : undefined
  }
  assert.equal(topicOf('Отчёт'), 'Работа')
  assert.equal(topicOf('Хлеб'), 'Дом')
  assert.equal(topicOf('Без топика'), undefined)
  assert.equal(topicOf('Вне топика'), undefined)

  // A deleted open topic must not break task creation.
  s.deleteTopic(work.id)
  assert.equal(executeTool(s, 'create_tasks', { tasks: [{ title: 'После удаления' }] }, ctx).isError, false)
})

test('delete tools move to the trash and restore_from_trash brings items back', () => {
  const s = fresh()
  const note = s.createNote({ title: 'Рецепт' })
  assert.equal(executeTool(s, 'delete_note', { id: note.id }).isError, false)
  const trash = JSON.parse(executeTool(s, 'list_trash', {}).content)
  assert.deepEqual(trash.map((i: { kind: string; id: string }) => [i.kind, i.id]), [['note', note.id]])
  assert.equal(executeTool(s, 'restore_from_trash', { kind: 'note', id: note.id }).isError, false)
  assert.equal(s.getNote(note.id)!.title, 'Рецепт')
  assert.equal(executeTool(s, 'restore_from_trash', { kind: 'note', id: note.id }).isError, true)
})

test('create_note with a template lays the note out in its sections', () => {
  const s = fresh()
  const empty = executeTool(s, 'create_note', { template: 'Встреча' })
  assert.equal(empty.isError, false)
  const [note] = s.listNotes()
  assert.match(note.title, /^Встреча \d{2}\.\d{2}\.\d{4}$/)
  assert.match(note.content, /## Повестка/)

  executeTool(s, 'create_note', { title: 'Итоги созвона', template: 'встреча', content: 'Решили запускаться в ноябре' })
  const withText = s.listNotes({ query: 'Итоги созвона' })[0]
  assert.match(withText.content, /## Решения[\s\S]*Решили запускаться в ноябре/)

  executeTool(s, 'create_note', { template: 'Дневник', content: '## Как я\nОтлично' })
  assert.equal(s.listNotes({ query: 'Отлично' })[0].content, '## Как я\nОтлично')

  const missing = executeTool(s, 'create_note', { template: 'Рецепт' })
  assert.equal(missing.isError, true)
  assert.match(missing.content, /План проекта/)
  assert.equal(executeTool(s, 'create_note', {}).isError, true)
})

test('recurring task by tool: repeat, complete returns the next occurrence; get_links finds backlinks', () => {
  const s = fresh()
  const res = executeTool(s, 'create_tasks', {
    tasks: [{ title: 'Отчёт', description: '- [x] собрать\n- [ ] отправить\nсм. [[Шаблон отчёта]]', repeat: { every: 'week', weekdays: ['fri'] } }]
  })
  assert.equal(res.isError, false)
  const [task] = JSON.parse(res.content)
  assert.equal(task.repeat, 'каждую пятницу')
  assert.equal(task.subtasks, '1/2')
  assert.deepEqual(task.links, ['Шаблон отчёта'])

  const done = JSON.parse(executeTool(s, 'complete_task', { id: task.id }).content)
  assert.equal(done.next.repeat, 'каждую пятницу')
  assert.equal(done.next.subtasks, '0/2')

  const note = s.createNote({ title: 'Шаблон отчёта' })
  const links = JSON.parse(executeTool(s, 'get_links', { kind: 'note', id: note.id }).content)
  assert.equal(links.backlinks.length, 2)
  const own = JSON.parse(executeTool(s, 'get_links', { kind: 'task', id: done.next.id }).content)
  assert.equal(own.links[0].id, note.id)

  executeTool(s, 'update_task', { id: done.next.id, repeat: null })
  assert.equal(s.getTask(done.next.id)!.recurrence, null)
})

test('search adds meaning matches the word search missed; digest tools answer', async () => {
  const s = fresh()
  const tokens = s.createNote({ title: 'SOL и TON', content: 'комиссии' })
  const exact = s.createNote({ title: 'Токены', content: '' })
  const semanticSearch = async () => [
    { kind: 'note' as const, id: exact.id, title: 'Токены', snippet: '', score: 0.9 },
    { kind: 'note' as const, id: tokens.id, title: 'SOL и TON', snippet: 'комиссии', score: 0.88 }
  ]
  const res = await runTool(s, 'search', { query: 'токены' }, { semanticSearch })
  const body = JSON.parse(res.content)
  assert.equal(body.notes.length, 1)
  assert.deepEqual(body.byMeaning.map((h: { id: string }) => h.id), [tokens.id])
  assert.match(res.summary, /по смыслу ещё 1/)

  // A failing model falls back to the word search.
  const fallback = await runTool(s, 'search', { query: 'токены' }, { semanticSearch: () => Promise.reject(new Error('offline')) })
  assert.equal(fallback.isError, false)

  s.createTask({ title: 'Сегодня', dueDate: new Date().toLocaleDateString('sv-SE') })
  assert.equal(JSON.parse(executeTool(s, 'get_briefing', {}).content).today.length, 1)
  assert.equal(executeTool(s, 'get_weekly_review', {}).isError, false)

  let settings = { dailyEnabled: true, dailyTime: '09:00', weeklyEnabled: true, weeklyTime: '18:00' }
  const digestSettings = { get: () => settings, update: (p: Partial<typeof settings>) => (settings = { ...settings, ...p }) }
  const set = executeTool(s, 'digest_settings', { dailyTime: '08:30' }, { digestSettings })
  assert.match(set.summary, /брифинг в 08:30/)
  assert.equal(executeTool(s, 'digest_settings', { dailyTime: '8 утра' }, { digestSettings }).isError, true)
})
