import { useEffect, useState } from 'react'
import type { NoteTemplate } from '@shared/templates'

const EVENT = 'templates:changed'

/** Built-in and user templates; refreshes after saveTemplate / removeTemplate. */
export function useTemplates(): NoteTemplate[] {
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  useEffect(() => {
    const load = (): void => void window.api.templates.list().then(setTemplates)
    load()
    window.addEventListener(EVENT, load)
    return () => window.removeEventListener(EVENT, load)
  }, [])
  return templates
}

export async function saveTemplate(input: { name: string; title?: string; content: string }): Promise<NoteTemplate> {
  const tpl = await window.api.templates.create(input)
  window.dispatchEvent(new Event(EVENT))
  return tpl
}

export async function removeTemplate(id: string): Promise<void> {
  await window.api.templates.delete(id)
  window.dispatchEvent(new Event(EVENT))
}
