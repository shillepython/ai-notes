import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codePromptRequest, systemPrompt, viewLine } from './prompts.ts'
import { toolDefinitions } from './tools.ts'

const describe = (name: string): string => toolDefinitions.find((t) => t.name === name)!.description!

test('system prompt separates notes from tasks and defaults to a note', () => {
  const p = systemPrompt(new Date('2026-10-21T10:00:00'))
  assert.match(p, /Заметка \(create_note\)/)
  assert.match(p, /Задача \(create_tasks\)/)
  assert.match(p, /по умолчанию создавай заметку/)
  assert.match(p, /Сегодня 2026-10-21/)
})

test('system prompt explains when to use checkboxes, bullets and numbers', () => {
  const p = systemPrompt()
  assert.match(p, /- \[ \] шаг/)
  assert.match(p, /обычный список/)
  assert.match(p, /нумерованный список/)
})

test('tool descriptions point note requests away from create_tasks', () => {
  assert.match(describe('create_tasks'), /create_note/)
  assert.match(describe('create_note'), /«заметка»/)
})

test('code prompt request carries the task and its steps', () => {
  const req = codePromptRequest({
    title: 'Экспорт заметок в PDF',
    description: 'Нужно для печати\n\n- [x] Выбрать библиотеку\n- [ ] Кнопка в тулбаре',
    dueDate: '2026-10-25',
    priority: 'high'
  })
  assert.match(req, /Задача: Экспорт заметок в PDF/)
  assert.match(req, /Срок: 2026-10-25/)
  assert.match(req, /- \[ \] Кнопка в тулбаре/)
  assert.doesNotMatch(codePromptRequest({ title: 'x', description: '', dueDate: null, priority: 'low' }), /Срок/)
})

test('viewLine names the open topic or note', () => {
  assert.equal(viewLine({}), '')
  assert.equal(viewLine({ topic: 'Работа' }), ' [Открыт топик «Работа»]')
  assert.match(viewLine({ note: { id: 'n1', title: '' } }), /Без названия.*n1/)
})
