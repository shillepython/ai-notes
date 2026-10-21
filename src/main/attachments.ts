import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import type { Store } from './store'
import type { Attachment } from '../shared/types'

// Files pasted or dropped into notes are copied to userData/attachments/<id>/<name> and
// referenced from the markdown as attachment://<id>/<name>, served by a custom protocol.

export const SCHEME = 'attachment'
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp', '.avif'])
const ID_RE = /^[0-9a-f-]{36}$/
/** Unreferenced files are kept this long, so a paste is not swept before the note autosaves (or after an undo). */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000

let dir = ''

/** Must run before app 'ready'. */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

const safeName = (name: string): string => {
  const clean = basename(name).replace(/[\\/:\0]/g, '_').trim()
  return clean && clean !== '.' && clean !== '..' ? clean : 'file'
}

/** `(`, `)` and spaces would break a markdown link, so everything beyond the safe set is escaped. */
const encodeName = (name: string): string => encodeURIComponent(name).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const describe = (id: string, name: string, size: number): Attachment => ({
  url: `${SCHEME}://${id}/${encodeName(name)}`,
  name,
  size,
  isImage: IMAGE_EXT.has(extname(name).toLowerCase())
})

/** Maps attachment://<id>/<name> to its file, or null for anything that is not ours. */
function resolve(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== `${SCHEME}:` || !ID_RE.test(u.hostname)) return null
    const name = safeName(decodeURIComponent(u.pathname.slice(1)))
    const file = join(dir, u.hostname, name)
    return existsSync(file) ? file : null
  } catch {
    return null
  }
}

function saveBytes(name: string, bytes: Uint8Array): Attachment {
  const id = randomUUID()
  const clean = safeName(name)
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(join(dir, id, clean), bytes)
  return describe(id, clean, bytes.byteLength)
}

function copyFile(path: string): Attachment {
  const id = randomUUID()
  const clean = safeName(path)
  mkdirSync(join(dir, id), { recursive: true })
  copyFileSync(path, join(dir, id, clean))
  return describe(id, clean, statSync(path).size)
}

/** Removes attachments no note or task mentions any more (including ones in the trash). */
export function sweepOrphans(store: Store, now = Date.now()): number {
  if (!existsSync(dir)) return 0
  const texts = [
    ...store.listNotes().map((n) => n.content),
    ...store.listTasks().map((t) => t.description),
    ...store.listTrash().map((i) => (i.kind === 'note' ? i.note.content : i.kind === 'task' ? i.task.description : ''))
  ].join('\n')
  let removed = 0
  for (const id of readdirSync(dir)) {
    if (!ID_RE.test(id) || texts.includes(`${SCHEME}://${id}/`)) continue
    const path = join(dir, id)
    if (now - statSync(path).mtimeMs < ORPHAN_GRACE_MS) continue
    rmSync(path, { recursive: true, force: true })
    removed++
  }
  return removed
}

export function registerAttachments(store: Store, userData: string): void {
  dir = join(userData, 'attachments')
  mkdirSync(dir, { recursive: true })

  protocol.handle(SCHEME, (req) => {
    const file = resolve(req.url)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 })
  })

  ipcMain.handle('attachments:save', (_e, name: string, bytes: Uint8Array) => saveBytes(name, bytes))
  ipcMain.handle('attachments:copy', (_e, paths: string[]) => paths.map(copyFile))
  ipcMain.handle('attachments:pick', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths.map(copyFile)
  })
  ipcMain.handle('attachments:open', async (_e, url: string) => {
    const file = resolve(url)
    if (!file) return false
    return (await shell.openPath(file)) === ''
  })
  ipcMain.handle('attachments:reveal', (_e, url: string) => {
    const file = resolve(url)
    if (file) shell.showItemInFolder(file)
    return !!file
  })

  sweepOrphans(store)
  // Erasing a note from the trash frees its files (after the grace period, on the next sweep).
  store.on('changed', (change) => {
    if (change.action === 'purged') sweepOrphans(store)
  })
}
