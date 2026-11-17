import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { DocFile, DocLibrary } from '../shared/docs'
import { SEED_DOC_TEMPLATES } from '../shared/docTemplates'
import { docExcerpt, docTitle } from '../shared/mdDoc'
import { fillPlaceholders } from '../shared/templates'

// Documents are plain .md files in ~/Documents/AI Notes/{Документы,Шаблоны}, so they open in any
// editor and sync with iCloud "Desktop & Documents". Files opened from elsewhere are edited in place
// and remembered in userData/md-recent.json.

const MD_EXT = new Set(['.md', '.markdown', '.mdown', '.txt'])
const MD_FILTER = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }]

let root = ''
let docsDir = ''
let tplDir = ''
let recentFile = ''
let recent: string[] = []

const isMd = (p: string): boolean => MD_EXT.has(extname(p).toLowerCase())
const inside = (dir: string, p: string): boolean => resolve(p).startsWith(resolve(dir) + '/')

const saveRecent = (): void => {
  try {
    writeFileSync(recentFile, JSON.stringify(recent, null, 2))
  } catch {
    // Not remembered; the file can be opened again.
  }
}

function remember(paths: string[]): string[] {
  const ok = paths.map((p) => resolve(p)).filter((p) => isMd(p) && existsSync(p))
  const outside = ok.filter((p) => !inside(docsDir, p) && !inside(tplDir, p))
  if (outside.length) {
    recent = [...outside, ...recent.filter((p) => !outside.includes(p))].slice(0, 50)
    saveRecent()
  }
  return ok
}

/** Only files in our folders or ones the user opened may be written. */
function allowed(p: string): boolean {
  const abs = resolve(p)
  return isMd(abs) && (inside(docsDir, abs) || inside(tplDir, abs) || recent.includes(abs))
}

function describe(p: string, external: boolean, template: boolean): DocFile | null {
  try {
    const st = statSync(p)
    const text = readFileSync(p, 'utf8')
    const name = basename(p, extname(p))
    return {
      path: p,
      name,
      title: docTitle(text) || name,
      excerpt: docExcerpt(text),
      updatedAt: st.mtimeMs,
      size: st.size,
      external,
      template
    }
  } catch {
    return null
  }
}

const listDir = (dir: string, template: boolean): DocFile[] => {
  try {
    return readdirSync(dir)
      .filter((f) => isMd(f) && !f.startsWith('.'))
      .map((f) => describe(join(dir, f), false, template))
      .filter((d): d is DocFile => d !== null)
  } catch {
    return []
  }
}

export function listLibrary(): DocLibrary {
  const docs = [...listDir(docsDir, false), ...recent.map((p) => describe(p, true, false)).filter((d): d is DocFile => d !== null)]
  docs.sort((a, b) => b.updatedAt - a.updatedAt)
  const templates = listDir(tplDir, true).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return { docs, templates, root }
}

