import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { Store } from '../store'
import type { SemanticSearchResult } from '../../shared/types'
import { makeEmbed, type EmbedderProgress } from './embedder'
import { SemanticIndex, type SemanticHit } from './semanticIndex'

// Wires the semantic index into the app: IPC 'semantic:search' for the command
// palette and semanticSearch() for the assistant's search tool. The model is only
// downloaded on the first search; after that the index is kept fresh in the
// background on every change.

/** e5 similarities sit in a narrow band; below this a passage is rarely related. */
const MIN_SCORE = 0.8

let index: SemanticIndex | null = null
let progress: EmbedderProgress | null = null
let ready = false
let lastError: string | null = null

function onProgress(p: EmbedderProgress): void {
  progress = p
  if (p.status === 'ready') ready = true
}

function startSync(): Promise<void> {
  if (!index) return Promise.resolve()
  const run = index.sync().then(
    () => {
      ready = true
      lastError = null
    },
    (err) => {
      lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  )
  run.catch(() => {})
  return run
}

export function registerSemantic(store: Store): void {
  const dir = app.getPath('userData')
  index = new SemanticIndex(join(dir, 'semantic-index.db'), store, makeEmbed(join(dir, 'models'), onProgress))

  let timer: NodeJS.Timeout | null = null
  let active = index.hasData()
  store.on('changed', () => {
    if (!active) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void startSync(), 3000)
  })
  // Used before: catch up on changes made while the app was closed, after startup settles.
  if (active) setTimeout(() => void startSync(), 8000)

  ipcMain.handle('semantic:search', async (_e, raw: unknown): Promise<SemanticSearchResult> => {
    const query = typeof raw === 'string' ? raw : ''
    active = true
    if (!ready) {
      // First use: the model is still downloading or the index is being built. Don't block the palette.
      void startSync()
      if (lastError) return { status: 'error', error: lastError }
      return { status: 'loading', progress: progress?.progress ?? null }
    }
    try {
      return { status: 'ready', hits: await index!.search(query, { minScore: MIN_SCORE }) }
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  })

  app.on('will-quit', () => index?.close())
}

/** How long the assistant waits for the first model download before answering from word search. */
const FIRST_USE_WAIT = 20_000

/** For the assistant. On first use waits a little for the model, then answers without it (it keeps loading). */
export async function semanticSearch(query: string, limit = 8): Promise<SemanticHit[]> {
  if (!index) return []
  if (!ready) {
    const loaded = await Promise.race([
      startSync().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FIRST_USE_WAIT))
    ])
    if (!loaded) return []
  }
  return index.search(query, { limit, minScore: MIN_SCORE - 0.02 })
}
