import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import type { DocFile } from '@shared/docs'
import { docTitle, fillProgress, outline, parseDoc } from '@shared/mdDoc'
import { matches } from '../hotkeys'
import { shortDir } from '../docs'
import FillView, { type FillViewHandle } from './FillView'
import { Icon, Kbd } from './Icon'
import { toast } from './Toasts'
import './docs.css'

type Mode = 'fill' | 'edit' | 'read'

interface Props {
  path: string
  /** Library entry, for the name and whether it is a template */
  doc?: DocFile
  onBack: () => void
  /** After a rename or "new from this template" */
  onOpen: (path: string) => void
  onOpenNote: (id: string) => void
}

const loadMode = (): Mode => {
  try {
    const m = localStorage.getItem('ui.docMode')
    return m === 'edit' || m === 'read' ? m : 'fill'
  } catch {
    return 'fill'
  }
}

const errText = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)

/**
 * A markdown file: fill it in right in the rendered view, edit the source with a live preview
 * next to it, or just read it. Saves to the file automatically.
 */
export default function DocEditor({ path, doc, onBack, onOpen, onOpenNote }: Props): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setModeState] = useState<Mode>(loadMode)
  const [saved, setSaved] = useState(true)
  const [name, setName] = useState(doc?.name ?? path.replace(/^.*\//, '').replace(/\.[^.]+$/, ''))
  const [outlineOpen, setOutlineOpen] = useState(false)
  const dirty = useRef(false)
  const latest = useRef<string | null>(null)
  const fillRef = useRef<FillViewHandle>(null)
  const readRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const isTemplate = doc?.template ?? false

  const setMode = (m: Mode): void => {
    setModeState(m)
    try {
      localStorage.setItem('ui.docMode', m)
    } catch {
      // Not remembered.
    }
  }

  useEffect(() => {
    if (doc?.name) setName(doc.name)
  }, [doc?.name])

  const load = async (): Promise<void> => {
    try {
      const text = await window.api.docs.read(path)
      if (!dirty.current) {
        setContent(text)
        latest.current = text
      }
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }

  // Load, and pick up edits made in another app when coming back to the window.
  useEffect(() => {
    dirty.current = false
    void load()
    const onFocus = (): void => {
      if (!dirty.current) void load()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [path])

  const save = async (text: string): Promise<void> => {
    try {
      await window.api.docs.write(path, text)
      if (latest.current === text) {
        dirty.current = false
        setSaved(true)
      }
    } catch (err) {
      toast(`Не сохранилось: ${errText(err)}`)
    }
  }

  useEffect(() => {
    if (!dirty.current || content === null) return
    setSaved(false)
    const t = setTimeout(() => void save(content), 400)
    return () => clearTimeout(t)
  }, [content])

  // Leaving the document with a pending save writes it right away.
  useEffect(
    () => () => {
      if (dirty.current && latest.current !== null) void window.api.docs.write(path, latest.current)
    },
    [path]
  )

  const change = (text: string): void => {
    dirty.current = true
    latest.current = text
    setContent(text)
  }

  const blocks = useMemo(() => (content === null ? [] : parseDoc(content)), [content])
  const progress = useMemo(() => fillProgress(blocks), [blocks])
  const toc = useMemo(() => outline(blocks), [blocks])
  // Line breaks are kept (templates put answers on the line under a label) and inline [ ] boxes show as boxes.
  const readHtml = useMemo(
    () =>
      mode === 'read' && content
        ? (marked.parse(content, { async: false, breaks: true }) as string).replace(
            /\[( |x|X)\]/g,
            (_m, c: string) => `<span class="read-box${c === ' ' ? '' : ' on'}">${c === ' ' ? '' : '✓'}</span>`
          )
        : '',
    [mode, content]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (matches(e, 'mod+e')) {
        e.preventDefault()
        setMode(mode === 'edit' ? 'fill' : 'edit')
      } else if (matches(e, 'mod+s')) {
        e.preventDefault()
        if (latest.current !== null) void save(latest.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, path])

  const rename = async (): Promise<void> => {
    const next = name.trim()
    if (!next || next === doc?.name) return setName(doc?.name ?? next)
    try {
      if (dirty.current && latest.current !== null) await save(latest.current)
      const newPath = await window.api.docs.rename(path, next)
      if (newPath !== path) onOpen(newPath)
    } catch (err) {
      toast(`Не получилось переименовать: ${errText(err)}`)
    }
  }

  const download = async (): Promise<void> => {
    const res = await window.api.docs.export(latest.current ?? '', name || 'Документ')
    if (res) toast(`Сохранено: ${res.replace(/^.*\//, '')}`, { label: 'Показать', run: () => void window.api.docs.reveal(res) })
  }

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(latest.current ?? '')
    toast('Markdown скопирован')
  }

  const saveAsTemplate = async (): Promise<void> => {
    const tpl = await window.api.docs.create({ name, content: latest.current ?? '', template: true })
    toast(`Шаблон «${tpl.name}» сохранён`)
  }

  const newFromTemplate = async (): Promise<void> => {
    if (dirty.current && latest.current !== null) await save(latest.current)
    const created = await window.api.docs.create({ fromTemplate: path })
    onOpen(created.path)
    toast(`Создан документ «${created.name}»`)
  }

  const toNote = async (): Promise<void> => {
    const text = latest.current ?? ''
    const title = docTitle(text) || name
    // The top heading becomes the note title.
    const body = text.replace(/^\s*#\s+.+\n+/, '')
    const note = await window.api.notes.create({ title, content: body })
    toast(`Создана заметка «${title}»`, { label: 'Открыть', run: () => onOpenNote(note.id) })
  }

  const remove = async (): Promise<void> => {
    const res = await window.api.docs.remove(path)
    dirty.current = false
    onBack()
    toast(res === 'trashed' ? `«${name}» в Корзине macOS` : `«${name}» убран из списка, файл остался на месте`)
  }

  const jumpToEmpty = (): void => {
    if (mode !== 'fill') setMode('fill')
    requestAnimationFrame(() => {
      if (!fillRef.current?.focusNextEmpty()) toast('Всё заполнено 🎉')
    })
  }

  const goTo = (index: number, n: number): void => {
    setOutlineOpen(false)
    if (mode === 'read') readRef.current?.querySelectorAll('h1, h2, h3, h4, h5, h6')[n]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else fillRef.current?.scrollToBlock(index)
  }

  if (error)
    return (
      <div className="doc view-enter">
        <div className="empty-state">
          <div className="empty-icon">
            <Icon name="file" size={28} />
          </div>
          <div className="empty-title">Не удалось открыть файл</div>
          <div className="empty-hint">{error}</div>
          <button className="ghost-btn" style={{ marginTop: 14 }} onClick={onBack}>
            <Icon name="arrowLeft" size={13} /> К документам
          </button>
        </div>
      </div>
    )

  const pct = progress.total ? Math.round((progress.filled / progress.total) * 100) : 0

  return (
    <div className={`doc doc--${mode} view-enter`}>
      <div className="doc-toolbar">
        <button className="ghost-btn doc-back" onClick={onBack} title="Все документы">
          <Icon name="arrowLeft" size={14} /> Документы
        </button>
        <div className="segmented">
          <button className={mode === 'fill' ? 'on' : ''} onClick={() => setMode('fill')} title="Заполнять прямо в документе">
            <Icon name="wand" size={13} /> Заполнение
          </button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} title="Markdown и живой просмотр рядом (⌘E)">
            <Icon name="columns" size={13} /> Редактор
          </button>
          <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')} title="Только чтение">
            <Icon name="book" size={13} /> Чтение
          </button>
        </div>
        <span className={`save-state ${saved ? 'saved' : ''}`}>{saved ? 'Сохранено' : 'Сохраняю…'}</span>
        {toc.length > 2 && (
          <div className="doc-outline-wrap">
            <button className={`icon-btn ${outlineOpen ? 'on' : ''}`} title="Содержание" onClick={() => setOutlineOpen((v) => !v)}>
              <Icon name="list" size={15} />
            </button>
            {outlineOpen && (
              <>
                <div className="doc-menu-backdrop" onClick={() => setOutlineOpen(false)} />
                <div className="doc-outline fade-in">
                  {toc.map((h, n) => (
                    <button key={h.index} style={{ paddingLeft: 10 + (h.depth - 1) * 12 }} onClick={() => goTo(h.index, n)}>
                      {h.text}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <button className="icon-btn" title="Скачать .md" onClick={download}>
          <Icon name="download" size={15} />
        </button>
        <button className="icon-btn" title="Скопировать markdown" onClick={copy}>
          <Icon name="copy" size={15} />
        </button>
        {isTemplate ? (
          <button className="icon-btn" title="Новый документ из этого шаблона" onClick={newFromTemplate}>
            <Icon name="plus" size={15} />
          </button>
        ) : (
          <button className="icon-btn" title="Сохранить как шаблон" onClick={saveAsTemplate}>
            <Icon name="template" size={15} />
          </button>
        )}
        <button className="icon-btn" title="Создать заметку из документа" onClick={toNote}>
          <Icon name="file" size={15} />
        </button>
        <button className="icon-btn" title="Показать в Finder" onClick={() => void window.api.docs.reveal(path)}>
          <Icon name="folder" size={15} />
        </button>
        <button
          className="icon-btn danger"
          title={doc?.external ? 'Убрать из списка (файл останется)' : 'Удалить в Корзину'}
          onClick={remove}
        >
          <Icon name={doc?.external ? 'x' : 'trash'} size={15} />
        </button>
      </div>

      <div className="doc-head">
        <div className="doc-kind">
          {isTemplate ? (
            <span className="doc-badge">
              <Icon name="template" size={11} /> Шаблон
            </span>
          ) : doc?.external ? (
            <span className="doc-badge muted" title={path}>
              <Icon name="folder" size={11} /> {shortDir(path)}
            </span>
          ) : null}
          <input
            className="doc-name"
            value={name}
            spellCheck={false}
            title="Имя файла"
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setName(doc?.name ?? name)
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur())
              }
            }}
          />
          <span className="doc-ext">.md</span>
        </div>
        {mode !== 'read' && progress.total > 0 && (
          <button className={`doc-progress ${pct === 100 ? 'complete' : ''}`} onClick={jumpToEmpty} title="Перейти к следующему пустому полю">
            <span className="doc-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </span>
            Заполнено {progress.filled} из {progress.total}
            {pct < 100 && <span className="doc-progress-next">к пустому →</span>}
          </button>
        )}
      </div>

      {content === null ? (
        <div className="doc-loading" />
      ) : mode === 'read' ? (
        <div className="markdown doc-read fade-in" ref={readRef} dangerouslySetInnerHTML={{ __html: readHtml }} />
      ) : mode === 'edit' ? (
        <div className="doc-split fade-in">
          <div className="doc-source">
            <div className="doc-pane-label">
              Markdown <Kbd keys="mod+e" />
            </div>
            <textarea
              ref={sourceRef}
              value={content}
              spellCheck={false}
              placeholder="# Заголовок&#10;&#10;Поле:&#10;&#10;- [ ] пункт&#10;&#10;| Колонка | Значение |&#10;|---|---|&#10;| | |"
              onChange={(e) => change(e.target.value)}
              onKeyDown={(e) => {
                // Tab indents instead of leaving the editor.
                if (e.key !== 'Tab' || e.metaKey) return
                e.preventDefault()
                const el = e.currentTarget
                const { selectionStart: s, selectionEnd: end } = el
                const next = `${content.slice(0, s)}  ${content.slice(end)}`
                change(next)
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2))
              }}
            />
          </div>
          <div className="doc-preview">
            <div className="doc-pane-label">Просмотр · можно заполнять и здесь</div>
            <FillView ref={fillRef} src={content} onChange={change} />
          </div>
        </div>
      ) : (
        <FillView ref={fillRef} src={content} onChange={change} />
      )}
    </div>
  )
}
