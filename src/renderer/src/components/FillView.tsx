import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import {
  addColumn,
  addRow,
  insertItemAfter,
  parseDoc,
  removeItem,
  removeRow,
  replaceRange,
  setCell,
  setField,
  setHeading,
  setItemChecked,
  setItemText,
  splitCheckboxes,
  toggleCheckbox,
  type Block,
  type ListItem,
  type Segment
} from '@shared/mdDoc'
import { autosize } from './TaskBoard'
import { Icon } from './Icon'

interface Props {
  src: string
  onChange: (src: string) => void
}

export interface FillViewHandle {
  /** Focuses the first empty field, cell or list item; false when everything is filled. */
  focusNextEmpty: () => boolean
  scrollToBlock: (index: number) => void
}

const inline = (text: string): string => marked.parseInline(text, { async: false }) as string

/**
 * The rendered document, editable where it makes sense to fill it in: fields under labels,
 * table cells, list items and `[ ]` boxes are inputs; anything else turns into its markdown
 * on click. Every change is written straight back into the markdown source.
 */
const FillView = forwardRef<FillViewHandle, Props>(function FillView({ src, onChange }, ref) {
  const blocks = useMemo(() => parseDoc(src), [src])
  const rootRef = useRef<HTMLDivElement>(null)
  /** data-fk of the input to focus after the next render (a new list item, the cell below…) */
  const focusNext = useRef<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    focusNextEmpty: () => {
      const el = rootRef.current?.querySelector<HTMLTextAreaElement>('[data-slot][data-empty="true"]')
      if (!el) return false
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.focus({ preventScroll: true })
      return true
    },
    scrollToBlock: (index) =>
      rootRef.current?.querySelector(`[data-block="${index}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }))

  useLayoutEffect(() => {
    const key = focusNext.current
    if (!key) return
    focusNext.current = null
    const el = rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-fk="${key}"]`)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  })

  const commit = (next: string, focus?: string): void => {
    if (focus) focusNext.current = focus
    if (next !== src) onChange(next)
  }

  /** Click-to-edit for text that is not a field: shows the markdown of [start, end). */
  const rawEditable = (key: string, start: number, end: number, html: string, tag: 'div' | 'span' = 'div'): React.JSX.Element => {
    if (editing === key)
      return (
        <RawEditor
          initial={src.slice(start, end)}
          onDone={(text) => {
            setEditing(null)
            if (text !== null) commit(replaceRange(src, start, end, text))
          }}
        />
      )
    const Tag = tag
    return (
      <Tag
        className="fill-raw"
        title="Нажми, чтобы изменить"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button, input, textarea')) return
          setEditing(key)
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  const renderLine = (key: string, seg: Extract<Segment, { kind: 'line' }>): React.JSX.Element => {
    if (editing === key) return rawEditable(key, seg.start, seg.end, '')
    const parts = splitCheckboxes(seg.text, seg.start)
    return (
      <span
        key={key}
        className="fill-line"
        title="Нажми, чтобы изменить"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button')) return
          setEditing(key)
        }}
      >
        {parts.map((p, i) =>
          'box' in p ? (
            <CheckBox key={i} checked={p.checked} onToggle={() => commit(toggleCheckbox(src, p.box))} />
          ) : (
            <span key={i} dangerouslySetInnerHTML={{ __html: inline(p.text) }} />
          )
        )}
      </span>
    )
  }

  const renderParagraph = (b: Extract<Block, { kind: 'paragraph' }>, bi: number): React.JSX.Element => {
    // Consecutive plain lines read as one paragraph; fields stand on their own.
    const groups: (Segment | Extract<Segment, { kind: 'line' }>[])[] = []
    for (const s of b.segments) {
      const last = groups[groups.length - 1]
      if (s.kind === 'line' && Array.isArray(last)) last.push(s)
      else groups.push(s.kind === 'line' ? [s] : s)
    }
    return (
      <div className="fill-paragraph">
        {groups.map((g, gi) => {
          if (Array.isArray(g))
            return (
              <p key={gi}>
                {g.map((s, i) => (
                  <span key={i}>
                    {i > 0 && <br />}
                    {renderLine(`b${bi}-l${b.segments.indexOf(s)}`, s)}
                  </span>
                ))}
              </p>
            )
          const f = g as Extract<Segment, { kind: 'field' }>
          const fk = `b${bi}-f${b.segments.indexOf(f)}`
          if (f.attached)
            return <div key={gi} className="fill-label attached" dangerouslySetInnerHTML={{ __html: inline(f.label) }} />
          return (
            <label key={gi} className={`fill-field ${f.style}`}>
              <span className="fill-label" dangerouslySetInnerHTML={{ __html: inline(f.label) }} />
              <Draft
                fk={fk}
                value={f.value}
                multiline={f.style === 'block'}
                placeholder={f.style === 'block' ? 'Заполнить…' : '—'}
                onChange={(v) => commit(setField(src, f, v))}
              />
            </label>
          )
        })}
      </div>
    )
  }

  const renderItem = (b: Extract<Block, { kind: 'list' }>, bi: number, item: ListItem, ii: number): React.JSX.Element => {
    if (!item.simple)
      return (
        <li key={ii} className="fill-item complex">
          {rawEditable(`b${bi}-i${ii}`, item.start, item.end, marked.parse(item.raw.slice(item.prefix.length), { async: false }) as string)}
        </li>
      )
    return (
      <li key={ii} className={`fill-item ${item.checked === null ? '' : 'task'} ${item.checked ? 'done' : ''}`}>
        {item.checked !== null && <CheckBox checked={item.checked} onToggle={() => commit(setItemChecked(src, item, !item.checked))} />}
        <Draft
          fk={`b${bi}-i${ii}`}
          value={item.text}
          placeholder="Пункт…"
          onChange={(v) => commit(setItemText(src, item, v))}
          onKeyDown={(e, draft) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              commit(insertItemAfter(src, item).src, `b${bi}-i${ii + 1}`)
            } else if (e.key === 'Backspace' && draft === '' && b.items.length > 1) {
              e.preventDefault()
              commit(removeItem(src, item), `b${bi}-i${Math.max(0, ii - 1)}`)
            }
          }}
        />
      </li>
    )
  }

  const renderTable = (t: Extract<Block, { kind: 'table' }>, bi: number): React.JSX.Element => {
    const cellInput = (row: number, col: number, value: string): React.JSX.Element => (
      <Draft
        fk={`b${bi}-r${row}-c${col}`}
        value={value}
        placeholder={row < 0 ? 'Колонка' : ''}
        slot={row >= 0}
        onChange={(v) => commit(setCell(src, t, row, col, v))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          // Enter moves along the row, then to the start of the next one, adding a row at the bottom.
          const [r, c] = col + 1 < t.header.length ? [row, col + 1] : [row + 1, 0]
          if (r < t.rows.length) rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-fk="b${bi}-r${r}-c${c}"]`)?.focus()
          else commit(addRow(src, t), `b${bi}-r${r}-c${c}`)
        }}
      />
    )
    return (
      <div className="fill-table-wrap">
        <table className="fill-table">
          <thead>
            <tr>
              {t.header.map((h, c) => (
                <th key={c} style={{ textAlign: t.align[c] ?? undefined }}>
                  {cellInput(-1, c, h)}
                </th>
              ))}
              <th className="fill-table-tool">
                <button className="icon-btn" title="Добавить колонку" onClick={() => commit(addColumn(src, t))}>
                  <Icon name="plus" size={12} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} style={{ textAlign: t.align[ci] ?? undefined }}>
                    {cellInput(ri, ci, c)}
                  </td>
                ))}
                <td className="fill-table-tool">
                  {t.rows.length > 1 && (
                    <button className="icon-btn danger" title="Удалить строку" onClick={() => commit(removeRow(src, t, ri))}>
                      <Icon name="x" size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="fill-add" onClick={() => commit(addRow(src, t), `b${bi}-r${t.rows.length}-c0`)}>
          <Icon name="plus" size={12} /> Строка
        </button>
      </div>
    )
  }

  const renderBlock = (b: Block, bi: number): React.JSX.Element => {
    switch (b.kind) {
      case 'heading': {
        const H = `h${Math.min(6, b.depth)}` as 'h1'
        return (
          <H className="fill-heading">
            <Draft fk={`b${bi}-h`} value={b.text} slot={false} placeholder="Заголовок" onChange={(v) => commit(setHeading(src, b, v))} />
          </H>
        )
      }
      case 'paragraph':
        return renderParagraph(b, bi)
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul'
        const last = b.items[b.items.length - 1]
        return (
          <div className="fill-list-wrap">
            <L className={`fill-list ${b.items.some((i) => i.checked !== null) ? 'tasks' : ''}`}>
              {b.items.map((item, ii) => renderItem(b, bi, item, ii))}
            </L>
            <button className="fill-add" onClick={() => commit(insertItemAfter(src, last).src, `b${bi}-i${b.items.length}`)}>
              <Icon name="plus" size={12} /> Пункт
            </button>
          </div>
        )
      }
      case 'table':
        return renderTable(b, bi)
      case 'raw':
        return rawEditable(`b${bi}-raw`, b.start, b.end, marked.parse(b.raw, { async: false }) as string)
    }
  }

  return (
    <div className="fill markdown" ref={rootRef}>
      {blocks.map((b, i) => (
        <div key={i} data-block={i} className={`fill-block fill-${b.kind}-block`}>
          {renderBlock(b, i)}
        </div>
      ))}
      {editing === 'append' ? (
        <RawEditor
          initial=""
          placeholder="Markdown: текст, ## заголовок, - список, | таблица |…"
          onDone={(text) => {
            setEditing(null)
            if (text?.trim()) commit(`${src.replace(/\s+$/, '')}${src.trim() ? '\n\n' : ''}${text.trim()}\n`)
          }}
        />
      ) : (
        <button className="fill-append" onClick={() => setEditing('append')}>
          <Icon name="plus" size={13} /> {blocks.length ? 'Дописать' : 'Начать писать'}
        </button>
      )}
    </div>
  )
})

export default FillView

function CheckBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`fill-check ${checked ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onToggle()
      }}
    >
      <Icon name="check" size={11} />
    </button>
  )
}

