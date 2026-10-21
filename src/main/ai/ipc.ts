import { clipboard, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { getStore } from '../store'
import { semanticSearch } from '../semantic'
import { getDigestSettings, updateDigestSettings } from '../digestSchedule'
import { saveBytes } from '../attachments'
import { AI_IMAGE_TYPES, type AiEvent, type AiImageType, type AiSettingsPatch, type AiViewContext } from '@shared/ai'
import { Conversation, describeError, verifyKey, type ImageInput } from './agent'
import { generateCodePrompt } from './codePrompt'
import type { CodePromptTask } from './prompts'
import { clearApiKey, getApiKey, getPrefs, getSettings, saveApiKey, updatePrefs } from './settings'

// IPC for the assistant. Channels: ai:getSettings, ai:setKey, ai:clearKey,
// ai:updateSettings, ai:send, ai:capture, ai:cancel, ai:setView, ai:reset, ai:codePrompt; events go out on 'ai:event'.

const conversation = new Conversation()
let running: AbortController | null = null
let view: AiViewContext | null = null

function emit(target: WebContents, event: AiEvent): void {
  if (!target.isDestroyed()) target.send('ai:event', event)
}

// Quick capture keeps its own short conversation, so follow-ups like "и напомни в 9" work
// without mixing into the main panel's chat.
const captureConversation = new Conversation()
let captureRunning: AbortController | null = null
let captureLastAt = 0
const CAPTURE_MEMORY_MS = 5 * 60 * 1000
const CAPTURE_HINT = '[Быстрый захват из строки меню: сделай, что просят, и ответь одной короткой фразой без списков.]'

const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Keeps well-formed pictures from the renderer and saves each one as an attachment. */
function readImages(raw: unknown): ImageInput[] {
  if (!Array.isArray(raw)) return []
  const out: ImageInput[] = []
  for (const item of raw.slice(0, MAX_IMAGES)) {
    const { name, mediaType, data } = (item ?? {}) as { name?: unknown; mediaType?: unknown; data?: unknown }
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) continue
    if (!AI_IMAGE_TYPES.includes(mediaType as AiImageType)) continue
    const saved = saveBytes(typeof name === 'string' && name ? name : 'image', data)
    out.push({ name: saved.name, url: saved.url, mediaType: mediaType as AiImageType, base64: Buffer.from(data).toString('base64') })
  }
  return out
}

/** Runs one user message through a conversation, streaming items to `target`. */
function run(
  target: WebContents,
  raw: unknown,
  rawId: unknown,
  images: ImageInput[],
  convo: Conversation,
  viewCtx: AiViewContext | null,
  controller: AbortController,
  finished: () => void
): void {
  const text = typeof raw === 'string' ? raw.trim() : ''
  const requestId = typeof rawId === 'string' && rawId ? rawId : randomUUID()
  const apiKey = getApiKey()

  queueMicrotask(async () => {
    try {
      if (!text && images.length === 0) return
      if (!apiKey) {
        emit(target, { requestId, type: 'item', item: { kind: 'error', text: 'Добавь API-ключ в настройках ассистента.' } })
        return
      }
      await convo.send(text, {
        apiKey,
        ...getPrefs(),
        store: getStore(),
        view: viewCtx,
        services: {
          semanticSearch: (q) => semanticSearch(q),
          digestSettings: { get: getDigestSettings, update: updateDigestSettings }
        },
        signal: controller.signal,
        onItem: (item) => emit(target, { requestId, type: 'item', item })
      }, images)
    } catch (err) {
      emit(target, { requestId, type: 'item', item: { kind: 'error', text: describeError(err) } })
    } finally {
      finished()
      emit(target, { requestId, type: 'done' })
    }
  })
}

export function registerAiIpc(): void {
  ipcMain.handle('ai:getSettings', () => getSettings())

  ipcMain.handle('ai:setKey', async (_e, raw: unknown) => {
    const key = typeof raw === 'string' ? raw.trim() : ''
    if (!key) return { ok: false, error: 'Вставь ключ' }
    try {
      await verifyKey(key)
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
    try {
      saveApiKey(key)
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
    return { ok: true }
  })

  ipcMain.handle('ai:clearKey', () => clearApiKey())

  ipcMain.handle('ai:updateSettings', (_e, patch: AiSettingsPatch) => {
    updatePrefs(patch ?? {})
    return getSettings()
  })

  ipcMain.handle('ai:send', (e, raw: unknown, rawId: unknown, rawImages: unknown) => {
    const controller = new AbortController()
    running?.abort()
    running = controller
    run(e.sender, raw, rawId, readImages(rawImages), conversation, view, controller, () => {
      if (running === controller) running = null
    })
  })

  ipcMain.handle('ai:capture', (e, raw: unknown, rawId: unknown, rawImages: unknown) => {
    // A pause longer than CAPTURE_MEMORY_MS starts a fresh capture conversation.
    if (Date.now() - captureLastAt > CAPTURE_MEMORY_MS) captureConversation.reset()
    captureLastAt = Date.now()
    const controller = new AbortController()
    captureRunning?.abort()
    captureRunning = controller
    const images = readImages(rawImages)
    const said = typeof raw === 'string' ? raw.trim() : ''
    const text = said || images.length ? `${CAPTURE_HINT}\n${said}`.trim() : ''
    run(e.sender, text, rawId, images, captureConversation, null, controller, () => {
      if (captureRunning === controller) captureRunning = null
      captureLastAt = Date.now()
    })
  })

  ipcMain.handle('ai:setView', (_e, raw: unknown) => {
    view = raw && typeof raw === 'object' && 'kind' in raw ? (raw as AiViewContext) : null
  })

  ipcMain.handle('ai:cancel', (e) => {
    // The capture window cancels only its own request.
    if (captureRunning && e.sender.getURL().includes('capture.html')) {
      captureRunning.abort()
      captureRunning = null
      return
    }
    running?.abort()
    running = null
  })

  ipcMain.handle('ai:codePrompt', async (_e, raw: unknown) => {
    const input = (raw ?? {}) as Partial<CodePromptTask>
    if (typeof input.title !== 'string' || !input.title.trim()) return { ok: false, error: 'У задачи нет названия' }
    const task: CodePromptTask = {
      title: input.title,
      description: typeof input.description === 'string' ? input.description : '',
      dueDate: typeof input.dueDate === 'string' ? input.dueDate : null,
      priority: typeof input.priority === 'string' ? input.priority : 'medium'
    }
    const apiKey = getApiKey()
    if (!apiKey) return { ok: false, error: 'Добавь API-ключ в настройках ассистента.' }
    try {
      const prompt = await generateCodePrompt(task, { apiKey, ...getPrefs() })
      clipboard.writeText(prompt)
      return { ok: true, prompt }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  ipcMain.handle('ai:reset', () => {
    running?.abort()
    running = null
    conversation.reset()
  })
}