const safeName = (name: string): string =>
  name.replace(/[\\/:*?"<>|\0\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120) || 'Без названия'

/** `name.md`, or `name 2.md`… when taken. */
function freePath(dir: string, name: string, except?: string): string {
  const base = safeName(name)
  for (let i = 1; ; i++) {
    const p = join(dir, `${base}${i > 1 ? ` ${i}` : ''}.md`)
    if (!existsSync(p) || (except && resolve(p) === resolve(except))) return p
  }
}

const today = (): string => fillPlaceholders('{{date}}')

function seedTemplates(marker: string): void {
  if (existsSync(marker)) return
  for (const t of SEED_DOC_TEMPLATES) {
    const p = join(tplDir, `${safeName(t.name)}.md`)
    if (!existsSync(p)) writeFileSync(p, t.content)
  }
  writeFileSync(marker, new Date().toISOString())
}

const changed = (): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('docs:changed')
}

export function registerDocuments(userData: string): void {
  root = join(app.getPath('documents'), 'AI Notes')
  docsDir = join(root, 'Документы')
  tplDir = join(root, 'Шаблоны')
  recentFile = join(userData, 'md-recent.json')
  try {
    mkdirSync(docsDir, { recursive: true })
    mkdirSync(tplDir, { recursive: true })
    seedTemplates(join(userData, 'md-templates-seeded'))
  } catch (err) {
    console.error('documents: cannot prepare folders', err)
  }
  try {
    const raw = JSON.parse(readFileSync(recentFile, 'utf8'))
    recent = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : []
  } catch {
    recent = []
  }

  ipcMain.handle('docs:list', () => listLibrary())

  ipcMain.handle('docs:read', (_e, p: string) => {
    if (!allowed(p)) throw new Error('Файл не найден')
    return readFileSync(p, 'utf8')
  })

  ipcMain.handle('docs:write', (_e, p: string, content: string) => {
    if (!allowed(p)) throw new Error('Нет доступа к файлу')
    writeFileSync(p, content)
    return statSync(p).mtimeMs
  })

  /** New document (or template), optionally from a template file whose {{date}} placeholders get filled. */
  ipcMain.handle('docs:create', (_e, input: { name?: string; content?: string; fromTemplate?: string; template?: boolean }) => {
    let content = input.content ?? ''
    let name = input.name?.trim() ?? ''
    if (input.fromTemplate) {
      if (!allowed(input.fromTemplate)) throw new Error('Шаблон не найден')
      content = fillPlaceholders(readFileSync(input.fromTemplate, 'utf8'))
      name ||= `${basename(input.fromTemplate, extname(input.fromTemplate))} ${today()}`
    }
    name ||= docTitle(content) || (input.template ? 'Новый шаблон' : 'Новый документ')
    const p = freePath(input.template ? tplDir : docsDir, name)
    writeFileSync(p, content)
    changed()
    return describe(p, false, !!input.template)
  })

  /** Opens .md files from anywhere to edit in place. */
  ipcMain.handle('docs:open', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      title: 'Открыть Markdown',
      properties: ['openFile', 'multiSelections'],
      filters: MD_FILTER
    })
    if (res.canceled) return []
    const ok = remember(res.filePaths)
    changed()
    return ok
  })

  ipcMain.handle('docs:open-paths', (_e, paths: string[]) => {
    const ok = remember(paths)
    if (ok.length) changed()
    return ok
  })

  /** Copies .md files into the templates folder (asks for them when no paths are given). */
  ipcMain.handle('docs:import-templates', async (e, paths?: string[]) => {
    let files = paths ?? []
    if (!files.length) {
      const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
        title: 'Загрузить шаблоны',
        buttonLabel: 'Загрузить',
        properties: ['openFile', 'multiSelections'],
        filters: MD_FILTER
      })
      if (res.canceled) return []
      files = res.filePaths
    }
    const out: DocFile[] = []
    for (const src of files.filter(isMd)) {
      const dest = freePath(tplDir, basename(src, extname(src)))
      copyFileSync(src, dest)
      const d = describe(dest, false, true)
      if (d) out.push(d)
    }
    if (out.length) changed()
    return out
  })

  ipcMain.handle('docs:rename', (_e, p: string, name: string) => {
    if (!allowed(p)) throw new Error('Нет доступа к файлу')
    const next = freePath(dirname(p), name, p)
    if (resolve(next) === resolve(p)) return p
    renameSync(p, next)
    const i = recent.indexOf(resolve(p))
    if (i >= 0) {
      recent[i] = resolve(next)
      saveRecent()
    }
    changed()
    return next
  })

  /** Our files go to the macOS Trash; files opened from elsewhere are only forgotten. */
  ipcMain.handle('docs:remove', async (_e, p: string) => {
    const abs = resolve(p)
    if (recent.includes(abs)) {
      recent = recent.filter((x) => x !== abs)
      saveRecent()
      changed()
      return 'forgotten'
    }
    if (!allowed(abs)) throw new Error('Нет доступа к файлу')
    await shell.trashItem(abs)
    changed()
    return 'trashed'
  })

  /** "Download": saves a copy wherever the user picks, Downloads by default. */
  ipcMain.handle('docs:export', async (e, content: string, name: string) => {
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, {
      title: 'Скачать Markdown',
      defaultPath: join(app.getPath('downloads'), `${safeName(name)}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, content)
    return res.filePath
  })

  ipcMain.handle('docs:reveal', (_e, p?: string) => {
    if (p && existsSync(p)) shell.showItemInFolder(p)
    else void shell.openPath(root)
    return true
  })
}

/** Files opened from Finder ("Open With", drag onto the Dock icon). */
export function openFromFinder(paths: string[]): string[] {
  if (!recentFile) return paths
  return remember(paths)
}
