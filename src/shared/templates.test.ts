import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_TEMPLATES, applyTemplate, fillPlaceholders, findTemplate } from './templates.ts'

const now = new Date('2026-10-21T09:05:00')

test('placeholders are filled with local date, weekday and time', () => {
  assert.equal(fillPlaceholders('{{date}} {{ time }} {{weekday}}', now), '21.10.2026 09:05 среда')
})

test('applyTemplate keeps a given title and appends extra content', () => {
  const meeting = findTemplate(BUILTIN_TEMPLATES, 'встреча')!
  const plain = applyTemplate(meeting, { now })
  assert.equal(plain.title, 'Встреча 21.10.2026')
  assert.match(plain.content, /## Решения/)
  const custom = applyTemplate(meeting, { title: 'Созвон с Пашей', content: 'Обсудили бюджет', now })
  assert.equal(custom.title, 'Созвон с Пашей')
  assert.match(custom.content, /Обсудили бюджет$/)
})

test('templates are found by id, name or a name prefix', () => {
  assert.equal(findTemplate(BUILTIN_TEMPLATES, 'journal')?.name, 'Дневник')
  assert.equal(findTemplate(BUILTIN_TEMPLATES, 'План проекта')?.id, 'project')
  assert.equal(findTemplate(BUILTIN_TEMPLATES, 'план')?.id, 'project')
  assert.equal(findTemplate(BUILTIN_TEMPLATES, 'рецепт'), undefined)
})
