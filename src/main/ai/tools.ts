import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { Store } from '../store'
import type { Note, Task, Topic } from '@shared/types'
import { trashItemId } from '../../shared/types.ts'

// Tools the assistant can call. Each one maps onto the data service in
// ../store, so every change the AI makes goes through the same code path
// (and the same 'data:changed' broadcast) as a change made by hand.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Формат даты YYYY-MM-DD')
const priority = z.enum(['low', 'medium', 'high'])
const status = z.enum(['todo', 'in_progress', 'done'])
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Формат YYYY-MM-DDTHH:mm (местное время)')
  .describe('Когда напомнить уведомлением, местное время YYYY-MM-DDTHH:mm')

// The model works in local wall-clock time; the store keeps ISO (UTC) instants.
// A date-time string without an offset is parsed by Date as local time.
const fromLocal = (value: string): string => new Date(value).toISOString()
const toLocal = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T') : null

/** What the user has open while the assistant runs. */
export interface ToolContext {
  /** The open topic: new tasks go there unless the model names a topic or passes null. */
  defaultTopicId?: string | null
}

interface ToolDef<S extends z.ZodType> {
  description: string
  schema: S
  run(store: Store, input: z.infer<S>, ctx: ToolContext): { result: unknown; summary: string }
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def
}

const topicName = z.string().min(1).describe('Название топика, например «Работа». Если такого нет, он будет создан')
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB')

const taskView = (store: Store, t: Task) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate,
  remindAt: toLocal(t.remindAt),
  reminded: t.remindedAt !== null,
  topic: t.topicId ? (store.getTopic(t.topicId)?.name ?? null) : null,
  completedAt: t.completedAt
})

const topicView = (store: Store, t: Topic) => ({
  id: t.id,
  name: t.name,
  color: t.color,
  icon: t.icon,
  openTasks: store.listTasks({ topicId: t.id, status: ['todo', 'in_progress'] }).length
})

/** Finds a topic by name, creating it when missing. Returns the topic and whether it was created. */
function ensureTopic(store: Store, name: string): { topic: Topic; created: boolean } {
  const existing = store.findTopicByName(name)
  if (existing) return { topic: existing, created: false }
  return { topic: store.createTopic({ name }), created: true }
}

function requireTopic(store: Store, id: string): Topic {
  const topic = store.getTopic(id)
  if (!topic) throw new Error(`Топик ${id} не найден. Найди его через list_topics.`)
  return topic
}

