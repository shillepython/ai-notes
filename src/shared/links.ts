// [[Wiki links]] between notes and tasks, and markdown checklists used as subtasks.

import type { Note, Task } from './types'

const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g

export const linkKey = (title: string): string => title.trim().toLocaleLowerCase()

/** Titles linked from a text with [[…]], unique, in order of appearance. */
export function extractLinks(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(LINK_RE)) {
    const title = m[1].trim()
    if (title && !seen.has(linkKey(title))) {
      seen.add(linkKey(title))
      out.push(title)
    }
  }
  return out
}

/** Whether the text links to this title (case-insensitive). */
export function linksTo(text: string, title: string): boolean {
  const key = linkKey(title)
  return key !== '' && extractLinks(text).some((t) => linkKey(t) === key)
}

/** Rewrites [[old]] to [[new]] (case-insensitive), so links survive a rename. */
export function renameLinks(text: string, oldTitle: string, newTitle: string): string {
  const key = linkKey(oldTitle)
  if (!key) return text
  return text.replace(LINK_RE, (whole, inner: string) => (linkKey(inner) === key ? `[[${newTitle.trim()}]]` : whole))
}

/** Replaces [[Title]] with `render(title)`; used to turn links into clickable HTML before markdown parsing. */
export function replaceLinks(text: string, render: (title: string) => string): string {
  return text.replace(LINK_RE, (_whole, inner: string) => render(inner.trim()))
}

export type LinkTarget = { kind: 'note'; note: Note } | { kind: 'task'; task: Task }

/** What [[title]] points to: a note with that title first, then a task. */
export function resolveLink(title: string, notes: Note[], tasks: Task[]): LinkTarget | null {
  const key = linkKey(title)
  const note = notes.find((n) => linkKey(n.title) === key)
  if (note) return { kind: 'note', note }
  const task = tasks.find((t) => linkKey(t.title) === key)
  return task ? { kind: 'task', task } : null
}

/** Notes and tasks whose text links to `title`, except the item `selfId` itself. */
export function findBacklinks(title: string, notes: Note[], tasks: Task[], selfId?: string): LinkTarget[] {
  if (!linkKey(title)) return []
  return [
    ...notes.filter((n) => n.id !== selfId && linksTo(n.content, title)).map((note): LinkTarget => ({ kind: 'note', note })),
    ...tasks.filter((t) => t.id !== selfId && linksTo(t.description, title)).map((task): LinkTarget => ({ kind: 'task', task }))
  ]
}

export const linkTargetTitle = (t: LinkTarget): string => (t.kind === 'note' ? t.note.title : t.task.title)
export const linkTargetId = (t: LinkTarget): string => (t.kind === 'note' ? t.note.id : t.task.id)

// ---- Checklists ----

export const CHECKBOX_RE = /^(\s*)[-*+] \[( |x|X)\] ?(.*)$/

export interface ChecklistItem {
  /** Line index in the text */
  line: number
  indent: number
  done: boolean
  text: string
}

export function parseChecklist(text: string): ChecklistItem[] {
  const items: ChecklistItem[] = []
  text.split('\n').forEach((l, line) => {
    const m = CHECKBOX_RE.exec(l)
    if (m) items.push({ line, indent: m[1].length, done: m[2] !== ' ', text: m[3] })
  })
  return items
}

/** Done and total checkboxes, e.g. { done: 3, total: 5 }. */
export function checklistProgress(text: string): { done: number; total: number } {
  const items = parseChecklist(text)
  return { done: items.filter((i) => i.done).length, total: items.length }
}

/** Unchecks every checkbox (for the next occurrence of a recurring task). */
export const resetChecklist = (text: string): string =>
  text
    .split('\n')
    .map((l) => l.replace(/^(\s*[-*+] )\[[xX]\]/, '$1[ ]'))
    .join('\n')

/** Splits a description into free text and its checkbox lines (kept as written). */
export function splitChecklist(text: string): { body: string; items: string[] } {
  const lines = text.split('\n')
  return {
    body: lines
      .filter((l) => !CHECKBOX_RE.test(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    items: lines.filter((l) => CHECKBOX_RE.test(l))
  }
}

/** The inverse of splitChecklist: text first, then the checkboxes. */
export const joinChecklist = (body: string, items: string[]): string =>
  [body.trimEnd(), items.join('\n')].filter(Boolean).join('\n\n')

/** The first line of a description that is not a checkbox, for one-line previews. */
export const previewLine = (text: string): string =>
  text.split('\n').find((l) => l.trim() && !CHECKBOX_RE.test(l))?.trim() ?? ''
