import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Store } from '../store'
import type { Note, Task } from '@shared/types'

// Tools the assistant can call. Each one maps onto the data service in
// ../store, so every change the AI makes goes through the same code path
// (and the same 'data:changed' broadcast) as a change made by hand.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты YYYY-MM-DD')
const priority = z.enum(['low', 'medium', 'high'])
const status = z.enum(['todo', 'in_progress', 'done'])

interface ToolDef<S extends z.ZodType> {
  description: string
  schema: S
  run(store: Store, input: z.infer<S>): { result: unknown; summary: string }
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def
}

const taskView = (t: Task) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate,
  completedAt: t.completedAt
})

const noteView = (n: Note, full = false) => ({
  id: n.id,
  title: n.title,
  updatedAt: n.updatedAt,
  ...(full ? { content: n.content } : { preview: n.content.slice(0, 200) })
})

function requireTask(store: Store, id: string): Task {
  const task = store.getTask(id)
  if (!task) throw new Error(`Задача ${id} не найдена. Найди её через list_tasks или search.`)
  return task
}

function requireNote(store: Store, id: string): Note {
  const note = store.getNote(id)
  if (!note) throw new Error(`Заметка ${id} не найдена. Найди её через list_notes или search.`)
  return note
}

const TOOLS = {
  create_tasks: tool({
    description:
      'Создаёт одну или несколько задач (дел, которые потом закрывают). Только когда пользователь просит задачу, ' +
      'план, напоминание или «нужно сделать». Если он просит заметку, «запиши» или «сохрани», используй create_note. ' +
      'Независимые дела = отдельные задачи; шаги одного дела = чекбоксы `- [ ]` в description этой задачи.',
    schema: z
      .object({
        tasks: z
          .array(
            z
              .object({
                title: z.string().min(1).describe('Короткое название задачи'),
                description: z
                  .string()
                  .optional()
                  .describe('Markdown: строка контекста, затем шаги чекбоксами `- [ ] шаг`'),
                dueDate: isoDate.optional().describe('Срок в формате YYYY-MM-DD'),
                priority: priority.optional()
              })
              .strict()
          )
          .min(1)
      })
      .strict(),
    run(store, { tasks }) {
      const created = tasks.map((t) => store.createTask(t))
      return {
        result: created.map(taskView),
        summary: `Создано задач: ${created.length} (${created.map((t) => t.title).join(', ')})`
      }
    }
  }),

  list_tasks: tool({
    description:
      'Возвращает задачи с фильтрами. Используй, чтобы найти id задачи перед изменением или ответить, что запланировано.',
    schema: z
      .object({
        status: status.optional(),
        query: z.string().optional().describe('Поиск по названию и описанию'),
        dueFrom: isoDate.optional(),
        dueTo: isoDate.optional()
      })
      .strict(),
    run(store, input) {
      const tasks = store.listTasks(input)
      return { result: tasks.map(taskView), summary: `Найдено задач: ${tasks.length}` }
    }
  }),

  complete_task: tool({
    description:
      'Отмечает задачу выполненной. Если пользователь рассказал, как/что сделано, передай это в comment, оно добавится в описание.',
    schema: z.object({ id: z.string(), comment: z.string().optional() }).strict(),
    run(store, { id, comment }) {
      requireTask(store, id)
      const task = store.completeTask(id, { comment })
      return { result: taskView(task), summary: `Закрыта задача «${task.title}»` }
    }
  }),

  reopen_task: tool({
    description: 'Возвращает выполненную задачу в работу.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      requireTask(store, id)
      const task = store.reopenTask(id)
      return { result: taskView(task), summary: `Задача «${task.title}» снова открыта` }
    }
  }),

  update_task: tool({
    description:
      'Меняет поля задачи: название, описание, статус, приоритет, срок. Передавай только то, что меняется. ' +
      'Чтобы отметить выполненный шаг, передай описание целиком с этим шагом как `- [x]`.',
    schema: z
      .object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional().describe('Новое описание целиком (замена)'),
        status: status.optional(),
        priority: priority.optional(),
        dueDate: isoDate.nullable().optional().describe('null убирает срок')
      })
      .strict(),
    run(store, { id, ...patch }) {
      requireTask(store, id)
      const task = store.updateTask(id, patch)
      return { result: taskView(task), summary: `Обновлена задача «${task.title}»` }
    }
  }),

  delete_task: tool({
    description: 'Удаляет задачу навсегда. Только когда пользователь явно просит удалить, а не закрыть.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      const task = requireTask(store, id)
      store.deleteTask(id)
      return { result: { deleted: id }, summary: `Удалена задача «${task.title}»` }
    }
  }),

  create_note: tool({
    description:
      'Создаёт заметку: текст для чтения и хранения (идеи, конспект, список, мысли). Используй, когда пользователь ' +
      'говорит «заметка», «запиши», «сохрани», даже если внутри есть пункты или дела. ' +
      'content в Markdown: чекбоксы `- [ ]` для дел и шагов, `- ` для простого перечисления, `1.` для порядка.',
    schema: z.object({ title: z.string().min(1), content: z.string().optional() }).strict(),
    run(store, input) {
      const note = store.createNote(input)
      return { result: noteView(note), summary: `Создана заметка «${note.title}»` }
    }
  }),

  get_note: tool({
    description: 'Возвращает полный текст заметки.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      const note = requireNote(store, id)
      return { result: noteView(note, true), summary: `Открыта заметка «${note.title}»` }
    }
  }),

  update_note: tool({
    description:
      'Меняет заметку. Для дописывания используй append (текст добавится в конец), ' +
      'для полной замены текста используй content. Не передавай оба сразу.',
    schema: z
      .object({
        id: z.string(),
        title: z.string().min(1).optional(),
        content: z.string().optional().describe('Новый текст целиком'),
        append: z.string().optional().describe('Текст, который нужно дописать в конец')
      })
      .strict(),
    run(store, { id, title, content, append }) {
      const current = requireNote(store, id)
      const nextContent =
        append !== undefined ? `${(content ?? current.content).trimEnd()}\n\n${append}` : content
      const note = store.updateNote(id, { title, content: nextContent })
      return { result: noteView(note), summary: `Обновлена заметка «${note.title}»` }
    }
  }),

  delete_note: tool({
    description: 'Удаляет заметку навсегда. Только по явной просьбе пользователя.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      const note = requireNote(store, id)
      store.deleteNote(id)
      return { result: { deleted: id }, summary: `Удалена заметка «${note.title}»` }
    }
  }),

  list_notes: tool({
    description: 'Список заметок (с коротким превью), опционально с поиском.',
    schema: z.object({ query: z.string().optional() }).strict(),
    run(store, input) {
      const notes = store.listNotes(input)
      return { result: notes.map((n) => noteView(n)), summary: `Найдено заметок: ${notes.length}` }
    }
  }),

  search: tool({
    description: 'Ищет по всем заметкам и задачам сразу. Удобно, когда пользователь ссылается на что-то по смыслу.',
    schema: z.object({ query: z.string().min(1) }).strict(),
    run(store, { query }) {
      const notes = store.listNotes({ query })
      const tasks = store.listTasks({ query })
      return {
        result: { notes: notes.map((n) => noteView(n)), tasks: tasks.map(taskView) },
        summary: `Поиск «${query}»: заметок ${notes.length}, задач ${tasks.length}`
      }
    }
  })
} satisfies Record<string, ToolDef<z.ZodType>>

type ToolName = keyof typeof TOOLS

export const toolDefinitions: Anthropic.Beta.BetaTool[] = Object.entries(TOOLS).map(([name, def]) => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(def.schema) as Record<string, unknown>
  return {
    name,
    description: def.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema
  }
})

export interface ToolOutcome {
  content: string
  isError: boolean
  summary: string
}

export function executeTool(store: Store, name: string, input: unknown): ToolOutcome {
  const def = TOOLS[name as ToolName] as ToolDef<z.ZodType> | undefined
  if (!def) return { content: `Неизвестный инструмент ${name}`, isError: true, summary: `Неизвестный инструмент ${name}` }

  const parsed = def.schema.safeParse(input)
  if (!parsed.success) {
    const msg = `Неверные параметры: ${z.prettifyError(parsed.error)}`
    return { content: msg, isError: true, summary: `${name}: неверные параметры` }
  }
  try {
    const { result, summary } = def.run(store, parsed.data)
    return { content: JSON.stringify(result), isError: false, summary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: msg, isError: true, summary: `${name}: ${msg}` }
  }
}
