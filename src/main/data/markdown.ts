import type { Note, Task, Topic } from '../../shared/types'

export interface ExportFile {
  /** Relative to the export folder, '/'-separated */
  path: string
  content: string
}

const PRIORITY: Record<Task['priority'], string> = { high: 'высокий', medium: 'средний', low: 'низкий' }
const STATUS: Record<Task['status'], string> = { todo: ' ', in_progress: ' ', done: 'x' }

/** A file name that is safe on macOS and readable: no slashes or colons, not hidden, not too long. */
export function safeFileName(title: string): string {
  const name = title
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim()
  return name || 'Без названия'
}

const yamlString = (s: string): string => JSON.stringify(s)

function noteFile(note: Note): string {
  const front = ['---', `title: ${yamlString(note.title)}`, `created: ${note.createdAt}`, `updated: ${note.updatedAt}`, '---', '']
  const body = note.content.trim()
  // Notes usually start with their own heading; add one only when the title is not already there.
  const heading = note.title && !body.startsWith('#') ? `# ${note.title}\n\n` : ''
  return front.join('\n') + '\n' + heading + body + '\n'
}

function taskLine(task: Task): string {
  const meta = [
    task.status === 'in_progress' ? 'в работе' : null,
    task.dueDate ? `до ${task.dueDate}` : null,
    task.priority !== 'medium' ? `${PRIORITY[task.priority]} приоритет` : null,
    task.remindAt && task.status !== 'done' ? `напомнить ${task.remindAt}` : null,
    task.completedAt ? `выполнена ${task.completedAt.slice(0, 10)}` : null
  ].filter(Boolean)
  const head = `- [${STATUS[task.status]}] ${task.title}${meta.length ? ` — ${meta.join(' · ')}` : ''}`
  const desc = task.description.trim()
  return desc ? `${head}\n${desc.split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')}` : head
}

function tasksFile(tasks: Task[], topics: Topic[]): string {
  const groups: { title: string; tasks: Task[] }[] = [
    ...topics.map((t) => ({ title: `${t.icon ? `${t.icon} ` : ''}${t.name}`, tasks: tasks.filter((x) => x.topicId === t.id) })),
    { title: 'Без топика', tasks: tasks.filter((x) => !x.topicId || !topics.some((t) => t.id === x.topicId)) }
  ]
  const out = ['# Задачи', '']
  for (const g of groups) {
    if (!g.tasks.length) continue
    const open = g.tasks.filter((t) => t.status !== 'done')
    const done = g.tasks.filter((t) => t.status === 'done')
    out.push(`## ${g.title}`, '')
    if (open.length) out.push(...open.map(taskLine), '')
    if (done.length) out.push('### Выполнено', '', ...done.map(taskLine), '')
  }
  if (out.length === 2) out.push('Задач нет.', '')
  return out.join('\n')
}

/**
 * Turns notes and tasks (not the trash) into Markdown files: one file per note under
 * "Заметки/" with its dates in front matter, and all tasks in "Задачи.md" grouped by topic.
 */
export function buildMarkdownExport(data: { notes: Note[]; tasks: Task[]; topics: Topic[] }): ExportFile[] {
  const used = new Set<string>()
  const notes = data.notes.map((note): ExportFile => {
    const base = safeFileName(note.title)
    let name = base
    for (let n = 2; used.has(name.toLocaleLowerCase()); n++) name = `${base} (${n})`
    used.add(name.toLocaleLowerCase())
    return { path: `Заметки/${name}.md`, content: noteFile(note) }
  })
  return [...notes, { path: 'Задачи.md', content: tasksFile(data.tasks, data.topics) }]
}
