import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { BUILTIN_TEMPLATES, type NoteTemplate } from '../shared/templates.ts'

/** User templates live in a small JSON file next to the database; the built-in ones are in code. */
let file: string | null = null
let custom: NoteTemplate[] = []

export function initTemplates(path: string): void {
  file = path
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as NoteTemplate[]
    custom = Array.isArray(raw) ? raw.map((t) => ({ ...t, custom: true })) : []
  } catch {
    custom = []
  }
}

const save = (): void => {
  if (file) writeFileSync(file, JSON.stringify(custom, null, 2))
}

export function listTemplates(): NoteTemplate[] {
  return [...BUILTIN_TEMPLATES, ...custom]
}

export function createTemplate(input: { name: string; title?: string; content: string; icon?: string }): NoteTemplate {
  const name = input.name.trim() || 'Шаблон'
  const tpl: NoteTemplate = {
    id: randomUUID(),
    name,
    icon: input.icon || '📄',
    title: input.title?.trim() ?? '',
    content: input.content,
    custom: true
  }
  custom = [...custom.filter((t) => t.name.toLowerCase() !== name.toLowerCase()), tpl]
  save()
  return tpl
}

export function deleteTemplate(id: string): boolean {
  const before = custom.length
  custom = custom.filter((t) => t.id !== id)
  if (custom.length === before) return false
  save()
  return true
}
