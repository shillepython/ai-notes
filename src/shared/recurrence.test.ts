import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeRecurrence, firstOccurrence, nextOccurrence } from './recurrence.ts'
import { checklistProgress, extractLinks, resetChecklist } from './links.ts'

test('nextOccurrence', () => {
  const past = '2000-01-01'
  // 2026-10-19 is a Monday
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-10-19', past), '2026-10-20')
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1 }, '2026-10-19', past), '2026-10-26')
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-19', past), '2026-10-21')
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '2026-10-23', past), '2026-10-26')
  assert.equal(nextOccurrence({ freq: 'weekly', interval: 2, weekdays: [1, 5] }, '2026-10-23', past), '2026-11-02')
  assert.equal(nextOccurrence({ freq: 'monthly', interval: 1 }, '2026-01-31', past), '2026-02-28')
  assert.equal(nextOccurrence({ freq: 'yearly', interval: 1 }, '2026-10-19', past), '2027-10-19')
  // Overdue: skips to after today
  assert.equal(nextOccurrence({ freq: 'daily', interval: 1 }, '2026-10-01', '2026-10-20'), '2026-10-21')
})

test('firstOccurrence and describe', () => {
  assert.equal(firstOccurrence({ freq: 'weekly', interval: 1, weekdays: [5] }, '2026-10-19'), '2026-10-23')
  assert.equal(firstOccurrence({ freq: 'weekly', interval: 1, weekdays: [1] }, '2026-10-20'), '2026-10-26')
  assert.equal(describeRecurrence({ freq: 'daily', interval: 1 }), 'каждый день')
  assert.equal(describeRecurrence({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }), 'по будням')
  assert.equal(describeRecurrence({ freq: 'weekly', interval: 1, weekdays: [5] }), 'каждую пятницу')
  assert.equal(describeRecurrence({ freq: 'monthly', interval: 3 }), 'раз в 3 месяца')
})

test('links and checklists', () => {
  assert.deepEqual(extractLinks('a [[X]] b [[ y ]] [[x]]'), ['X', 'y'])
  assert.deepEqual(checklistProgress('- [x] a\n  - [ ] b\n- c\n* [X] d'), { done: 2, total: 3 })
  assert.equal(resetChecklist('- [x] a\n- [ ] b'), '- [ ] a\n- [ ] b')
})
