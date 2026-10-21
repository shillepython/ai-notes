/** A note template. `{{date}}`, `{{weekday}}` and `{{time}}` are filled in when a note is made from it. */
export interface NoteTemplate {
  id: string
  name: string
  /** Emoji shown on the template chip */
  icon: string
  title: string
  content: string
  /** false for the built-in ones */
  custom: boolean
}

export const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: 'meeting',
    name: 'Встреча',
    icon: '🤝',
    title: 'Встреча {{date}}',
    content: [
      '**Дата:** {{date}}, {{time}}',
      '**Участники:** ',
      '',
      '## Повестка',
      '- ',
      '',
      '## Обсудили',
      '- ',
      '',
      '## Решения',
      '- ',
      '',
      '## Дальше',
      '- [ ] '
    ].join('\n'),
    custom: false
  },
  {
    id: 'journal',
    name: 'Дневник',
    icon: '📔',
    title: 'Дневник {{date}}',
    content: [
      '*{{weekday}}, {{date}}*',
      '',
      '## Как я',
      '',
      '',
      '## Что было за день',
      '- ',
      '',
      '## За что благодарен',
      '- ',
      '',
      '## Завтра хочу',
      '- [ ] '
    ].join('\n'),
    custom: false
  },
  {
    id: 'project',
    name: 'План проекта',
    icon: '🗺️',
    title: 'Проект: ',
    content: [
      '## Цель',
      '',
      '',
      '## Зачем',
      '',
      '',
      '## Результат',
      'Как пойму, что готово: ',
      '',
      '## Этапы',
      '- [ ] ',
      '- [ ] ',
      '- [ ] ',
      '',
      '## Риски и вопросы',
      '- ',
      '',
      '## Ссылки',
      '- ',
      '',
      '*Начат {{date}}*'
    ].join('\n'),
    custom: false
  }
]

const pad = (n: number): string => String(n).padStart(2, '0')

/** Replaces the `{{…}}` placeholders with local date values. */
export function fillPlaceholders(text: string, now: Date = new Date()): string {
  const date = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`
  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' })
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  return text.replace(/\{\{\s*(date|weekday|time)\s*\}\}/g, (_m, key: string) =>
    key === 'date' ? date : key === 'weekday' ? weekday : time
  )
}

/** Title and content of a new note made from a template. An empty title keeps the template's. */
export function applyTemplate(
  tpl: Pick<NoteTemplate, 'title' | 'content'>,
  opts: { title?: string; content?: string; now?: Date } = {}
): { title: string; content: string } {
  const body = fillPlaceholders(tpl.content, opts.now)
  const extra = opts.content?.trim()
  return {
    title: opts.title?.trim() || fillPlaceholders(tpl.title, opts.now).trim() || 'Без названия',
    content: extra ? `${body}\n\n${extra}` : body
  }
}

/** Finds a template by id or by name, ignoring case ("встреча", "план проекта"). */
export function findTemplate(templates: NoteTemplate[], key: string): NoteTemplate | undefined {
  const k = key.trim().toLowerCase()
  return (
    templates.find((t) => t.id === k) ??
    templates.find((t) => t.name.toLowerCase() === k) ??
    templates.find((t) => t.name.toLowerCase().startsWith(k) || k.startsWith(t.name.toLowerCase()))
  )
}
