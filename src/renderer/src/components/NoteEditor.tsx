import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type { Note } from '@shared/types'
import { matches } from '../hotkeys'
import { Icon, Kbd } from './Icon'
import { autosize } from './TaskBoard'
import { toast } from './Toasts'

interface Props {
  note: Note
  onDeleted: () => void
  onRestored: (id: string) => void
}

/** Title + markdown body with Edit/Preview toggle (⌘E). Saves automatically (debounced). */
export default function NoteEditor({ note, onDeleted, onRestored }: Props): React.JSX.Element {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [preview, setPreview] = useState(note.content.length > 0)
  const [saved, setSaved] = useState(true)
  const dirty = useRef(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Pick up external edits (e.g. made by the assistant) when there are no unsaved local changes.
  useEffect(() => {
    if (!dirty.current) {
      setTitle(note.title)
      setContent(note.content)
    }
  }, [note.title, note.content])

  useEffect(() => {
    if (!dirty.current) return
    setSaved(false)
    const t = setTimeout(async () => {
      await window.api.notes.update(note.id, { title, content })
      dirty.current = false
      setSaved(true)
    }, 400)
    return () => clearTimeout(t)
  }, [title, content, note.id])

  useEffect(() => autosize(bodyRef.current), [content, preview])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (matches(e, 'mod+e')) {
        e.preventDefault()
        setPreview((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const html = useMemo(() => marked.parse(content, { async: false }) as string, [content])

  const remove = async (): Promise<void> => {
    await window.api.notes.delete(note.id)
    onDeleted()
    toast(`Заметка «${title || 'Без названия'}» удалена`, {
      label: 'Отменить',
      run: async () => {
        const restored = await window.api.notes.create({ title, content })
        onRestored(restored.id)
      }
    })
  }

  const edit = (patch: { title?: string; content?: string }): void => {
    dirty.current = true
    if (patch.title !== undefined) setTitle(patch.title)
    if (patch.content !== undefined) setContent(patch.content)
  }

  return (
    <div className="note view-enter">
      <div className="toolbar">
        <div className="segmented">
          <button className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>
            <Icon name="pencil" size={13} /> Редактор
          </button>
          <button className={preview ? 'on' : ''} onClick={() => setPreview(true)}>
            <Icon name="eye" size={13} /> Просмотр
          </button>
        </div>
        <Kbd keys="mod+e" />
        <span className={`save-state ${saved ? 'saved' : ''}`}>
          {saved
            ? `Сохранено · ${new Date(note.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : 'Сохраняю…'}
        </span>
        <button className="icon-btn danger" title="Удалить заметку" onClick={remove}>
          <Icon name="trash" size={15} />
        </button>
      </div>
      <input
        className="note-title"
        value={title}
        autoFocus={!note.title && !note.content}
        placeholder="Без названия"
        onChange={(e) => edit({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            setPreview(false)
            requestAnimationFrame(() => bodyRef.current?.focus())
          }
        }}
      />
      {preview ? (
        <div
          className="markdown fade-in"
          onDoubleClick={() => setPreview(false)}
          title="Двойной клик — редактировать"
          dangerouslySetInnerHTML={{ __html: html || '<p class="muted">Пусто. Двойной клик, чтобы начать писать.</p>' }}
        />
      ) : (
        <textarea
          ref={bodyRef}
          className="note-body fade-in"
          value={content}
          autoFocus={note.title !== '' && note.title !== 'Без названия'}
          placeholder="Пиши в markdown: # заголовок, - список, **жирный**…"
          onChange={(e) => edit({ content: e.target.value })}
        />
      )}
    </div>
  )
}
