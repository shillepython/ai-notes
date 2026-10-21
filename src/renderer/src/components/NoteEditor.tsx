import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type { Attachment, Note } from '@shared/types'
import { applyTemplate, type NoteTemplate } from '@shared/templates'
import { matches } from '../hotkeys'
import { removeTemplate, saveTemplate, useTemplates } from '../templates'
import { Icon, Kbd } from './Icon'
import { autosize } from './TaskBoard'
import { toast } from './Toasts'

interface Props {
  note: Note
  onDeleted: () => void
  onRestored: (id: string) => void
}

const ATTACHMENT = 'attachment:'

/** Markdown for an attachment: images show inline, other files as a link that opens them. */
export const attachmentMarkdown = (a: Attachment): string =>
  a.isImage ? `![${a.name.replace(/[[\]]/g, '')}](${a.url})` : `[📎 ${a.name.replace(/[[\]]/g, '')}](${a.url})`

/**
 * Title + markdown body with Edit/Preview toggle (⌘E). Saves automatically (debounced).
 * Pasting or dropping files attaches them; an empty note offers templates.
 */
export default function NoteEditor({ note, onDeleted, onRestored }: Props): React.JSX.Element {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const [preview, setPreview] = useState(note.content.length > 0)
  const [saved, setSaved] = useState(true)
  const dirty = useRef(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [dragging, setDragging] = useState(false)
  const templates = useTemplates()

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
    toast(`Заметка «${title || 'Без названия'}» в корзине`, {
      label: 'Отменить',
      run: async () => {
        await window.api.trash.restore('note', note.id)
        onRestored(note.id)
      }
    })
  }

  const edit = (patch: { title?: string; content?: string }): void => {
    dirty.current = true
    if (patch.title !== undefined) setTitle(patch.title)
    if (patch.content !== undefined) setContent(patch.content)
  }

  /** Inserts attachments at the cursor in the editor, or at the end in preview. */
  const insertAttachments = (items: Attachment[]): void => {
    if (!items.length) return
    const md = items.map(attachmentMarkdown).join('\n')
    const el = bodyRef.current
    if (!preview && el) {
      const start = el.selectionStart
      const end = el.selectionEnd
      const before = content.slice(0, start)
      const after = content.slice(end)
      // Keep attachments in a paragraph of their own so they don't merge with the text around them.
      const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
      const trail = !after ? '\n' : after.startsWith('\n') ? '\n' : '\n\n'
      edit({ content: `${before}${lead}${md}${trail}${after}` })
      const caret = before.length + lead.length + md.length + trail.length
      requestAnimationFrame(() => el.setSelectionRange(caret, caret))
    } else {
      edit({ content: content.trim() ? `${content.replace(/\s+$/, '')}\n\n${md}\n` : `${md}\n` })
    }
    toast(items.length === 1 ? `Прикреплено: ${items[0].name}` : `Прикреплено файлов: ${items.length}`)
  }

  const attach = async (files: File[]): Promise<void> => {
    if (!files.length) return
    try {
      insertAttachments(await window.api.attachments.add(files))
    } catch (err) {
      toast(`Не удалось прикрепить: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const pick = async (): Promise<void> => insertAttachments(await window.api.attachments.pick())

  const pickTemplate = (tpl: NoteTemplate): void => {
    const filled = applyTemplate(tpl, { title, content })
    edit({ title: title.trim() ? title : filled.title, content: filled.content })
    setPreview(false)
    requestAnimationFrame(() => bodyRef.current?.focus())
  }

  const saveAsTemplate = async (): Promise<void> => {
    const name = title.trim() || 'Мой шаблон'
    await saveTemplate({ name, content })
    toast(`Шаблон «${name}» сохранён. Он появится в новых заметках и в ⌘K`)
  }

  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      setDragging(false)
      if (!hasFiles(e)) return
      e.preventDefault()
      void attach(Array.from(e.dataTransfer.files))
    }
  }

  // Attachment links and images open in their default app instead of navigating the window.
  const onPreviewClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement
    const link = target.closest('a')
    const url = link?.getAttribute('href') ?? (target instanceof HTMLImageElement ? target.getAttribute('src') : null)
    if (!url?.startsWith(ATTACHMENT)) return
    e.preventDefault()
    if (e.altKey) void window.api.attachments.reveal(url)
    else void window.api.attachments.open(url)
  }

  const showTemplates = !content.trim() && templates.length > 0

  return (
    <div className={`note view-enter ${dragging ? 'dropping' : ''}`} {...dropProps}>
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
        <button className="icon-btn" title="Прикрепить файл или картинку (можно вставить ⌘V или перетащить)" onClick={pick}>
          <Icon name="paperclip" size={15} />
        </button>
        <button
          className="icon-btn"
          title="Сохранить как шаблон"
          disabled={!content.trim()}
          onClick={saveAsTemplate}
        >
          <Icon name="template" size={15} />
        </button>
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
      {showTemplates && (
        <div className="template-picker fade-in">
          <span className="template-label">Начать с шаблона</span>
          <div className="chips">
            {templates.map((t) => (
              <span key={t.id} className="template-chip-wrap">
                <button className="chip" onClick={() => pickTemplate(t)}>
                  <span aria-hidden>{t.icon}</span> {t.name}
                </button>
                {t.custom && (
                  <button
                    className="template-remove"
                    title={`Удалить шаблон «${t.name}»`}
                    onClick={async () => {
                      await removeTemplate(t.id)
                      toast(`Шаблон «${t.name}» удалён`)
                    }}
                  >
                    <Icon name="x" size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      {preview ? (
        <div
          className="markdown fade-in"
          onClick={onPreviewClick}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest('a, img')) return
            setPreview(false)
          }}
          title="Двойной клик — редактировать"
          dangerouslySetInnerHTML={{ __html: html || '<p class="muted">Пусто. Двойной клик, чтобы начать писать.</p>' }}
        />
      ) : (
        <textarea
          ref={bodyRef}
          className="note-body fade-in"
          value={content}
          autoFocus={note.title !== '' && note.title !== 'Без названия'}
          placeholder="Пиши в markdown: # заголовок, - список, **жирный**… Картинки и файлы можно вставить или перетащить."
          onChange={(e) => edit({ content: e.target.value })}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (!files.length) return
            e.preventDefault()
            void attach(files)
          }}
        />
      )}
      {dragging && (
        <div className="drop-hint">
          <Icon name="paperclip" size={18} /> Отпусти, чтобы прикрепить
        </div>
      )}
    </div>
  )
}