/**
 * An auto-growing input that keeps what is typed while focused (trailing spaces, a new line
 * about to be typed), writing the cleaned value to the document on every change.
 */
function Draft({
  value,
  onChange,
  onKeyDown,
  multiline = false,
  placeholder,
  fk,
  slot = true
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>, draft: string) => void
  multiline?: boolean
  placeholder?: string
  fk: string
  /** Counts toward "next empty field" */
  slot?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const el = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  useLayoutEffect(() => autosize(el.current), [draft])

  return (
    <textarea
      ref={el}
      rows={1}
      className={`fill-input ${multiline ? 'multi' : ''}`}
      data-fk={fk}
      data-slot={slot ? '' : undefined}
      data-empty={slot ? String(!draft.trim()) : undefined}
      value={draft}
      placeholder={placeholder}
      spellCheck
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        setDraft(value)
      }}
      onChange={(e) => {
        const v = multiline ? e.target.value : e.target.value.replace(/\n/g, ' ')
        setDraft(v)
        onChange(v)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur()
          return
        }
        onKeyDown?.(e, draft)
        if (e.defaultPrevented) return
        if (e.key === 'Enter' && (!multiline || e.metaKey) && !e.nativeEvent.isComposing) {
          e.preventDefault()
          focusSibling(e.currentTarget)
        }
      }}
    />
  )
}

/** Enter in a one-line field moves on to the next input, like a form. */
function focusSibling(from: HTMLElement): void {
  const all = Array.from(from.closest('.fill')?.querySelectorAll<HTMLTextAreaElement>('textarea.fill-input') ?? [])
  const next = all[all.indexOf(from as HTMLTextAreaElement) + 1]
  if (next) next.focus()
  else from.blur()
}

/** Markdown of a piece of the document; saves on blur or ⌘↵, Esc cancels. */
function RawEditor({
  initial,
  onDone,
  placeholder
}: {
  initial: string
  onDone: (text: string | null) => void
  placeholder?: string
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  const el = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  useLayoutEffect(() => autosize(el.current), [text])
  useEffect(() => {
    el.current?.focus()
    el.current?.setSelectionRange(initial.length, initial.length)
  }, [])
  const finish = (value: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <textarea
      ref={el}
      className="fill-raw-editor"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          finish(null)
        } else if (e.key === 'Enter' && e.metaKey) {
          e.preventDefault()
          finish(text)
        }
      }}
    />
  )
}
