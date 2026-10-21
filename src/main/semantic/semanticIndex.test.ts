import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../store.ts'
import { SemanticIndex, splitPassages, type Embed } from './semanticIndex.ts'

// A stand-in for the model: words are mapped to "concepts", so synonyms land close together.
const CONCEPTS: Record<string, string> = {
  токены: 'crypto', токенах: 'crypto', sol: 'crypto', ton: 'crypto', крипта: 'crypto',
  хлеб: 'food', молоко: 'food', еда: 'food',
  отпуск: 'travel', грузия: 'travel', горы: 'travel'
}
const AXES = ['crypto', 'food', 'travel', 'other']
let calls = 0
const fakeEmbed: Embed = async (texts) => {
  calls += texts.length
  return texts.map((t) => {
    const v = new Float32Array(AXES.length)
    for (const w of t.toLocaleLowerCase().split(/[^\p{L}]+/u)) if (w) v[AXES.indexOf(CONCEPTS[w] ?? 'other')] += CONCEPTS[w] ? 3 : 0.1
    const norm = Math.hypot(...v) || 1
    return v.map((x) => x / norm)
  })
}

test('finds notes and tasks by meaning and keeps the index in sync', async () => {
  const s = new Store(':memory:')
  const note = s.createNote({ title: 'Сравнение', content: 'SOL и TON: комиссии' })
  s.createNote({ title: 'Покупки', content: 'хлеб молоко' })
  const trip = s.createTask({ title: 'Отпуск', description: 'Грузия, горы' })
  const idx = new SemanticIndex(':memory:', s, fakeEmbed)

  const [hit] = await idx.search('где я писал про токены')
  assert.equal(hit.id, note.id)
  assert.equal(hit.kind, 'note')
  assert.equal((await idx.search('еда'))[0].title, 'Покупки')
  assert.equal((await idx.search('хочу в горы'))[0].id, trip.id)

  // Unchanged items are not embedded again.
  const before = calls
  await idx.sync()
  assert.equal(calls, before)

  s.updateNote(note.id, { content: 'хлеб' })
  assert.equal((await idx.search('крипта', { minScore: 0.5 })).length, 0)
  s.deleteTask(trip.id)
  assert.equal((await idx.search('отпуск')).some((h) => h.id === trip.id), false)
})

test('long text is split into passages that each carry the title', () => {
  const body = Array.from({ length: 12 }, (_, i) => `Абзац ${i} ` + 'слово '.repeat(20)).join('\n\n')
  const parts = splitPassages('Заголовок', body)
  assert.ok(parts.length > 1)
  for (const p of parts) {
    assert.ok(p.startsWith('Заголовок\n'))
    assert.ok(p.length <= 720)
  }
  assert.deepEqual(splitPassages('Пусто', ''), ['Пусто'])
})
