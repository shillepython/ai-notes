import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../store.ts'
import { buildMarkdownExport, safeFileName } from './markdown.ts'
import { SyncService } from './sync.ts'

const fresh = (): Store => new Store(':memory:')
/** Two-way sync, as two Macs do after reading each other's files. */
const exchange = (a: Store, b: Store): void => {
  const snapA = a.snapshot()
  a.mergeSnapshot(b.snapshot())
  b.mergeSnapshot(snapA)
}
const later = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

test('sync: new rows travel both ways, the newer edit wins', async () => {
  const a = fresh()
  const b = fresh()
  const topic = a.createTopic({ name: 'Работа' })
  const note = a.createNote({ title: 'Идеи', content: 'v1' })
  b.createTask({ title: 'Позвонить' })
  exchange(a, b)
  assert.equal(b.getNote(note.id)?.content, 'v1')
  assert.equal(b.getTopic(topic.id)?.name, 'Работа')
  assert.equal(a.listTasks().length, 1)

  b.updateNote(note.id, { content: 'старое с B' })
  await later()
  a.updateNote(note.id, { content: 'новое с A' })
  exchange(a, b)
  assert.equal(a.getNote(note.id)?.content, 'новое с A')
  assert.equal(b.getNote(note.id)?.content, 'новое с A')

  // Nothing new: merging again changes nothing.
  assert.equal(b.mergeSnapshot(a.snapshot()), 0)
})

test('sync: trash, restore and erase propagate; erased rows do not come back', async () => {
  const a = fresh()
  const b = fresh()
  const note = a.createNote({ title: 'Черновик' })
  exchange(a, b)

  await later()
  b.deleteNote(note.id)
  exchange(a, b)
  assert.equal(a.getNote(note.id), null)
  assert.equal(a.listTrash().length, 1)

  await later()
  a.restoreFromTrash('note', note.id)
  exchange(a, b)
  assert.ok(b.getNote(note.id))

  await later()
  b.deleteNote(note.id)
  b.deleteForever('note', note.id)
  // A still has the note in its own snapshot; it must not resurrect it on B.
  exchange(a, b)
  assert.equal(a.getNote(note.id), null)
  assert.equal(a.listTrash().length, 0)
  exchange(a, b)
  assert.equal(b.listTrash().length, 0)
})

test('sync: topics with the same name made on two Macs stay unique', () => {
  const a = fresh()
  const b = fresh()
  a.createTopic({ name: 'Дом' })
  b.createTopic({ name: 'дом' })
  exchange(a, b)
  for (const s of [a, b]) {
    const names = s.listTopics().map((t) => t.name.toLocaleLowerCase())
    assert.equal(names.length, 2)
    assert.equal(new Set(names).size, 2)
  }
})

test('sync: emits changes so the window refreshes', () => {
  const a = fresh()
  const b = fresh()
  a.createNote({ title: 'x' })
  const changes: unknown[] = []
  b.on('changed', (c) => changes.push(c))
  b.mergeSnapshot(a.snapshot())
  assert.deepEqual(changes, [{ entity: 'note', action: 'created', id: a.listNotes()[0].id }])
})

test('sync service: each Mac writes its own file in the shared folder and reads the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-notes-sync-'))
  const mac = (name: string): { store: Store; sync: SyncService } => {
    const store = new Store(':memory:')
    const settings = join(dir, `${name}.json`)
    writeFileSync(settings, JSON.stringify({ enabled: true, folder: join(dir, 'icloud') }))
    return { store, sync: new SyncService(store, settings, () => {}) }
  }
  const a = mac('a')
  const b = mac('b')
  try {
    a.store.createNote({ title: 'с первого Mac' })
    a.sync.syncNow()
    assert.equal(b.sync.syncNow().lastError, null)
    assert.deepEqual(b.store.listNotes().map((n) => n.title), ['с первого Mac'])
    a.sync.syncNow()
    assert.equal(readdirSync(join(dir, 'icloud', 'devices')).length, 2)
    assert.equal(a.sync.status().devices.length, 1)
  } finally {
    a.sync.dispose()
    b.sync.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('backup: writes a consistent copy that opens as a database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-notes-'))
  try {
    const s = new Store(join(dir, 'live.db'))
    s.createNote({ title: 'Сохрани меня' })
    s.backupTo(join(dir, 'copy.db'))
    const copy = new DatabaseSync(join(dir, 'copy.db'), { readOnly: true })
    assert.equal((copy.prepare('SELECT title FROM notes').get() as { title: string }).title, 'Сохрани меня')
    copy.close()
    s.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('markdown export: notes as files, tasks grouped by topic', () => {
  const s = fresh()
  const work = s.createTopic({ name: 'Работа', icon: '💼' })
  s.createNote({ title: 'План: Q4/2026', content: 'текст' })
  s.createNote({ title: 'План: Q4/2026', content: '# Свой заголовок' })
  s.createNote({ title: '', content: '' })
  const t = s.createTask({ title: 'Отчёт', topicId: work.id, dueDate: '2026-10-21', priority: 'high', description: 'строка 1\nстрока 2' })
  s.createTask({ title: 'Магазин' })
  s.completeTask(s.createTask({ title: 'Готово' }).id)
  s.deleteTask(s.createTask({ title: 'В корзине' }).id)

  const files = buildMarkdownExport({ notes: s.listNotes(), tasks: s.listTasks(), topics: s.listTopics() })
  const paths = files.map((f) => f.path).sort()
  assert.deepEqual(paths, ['Задачи.md', 'Заметки/Без названия.md', 'Заметки/План Q4 2026 (2).md', 'Заметки/План Q4 2026.md'])
  const withHeading = files.find((f) => f.content.includes('текст'))!
  assert.match(withHeading.content, /^---\ntitle: "План: Q4\/2026"\n/)
  assert.match(withHeading.content, /# План: Q4\/2026\n\nтекст/)
  assert.doesNotMatch(files.find((f) => f.content.includes('Свой заголовок'))!.content, /# План/)

  const tasks = files.find((f) => f.path === 'Задачи.md')!.content
  assert.match(tasks, /## 💼 Работа\n\n- \[ \] Отчёт — до 2026-10-21 · высокий приоритет\n  строка 1\n  строка 2/)
  assert.match(tasks, /## Без топика\n\n- \[ \] Магазин\n/)
  assert.match(tasks, /### Выполнено\n\n- \[x\] Готово — выполнена /)
  assert.doesNotMatch(tasks, /В корзине/)
  assert.equal(t.topicId, work.id)
})

test('safeFileName', () => {
  assert.equal(safeFileName('  .скрытый: a/b  '), 'скрытый a b')
  assert.equal(safeFileName('///'), 'Без названия')
})
