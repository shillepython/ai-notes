import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addRow,
  docExcerpt,
  docTitle,
  fillProgress,
  insertItemAfter,
  parseDoc,
  removeItem,
  setCell,
  setField,
  setItemChecked,
  setItemText,
  splitCheckboxes,
  toggleCheckbox,
  type Block,
  type Segment
} from './mdDoc.ts'
import { SEED_DOC_TEMPLATES } from './docTemplates.ts'

const ceo = SEED_DOC_TEMPLATES[0].content

const fields = (blocks: Block[]): Extract<Segment, { kind: 'field' }>[] =>
  blocks.flatMap((b) => (b.kind === 'paragraph' ? b.segments.filter((s) => s.kind === 'field') : [])) as Extract<Segment, { kind: 'field' }>[]
const field = (src: string, label: string) => fields(parseDoc(src)).find((f) => f.label === label)!

test('the CEO template becomes headings, fields, lists and tables', () => {
  const blocks = parseDoc(ceo)
  assert.equal(docTitle(ceo), 'Первый разговор с CEO')
  assert.ok(docExcerpt(ceo).startsWith('Заполняется на встрече'))
  const labels = fields(blocks).map((f) => f.label)
  for (const l of ['Суть одной фразой', 'Какую проблему решаем', 'Для кого', 'Сроки', 'Дата первой встречи']) assert.ok(labels.includes(l), l)
  // A label right above a list or table needs no input of its own.
  assert.equal(field(ceo, 'Обязательно в первой версии').attached, true)
  assert.equal(field(ceo, 'Конкуренты и референсы').attached, true)
  assert.equal(field(ceo, 'Для кого').attached, undefined)
  const first = blocks.find((b) => b.kind === 'table')!
  assert.equal(first.kind === 'table' && first.rows[2][1], 'CEO, CTO')
  const p = fillProgress(blocks)
  assert.ok(p.total > 30 && p.filled === 6, JSON.stringify(p))
})

test('filling a block field writes the value under its label and reads back', () => {
  let src = setField(ceo, field(ceo, 'Для кого'), 'Малый бизнес  \nи фрилансеры\n\n\nещё строка')
  assert.ok(src.includes('Для кого:\nМалый бизнес\nи фрилансеры\nещё строка\n\nБизнес-цель:'))
  assert.equal(field(src, 'Для кого').value, 'Малый бизнес\nи фрилансеры\nещё строка')
  // Typing more keeps everything else as it was, and clearing restores the template.
  src = setField(src, field(src, 'Для кого'), '')
  assert.equal(src, ceo)
})

test('a field in the middle of a paragraph keeps the line with checkboxes', () => {
  const src = setField(ceo, field(ceo, 'Суть одной фразой'), 'CRM для салонов')
  assert.ok(src.includes('[ ] доработка\nСуть одной фразой:\nCRM для салонов\n\n\n## 2.'))
})

test('inline bold fields', () => {
  const src = '**Участники:** \n**Дата:** 01.01.2026'
  const f = field(src, 'Участники')
  assert.equal(f.style, 'inline')
  assert.equal(setField(src, f, 'Аня, Петя'), '**Участники:** Аня, Петя\n**Дата:** 01.01.2026')
  assert.equal(field(src, 'Дата').value, '01.01.2026')
})

test('checkboxes anywhere in the text toggle in place', () => {
  const line = 'Тип: [ ] новый проект  [ ] фича в существующем проекте  [ ] доработка'
  const at = ceo.indexOf(line)
  const parts = splitCheckboxes(line, at)
  const boxes = parts.filter((p) => 'box' in p) as { box: number; checked: boolean }[]
  assert.equal(boxes.length, 3)
  const src = toggleCheckbox(ceo, boxes[1].box)
  assert.ok(src.includes('[ ] новый проект  [x] фича'))
  assert.equal(toggleCheckbox(src, boxes[1].box), ceo)
})

test('list items: edit, add after, remove, check', () => {
  const list = parseDoc(ceo).find((b) => b.kind === 'list')!
  assert.ok(list.kind === 'list')
  const [a, b] = list.items
  assert.equal(a.text, '')
  assert.ok(a.simple)
  let src = setItemText(ceo, a, 'Владельцы салонов')
  assert.ok(src.includes('ситуации:\n\n- Владельцы салонов\n-'))
  const list2 = parseDoc(src).find((x) => x.kind === 'list')!
  assert.ok(list2.kind === 'list')
  const added = insertItemAfter(src, list2.items[0], 'Администраторы')
  assert.ok(added.src.includes('- Владельцы салонов\n- Администраторы\n-'))
  const list3 = parseDoc(added.src).find((x) => x.kind === 'list')!
  assert.ok(list3.kind === 'list' && list3.items.length === 3)
  assert.equal(removeItem(added.src, list3.items[1]), src)
  assert.ok(b.prefix.startsWith('-'))

  const todo = '- [ ] позвонить\n- [x] купить'
  const tl = parseDoc(todo)[0]
  assert.ok(tl.kind === 'list')
  assert.equal(tl.items[0].checked, false)
  assert.equal(setItemChecked(todo, tl.items[0], true), '- [x] позвонить\n- [x] купить')
  assert.equal(insertItemAfter(todo, tl.items[1]).src, '- [ ] позвонить\n- [x] купить\n- [ ] ')
  const ol = parseDoc('1. one\n2. two')[0]
  assert.ok(ol.kind === 'list')
  assert.equal(insertItemAfter('1. one\n2. two', ol.items[1], 'three').src, '1. one\n2. two\n3. three')
})

test('table cells and rows', () => {
  const t = parseDoc(ceo).find((b) => b.kind === 'table')!
  assert.ok(t.kind === 'table')
  let src = setCell(ceo, t, 0, 1, 'CRM | салоны')
  assert.ok(src.includes('| Проект / фича | CRM \\| салоны |\n| Дата разговора | |'))
  const t2 = parseDoc(src).find((b) => b.kind === 'table')!
  assert.ok(t2.kind === 'table')
  assert.equal(t2.rows[0][1], 'CRM | салоны')
  src = addRow(src, t2)
  const t3 = parseDoc(src).find((b) => b.kind === 'table')!
  assert.ok(t3.kind === 'table' && t3.rows.length === t2.rows.length + 1)
  // The rest of the document is untouched.
  assert.ok(src.endsWith(ceo.slice(ceo.indexOf('\n\n## 1.'))))
})
