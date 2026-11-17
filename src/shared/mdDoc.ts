import { marked, type Tokens } from 'marked'

/*
 * A markdown document as fillable blocks. Every block, line, field and cell keeps its
 * [start, end) offsets in the source, so filling something in the rendered view is a
 * small text replacement and the file stays plain markdown that reads well anywhere.
 */

/** A bold inline label: `**Участники:** value` */
const INLINE_FIELD = /^(\s*)\*\*([^*\n]+?):\*\*[ \t]*(.*)$/
/** A label line: `Какую проблему решаем:` (the value goes on the lines below) */
const LABEL_LINE = /^\s*([^\n]{1,160}?):\s*$/
const CHECKBOX = /\[( |x|X)\]/g
const LIST_LINE = /^(\s*(?:[-*+]|\d+[.)])(?:[ \t]+|$))(\[[ xX]\](?:[ \t]+|$))?(.*)$/

export type Segment =
  /** Ordinary text line; `[ ]` boxes in it are clickable. */
  | { kind: 'line'; start: number; end: number; text: string }
  /**
   * `inline` — `**Label:** value` on one line; `block` — `Label:` line with the value on the lines below.
   * `attached` — a block label right before a list or table, which is the field's value itself.
   */
  | { kind: 'field'; style: 'inline' | 'block'; start: number; end: number; label: string; value: string; indent: string; attached?: boolean }

export interface ListItem {
  start: number
  /** End of the item's first line (the editable text) */
  lineEnd: number
  end: number
  /** Bullet or number with the space after it, e.g. `- ` or `  2. ` */
  prefix: string
  /** null for an item without a box */
  checked: boolean | null
  text: string
  /** One line, nothing nested: edited in place. Others are edited as raw markdown. */
  simple: boolean
  raw: string
}

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { kind: 'heading'; start: number; end: number; depth: number; text: string }
  | { kind: 'paragraph'; start: number; end: number; segments: Segment[] }
  | { kind: 'list'; start: number; end: number; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; start: number; end: number; header: string[]; align: Align[]; rows: string[][] }
  /** Code, quotes, rules, html…: rendered as is, edited as raw markdown */
  | { kind: 'raw'; start: number; end: number; raw: string }

export const normalize = (src: string): string => src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')

/** Splits normalized markdown into blocks with source offsets. */
export function parseDoc(src: string): Block[] {
  const blocks: Block[] = []
  let pos = 0
  for (const token of marked.lexer(src)) {
    const start = pos
    pos += token.raw.length
    if (token.type === 'space') continue
    // Trailing newlines belong to the gap, not to the block.
    const end = start + token.raw.replace(/\s+$/, '').length
    switch (token.type) {
      case 'heading':
        blocks.push({ kind: 'heading', start, end, depth: (token as Tokens.Heading).depth, text: (token as Tokens.Heading).text })
        break
      case 'paragraph':
        blocks.push({ kind: 'paragraph', start, end, segments: parseSegments(src, start, end) })
        break
      case 'list':
        blocks.push(parseList(src, token as Tokens.List, start, end))
        break
      case 'table': {
        const t = token as Tokens.Table
        blocks.push({
          kind: 'table',
          start,
          end,
          header: t.header.map((c) => c.text),
          align: t.align as Align[],
          rows: t.rows.map((r) => r.map((c) => c.text))
        })
        break
      }
      default:
        blocks.push({ kind: 'raw', start, end, raw: src.slice(start, end) })
    }
  }
  // A label right above a list or table is answered by it, so it needs no input of its own.
  blocks.forEach((b, i) => {
    const next = blocks[i + 1]
    if (b.kind !== 'paragraph' || !next || (next.kind !== 'list' && next.kind !== 'table')) return
    const last = b.segments[b.segments.length - 1]
    if (last.kind === 'field' && last.style === 'block' && !last.value) last.attached = true
  })
  return blocks
}

function parseSegments(src: string, start: number, end: number): Segment[] {
  const lines: { start: number; end: number; text: string }[] = []
  let p = start
  for (const text of src.slice(start, end).split('\n')) {
    lines.push({ start: p, end: p + text.length, text })
    p += text.length + 1
  }
  const out: Segment[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const inline = INLINE_FIELD.exec(line.text)
    if (inline) {
      out.push({ kind: 'field', style: 'inline', start: line.start, end: line.end, indent: inline[1], label: inline[2].trim(), value: inline[3].replace(/\s+$/, '') })
      continue
    }
    const label = isLabel(line.text)
    if (label !== null) {
      // The value is every following line up to the next label.
      let j = i + 1
      while (j < lines.length && isLabel(lines[j].text) === null && !INLINE_FIELD.test(lines[j].text)) j++
      const valueLines = lines.slice(i + 1, j)
      out.push({
        kind: 'field',
        style: 'block',
        start: line.start,
        end: valueLines.length ? valueLines[valueLines.length - 1].end : line.end,
        indent: '',
        label,
        value: valueLines.map((l) => l.text.trim()).join('\n').replace(/\s+$/, '')
      })
      i = j - 1
      continue
    }
    out.push({ kind: 'line', ...line })
  }
  return out
}

