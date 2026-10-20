import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type { Note } from '@shared/types'

interface Props {
  note: Note
  onDeleted: () => void
}

/** Title + markdown body with Edit/Preview toggle. Saves automatically (debounced). */
export default function NoteEditor({ note, onDeleted }: Props): React.JSX.Element {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [preview, setPreview] = useState(note.content.length > 0)
  const dirty = useRef(false)

  // Pick up external edits (e.g. made by the assistant) when there are no unsaved local changes.
  useEffect(() => {
    if (!dirty.current) {
      setTitle(note.title)
      setContent(note.content)
    }
  }, [note.title, note.content])

  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(async () => {
      await window.api.notes.update(note.id, { title, content })
      dirty.current = false
    }, 400)
    return () => clearTimeout(t)
  }, [title, content, note.id])

  const html = useMemo(() => marked.parse(content, { async: false }) as string, [content])

  const remove = async (): Promise<void> => {
    await window.api.notes.delete(note.id)
    onDeleted()
  }

  return (
    <div className="note">
      <div className="toolbar">
        <div className="segmented">
          <button className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>
            Редактор
          </button>
          <button className={preview ? 'on' : ''} onClick={() => setPreview(true)}>
            Просмотр
          </button>
        </div>
        <span className="muted small">
          Изменено {new Date(note.updatedAt).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
        <button className="danger-btn" onClick={remove}>
          Удалить
        </button>
      </div>
      <input
        className="note-title"
        value={title}
        placeholder="Без названия"
        onChange={(e) => {
          dirty.current = true
          setTitle(e.target.value)
        }}
      />
      {preview ? (
        <div className="markdown" onDoubleClick={() => setPreview(false)} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <textarea
          className="note-body"
          value={content}
          autoFocus
          placeholder="Пиши в markdown: # заголовок, - список, **жирный**…"
          onChange={(e) => {
            dirty.current = true
            setContent(e.target.value)
          }}
        />
      )}
    </div>
  )
}
