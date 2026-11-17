import { useEffect, useState } from 'react'
import type { DocLibrary } from '@shared/docs'

const EMPTY: DocLibrary = { docs: [], templates: [], root: '' }

/** Documents and templates; refreshes after changes and when the window comes back into focus (files may change in Finder). */
export function useDocLibrary(): DocLibrary {
  const [lib, setLib] = useState<DocLibrary>(EMPTY)
  useEffect(() => {
    const load = (): void => void window.api.docs.list().then(setLib)
    load()
    const off = window.api.docs.onChanged(load)
    window.addEventListener('focus', load)
    return () => {
      off()
      window.removeEventListener('focus', load)
    }
  }, [])
  return lib
}

export const isMarkdownFile = (f: File): boolean => /\.(md|markdown|mdown|txt)$/i.test(f.name)

/** "5 мин назад", "вчера", "3 нояб." */
export function ago(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `сегодня в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() && { year: 'numeric' }) })
}

/** ~/Documents/… for showing where an opened file lives. */
export const shortDir = (path: string): string =>
  path.replace(/\/[^/]+$/, '').replace(/^\/Users\/[^/]+/, '~')