function isLabel(line: string): string | null {
  if (CHECKBOX.test(line)) {
    CHECKBOX.lastIndex = 0
    return null
  }
  const m = LABEL_LINE.exec(line)
  // "http://…:" or a sentence that merely ends with a colon inside code are not labels.
  if (!m || /`/.test(m[1])) return null
  return m[1].trim()
}

function parseList(src: string, token: Tokens.List, start: number, end: number): Block {
  const items: ListItem[] = []
  let cursor = start
  for (const item of token.items) {
    const found = src.indexOf(item.raw, cursor)
    const itemStart = found >= 0 && found < end ? found : cursor
    const itemEnd = Math.min(end, itemStart + item.raw.replace(/\s+$/, '').length)
    cursor = itemStart + item.raw.length
    const body = src.slice(itemStart, itemEnd)
    // The first line runs to its line break, trailing spaces included ("- " is an empty item).
    const nl = src.indexOf('\n', itemStart)
    const firstLine = src.slice(itemStart, nl < 0 ? src.length : nl)
    const m = LIST_LINE.exec(firstLine)
    const prefix = m ? m[1] : ''
    const box = m?.[2]
    items.push({
      start: itemStart,
      lineEnd: itemStart + firstLine.length,
      end: Math.max(itemEnd, itemStart + firstLine.length),
      prefix: prefix.endsWith(' ') || prefix.endsWith('\t') ? prefix : `${prefix} `,
      checked: box ? box[1] !== ' ' : null,
      text: (m ? m[3] : firstLine).replace(/\s+$/, ''),
      simple: !!m && !body.includes('\n'),
      raw: body
    })
  }
  return { kind: 'list', start, end, ordered: token.ordered, items }
}

export const replaceRange = (src: string, start: number, end: number, text: string): string =>
  src.slice(0, start) + text + src.slice(end)

/** Writes a field's value. Blank lines would split the paragraph, so they are collapsed. */
export function setField(src: string, field: Extract<Segment, { kind: 'field' }>, value: string): string {
  const clean = value.replace(/\s+$/, '')
  if (field.style === 'inline') {
    const oneLine = clean.replace(/\s*\n\s*/g, ' ')
    return replaceRange(src, field.start, field.end, `${field.indent}**${field.label}:**${oneLine ? ` ${oneLine}` : ' '}`)
  }
  const lines = clean.replace(/\n\s*\n+/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''))
  const body = clean ? `\n${lines.join('\n')}` : ''
  return replaceRange(src, field.start, field.end, `${field.label}:${body}`)
}

/** Flips the `[ ]` / `[x]` that starts at `offset`. */
export function toggleCheckbox(src: string, offset: number): string {
  const mark = src[offset + 1]
  if (src[offset] !== '[' || src[offset + 2] !== ']' || !/[ xX]/.test(mark)) return src
  return replaceRange(src, offset + 1, offset + 2, mark === ' ' ? 'x' : ' ')
}

/** Positions of every `[ ]` box in a line, for rendering it as a clickable checkbox. */
export function splitCheckboxes(text: string, offset: number): ({ text: string } | { box: number; checked: boolean })[] {
  const out: ({ text: string } | { box: number; checked: boolean })[] = []
  let last = 0
  for (const m of text.matchAll(CHECKBOX)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ box: offset + m.index, checked: m[1] !== ' ' })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

const box = (checked: boolean | null): string => (checked === null ? '' : checked ? '[x] ' : '[ ] ')

export function setItemText(src: string, item: ListItem, text: string): string {
  return replaceRange(src, item.start, item.lineEnd, `${item.prefix}${box(item.checked)}${text.replace(/\s*\n\s*/g, ' ').replace(/\s+$/, '')}`)
}

export function setItemChecked(src: string, item: ListItem, checked: boolean): string {
  return replaceRange(src, item.start, item.lineEnd, `${item.prefix}${box(checked)}${item.text}`)
}

/** Next prefix in a list: same bullet, or the following number. */
const nextPrefix = (prefix: string): string =>
  prefix.replace(/(\d+)([.)])/, (_m, n: string, d: string) => `${Number(n) + 1}${d}`)

/** Adds an empty item after `item` (a box stays a box). Returns the new source and the new item's start. */
export function insertItemAfter(src: string, item: ListItem, text = ''): { src: string; at: number } {
  const prefix = nextPrefix(item.prefix)
  const line = `\n${prefix}${box(item.checked === null ? null : false)}${text}`
  return { src: replaceRange(src, item.end, item.end, line), at: item.end + 1 }
}

/** Removes an item with its line break. */
export function removeItem(src: string, item: ListItem): string {
  if (src[item.end] === '\n') return replaceRange(src, item.start, item.end + 1, '')
  if (item.start > 0 && src[item.start - 1] === '\n') return replaceRange(src, item.start - 1, item.end, '')
  return replaceRange(src, item.start, item.end, '')
}

const cell = (s: string): string => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
const alignRow = (a: Align): string => (a === 'center' ? ':---:' : a === 'left' ? ':---' : a === 'right' ? '---:' : '---')

export function serializeTable(header: string[], align: Align[], rows: string[][]): string {
  const width = header.length
  const row = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cell(cells[i] ?? '')).join(' | ')} |`.replace(/ {2}\|/g, ' |').replace(/\| {2}/g, '| ')
  return [row(header), `|${Array.from({ length: width }, (_, i) => alignRow(align[i] ?? null)).join('|')}|`, ...rows.map(row)].join('\n')
}

type TableBlock = Extract<Block, { kind: 'table' }>

/** Sets one cell; row -1 is the header. */
export function setCell(src: string, t: TableBlock, row: number, col: number, value: string): string {
  const header = [...t.header]
  const rows = t.rows.map((r) => [...r])
  if (row < 0) header[col] = value
  else rows[row][col] = value
  return replaceRange(src, t.start, t.end, serializeTable(header, t.align, rows))
}

export function addRow(src: string, t: TableBlock, after = t.rows.length - 1): string {
  const rows = t.rows.map((r) => [...r])
  rows.splice(after + 1, 0, t.header.map(() => ''))
  return replaceRange(src, t.start, t.end, serializeTable(t.header, t.align, rows))
}

export function removeRow(src: string, t: TableBlock, row: number): string {
  const rows = t.rows.filter((_, i) => i !== row)
  return replaceRange(src, t.start, t.end, serializeTable(t.header, t.align, rows))
}

export function addColumn(src: string, t: TableBlock): string {
  return replaceRange(src, t.start, t.end, serializeTable([...t.header, ''], [...t.align, null], t.rows.map((r) => [...r, ''])))
}

export function setHeading(src: string, h: Extract<Block, { kind: 'heading' }>, text: string): string {
  return replaceRange(src, h.start, h.end, `${'#'.repeat(h.depth)} ${text.replace(/\s*\n\s*/g, ' ').trim()}`)
}

/** How much of the template is filled in: field values, table body cells and list items. */
export function fillProgress(blocks: Block[]): { filled: number; total: number } {
  let filled = 0
  let total = 0
  const count = (v: string): void => {
    total++
    if (v.trim()) filled++
  }
  for (const b of blocks) {
    if (b.kind === 'paragraph') for (const s of b.segments) if (s.kind === 'field' && !s.attached) count(s.value)
    if (b.kind === 'list') for (const it of b.items) if (it.simple) count(it.text)
    if (b.kind === 'table') for (const r of b.rows) for (const c of r) count(c)
  }
  return { filled, total }
}

/** Headings for the outline. */
export const outline = (blocks: Block[]): { index: number; depth: number; text: string }[] =>
  blocks.flatMap((b, index) => (b.kind === 'heading' ? [{ index, depth: b.depth, text: b.text }] : []))

/** Document title: the first `# heading`, else the first line. */
export function docTitle(src: string): string {
  const h = /^#{1,2}\s+(.+?)\s*#*\s*$/m.exec(src)
  if (h) return h[1].trim()
  return src.trim().split('\n')[0]?.replace(/^[#>*\-\s]+/, '').slice(0, 80) ?? ''
}

/** First plain sentence of the body, for template cards. */
export function docExcerpt(src: string): string {
  for (const token of marked.lexer(src)) {
    if (token.type === 'paragraph') {
      const text = (token as Tokens.Paragraph).text.replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').trim()
      if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text
    }
  }
  return ''
}