const createdTopicsNote = (names: string[]): string =>
  names.length ? `; новые топики: ${names.join(', ')}` : ''

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
      '«Напомни …» = задача с remindAt: в это время придёт уведомление macOS со звуком. ' +
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
                remindAt: localDateTime.optional(),
                priority: priority.optional(),
                topic: topicName
                  .nullable()
                  .optional()
                  .describe('Топик этой задачи, если отличается от общего; null — без топика')
              })
              .strict()
          )
          .min(1),
        topic: topicName
          .nullable()
          .optional()
          .describe('Топик для всех задач, например «Работа». Не указан — открытый топик; null — без топика')
      })
      .strict(),
    run(store, { tasks, topic }, ctx) {
      const newTopics: string[] = []
      const fallbackTopicId = ctx.defaultTopicId && store.getTopic(ctx.defaultTopicId) ? ctx.defaultTopicId : null
      const created = tasks.map(({ topic: own, remindAt, ...t }) => {
        const name = own !== undefined ? own : topic
        let topicId: string | null = name === undefined ? fallbackTopicId : null
        if (name) {
          const res = ensureTopic(store, name)
          if (res.created) newTopics.push(res.topic.name)
          topicId = res.topic.id
        }
        return store.createTask({ ...t, topicId, remindAt: remindAt ? fromLocal(remindAt) : null })
      })
      const reminders = created.filter((t) => t.remindAt).length
      return {
        result: created.map((t) => taskView(store, t)),
        summary:
          `Создано задач: ${created.length} (${created.map((t) => t.title).join(', ')})` +
          (reminders ? `; напоминаний: ${reminders}` : '') +
          createdTopicsNote(newTopics)
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
        dueTo: isoDate.optional(),
        topic: z.string().min(1).nullable().optional().describe('Только задачи этого топика; null — задачи без топика')
      })
      .strict(),
    run(store, { topic, ...query }) {
      let topicId: string | null | undefined
      if (topic === null) topicId = null
      else if (topic !== undefined) {
        const found = store.findTopicByName(topic)
        if (!found) {
          const names = store.listTopics().map((t) => t.name)
          throw new Error(`Топик «${topic}» не найден. Есть: ${names.join(', ') || 'ни одного'}`)
        }
        topicId = found.id
      }
      const tasks = store.listTasks({ ...query, topicId })
      return { result: tasks.map((t) => taskView(store, t)), summary: `Найдено задач: ${tasks.length}` }
    }
  }),

  complete_task: tool({
    description:
      'Отмечает задачу выполненной. Если пользователь рассказал, как/что сделано, передай это в comment, оно добавится в описание.',
    schema: z.object({ id: z.string(), comment: z.string().optional() }).strict(),
    run(store, { id, comment }) {
      requireTask(store, id)
      const task = store.completeTask(id, { comment })
      return { result: taskView(store, task), summary: `Закрыта задача «${task.title}»` }
    }
  }),

  reopen_task: tool({
    description: 'Возвращает выполненную задачу в работу.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      requireTask(store, id)
      const task = store.reopenTask(id)
      return { result: taskView(store, task), summary: `Задача «${task.title}» снова открыта` }
    }
  }),

  update_task: tool({
    description:
      'Меняет поля задачи: название, описание, статус, приоритет, срок, напоминание. Передавай только то, что меняется. ' +
      'Чтобы отметить выполненный шаг, передай описание целиком с этим шагом как `- [x]`.',
    schema: z
      .object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional().describe('Новое описание целиком (замена)'),
        status: status.optional(),
        priority: priority.optional(),
        dueDate: isoDate.nullable().optional().describe('null убирает срок'),
        remindAt: localDateTime.nullable().optional().describe('Новое время напоминания (местное, YYYY-MM-DDTHH:mm); null убирает'),
        topic: topicName.nullable().optional().describe('Перенести в топик (создастся, если нет); null убирает из топика')
      })
      .strict(),
    run(store, { id, topic, remindAt, ...patch }) {
      requireTask(store, id)
      const newTopics: string[] = []
      let topicId: string | null | undefined
      if (topic === null) topicId = null
      else if (topic !== undefined) {
        const res = ensureTopic(store, topic)
        if (res.created) newTopics.push(res.topic.name)
        topicId = res.topic.id
      }
      const task = store.updateTask(id, {
        ...patch,
        topicId,
        remindAt: remindAt === undefined ? undefined : remindAt && fromLocal(remindAt)
      })
      return { result: taskView(store, task), summary: `Обновлена задача «${task.title}»${createdTopicsNote(newTopics)}` }
    }
  }),

  delete_task: tool({
    description:
      'Перемещает задачу в корзину (её можно восстановить). Только когда пользователь явно просит удалить, а не закрыть.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      const task = requireTask(store, id)
      store.deleteTask(id)
      return { result: { deleted: id }, summary: `Задача «${task.title}» в корзине` }
    }
  }),

  list_topics: tool({
    description:
      'Список топиков (групп задач, например «Работа», «Дом») с числом открытых задач. ' +
      'Используй, чтобы узнать id топика или какие топики есть.',
    schema: z.object({}).strict(),
    run(store) {
      const topics = store.listTopics()
      return { result: topics.map((t) => topicView(store, t)), summary: `Топиков: ${topics.length}` }
    }
  }),

  create_topic: tool({
    description:
      'Создаёт топик (группу задач). Подбери подходящий эмодзи в icon. Для задач в новом топике ' +
      'не обязательно создавать его отдельно: create_tasks с topic сам создаст недостающий.',
    schema: z
      .object({
        name: z.string().min(1),
        icon: z.string().optional().describe('Один эмодзи'),
        color: hexColor.optional()
      })
      .strict(),
    run(store, input) {
      const existing = store.findTopicByName(input.name)
      if (existing) return { result: topicView(store, existing), summary: `Топик «${existing.name}» уже есть` }
      const topic = store.createTopic(input)
      return { result: topicView(store, topic), summary: `Создан топик «${topic.name}»` }
    }
  }),

  update_topic: tool({
    description: 'Переименовывает топик или меняет его эмодзи и цвет.',
    schema: z
      .object({
        id: z.string(),
        name: z.string().min(1).optional(),
        icon: z.string().optional(),
        color: hexColor.optional()
      })
      .strict(),
    run(store, { id, ...patch }) {
      requireTopic(store, id)
      const topic = store.updateTopic(id, patch)
      return { result: topicView(store, topic), summary: `Обновлён топик «${topic.name}»` }
    }
  }),

  delete_topic: tool({
    description:
      'Перемещает топик в корзину. Задачи из него не удаляются, а остаются без топика, пока топик не восстановят. ' +
      'Только по явной просьбе.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      const topic = requireTopic(store, id)
      store.deleteTopic(id)
      return { result: { deleted: id }, summary: `Топик «${topic.name}» в корзине` }
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
    description: 'Перемещает заметку в корзину (её можно восстановить). Только по явной просьбе пользователя.',
    schema: z.object({ id: z.string() }).strict(),
    run(store, { id }) {
      const note = requireNote(store, id)
      store.deleteNote(id)
      return { result: { deleted: id }, summary: `Заметка «${note.title}» в корзине` }
    }
  }),

  list_trash: tool({
    description:
      'Содержимое корзины: удалённые задачи, заметки и топики. Используй, когда просят вернуть удалённое ' +
      'или спрашивают, что в корзине.',
    schema: z.object({}).strict(),
    run(store) {
      const items = store.listTrash().map((item) => ({
        kind: item.kind,
        id: trashItemId(item),
        title: item.kind === 'note' ? item.note.title : item.kind === 'task' ? item.task.title : item.topic.name,
        deletedAt: toLocal(item.deletedAt)
      }))
      return { result: items, summary: `В корзине: ${items.length}` }
    }
  }),

  restore_from_trash: tool({
    description: 'Возвращает задачу, заметку или топик из корзины. id и kind бери из list_trash.',
    schema: z.object({ kind: z.enum(['note', 'task', 'topic']), id: z.string() }).strict(),
    run(store, { kind, id }) {
      const item = store.listTrash().find((i) => i.kind === kind && trashItemId(i) === id)
      if (!item) throw new Error(`В корзине нет ${kind} ${id}. Посмотри list_trash.`)
      store.restoreFromTrash(kind, id)
      const title = item.kind === 'note' ? item.note.title : item.kind === 'task' ? item.task.title : item.topic.name
      return { result: { restored: id }, summary: `Восстановлено из корзины: «${title}»` }
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
        result: { notes: notes.map((n) => noteView(n)), tasks: tasks.map((t) => taskView(store, t)) },
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

export function executeTool(store: Store, name: string, input: unknown, ctx: ToolContext = {}): ToolOutcome {
  const def = TOOLS[name as ToolName] as ToolDef<z.ZodType> | undefined
  if (!def) return { content: `Неизвестный инструмент ${name}`, isError: true, summary: `Неизвестный инструмент ${name}` }

  const parsed = def.schema.safeParse(input)
  if (!parsed.success) {
    const msg = `Неверные параметры: ${z.prettifyError(parsed.error)}`
    return { content: msg, isError: true, summary: `${name}: неверные параметры` }
  }
  try {
    const { result, summary } = def.run(store, parsed.data, ctx)
    return { content: JSON.stringify(result), isError: false, summary }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: msg, isError: true, summary: `${name}: ${msg}` }
  }
}
