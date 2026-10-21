import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.ts'
import { briefingHeadline, buildBriefing, buildWeeklyReview, isEmptyBriefing, localDate } from './digest.ts'

const NOW = new Date('2026-10-21T08:30:00')
const day = (n: number): string => localDate(new Date(NOW.getTime() + n * 86_400_000))

test('briefing sorts open tasks into overdue, today, in progress and soon', () => {
  const s = new Store(':memory:')
  const work = s.createTopic({ name: 'Работа' })
  s.createTask({ title: 'Старое', dueDate: day(-2) })
  s.createTask({ title: 'Неважное', dueDate: day(0), priority: 'low' })
  s.createTask({ title: 'Отчёт', dueDate: day(0), priority: 'high', topicId: work.id, description: '- [x] a\n- [ ] b' })
  s.createTask({ title: 'Ремонт', status: 'in_progress' })
  s.createTask({ title: 'Послезавтра', dueDate: day(2) })
  s.createTask({ title: 'Через неделю', dueDate: day(7) })
  s.createTask({ title: 'Позвонить', dueDate: day(0), remindAt: new Date('2026-10-21T18:00:00').toISOString() })
  const done = s.createTask({ title: 'Готово', dueDate: day(0) })
  s.completeTask(done.id)

  const b = buildBriefing(s, NOW)
  assert.equal(b.date, '2026-10-21')
  assert.deepEqual(b.overdue.map((t) => t.title), ['Старое'])
  assert.deepEqual(b.today.map((t) => t.title), ['Отчёт', 'Позвонить', 'Неважное'])
  assert.equal(b.today[0].topic, 'Работа')
  assert.equal(b.today[0].steps, '1/2')
  assert.deepEqual(b.inProgress.map((t) => t.title), ['Ремонт'])
  assert.deepEqual(b.soon.map((t) => t.title), ['Послезавтра'])
  assert.deepEqual(b.reminders.map((r) => [r.title, r.time]), [['Позвонить', '18:00']])
  assert.equal(briefingHeadline(b), 'Сегодня 3 задачи · 1 просрочена · напоминание в 18:00 · в работе 1')
  assert.equal(isEmptyBriefing(b), false)
  assert.equal(isEmptyBriefing(buildBriefing(new Store(':memory:'), NOW)), true)
})

test('weekly review counts what was closed this week, by topic', () => {
  const s = new Store(':memory:')
  const home = s.createTopic({ name: 'Дом' })
  const a = s.createTask({ title: 'Купить лампу', topicId: home.id })
  const b = s.createTask({ title: 'Позвонить' })
  s.completeTask(a.id)
  s.completeTask(b.id)
  s.createTask({ title: 'Висит', dueDate: day(-1) })
  s.createTask({ title: 'Скоро', dueDate: day(3) })
  s.createNote({ title: 'Идеи' })

  const r = buildWeeklyReview(s, new Date())
  assert.deepEqual(r.completed.map((t) => t.title).sort(), ['Купить лампу', 'Позвонить'])
  assert.deepEqual(r.completedByTopic.map((t) => t.topic).sort(), ['Без топика', 'Дом'])
  assert.equal(r.createdTasks, 4)
  assert.deepEqual(r.notes.map((n) => [n.title, n.created]), [['Идеи', true]])
  assert.deepEqual(r.overdue.map((t) => t.title), ['Висит'])
  assert.deepEqual(r.nextWeek.map((t) => t.title), ['Скоро'])
  assert.deepEqual(r.stale, [])
})
