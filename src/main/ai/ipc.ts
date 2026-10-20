import { clipboard, ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { getStore } from '../store'
import type { AiEvent, AiSettingsPatch } from '@shared/ai'
import { Conversation, describeError, verifyKey } from './agent'
import { generateCodePrompt } from './codePrompt'
import type { CodePromptTask } from './prompts'
import { clearApiKey, getApiKey, getPrefs, getSettings, saveApiKey, updatePrefs } from './settings'

// IPC for the assistant. Channels: ai:getSettings, ai:setKey, ai:clearKey,
// ai:updateSettings, ai:send, ai:cancel, ai:reset, ai:codePrompt; events go out on 'ai:event'.

const conversation = new Conversation()
let running: AbortController | null = null

function emit(target: WebContents, event: AiEvent): void {
  if (!target.isDestroyed()) target.send('ai:event', event)
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

  ipcMain.handle('ai:send', (e, raw: unknown) => {
    const text = typeof raw === 'string' ? raw.trim() : ''
    const requestId = randomUUID()
    const target = e.sender
    const apiKey = getApiKey()

    queueMicrotask(async () => {
      if (!text) return emit(target, { requestId, type: 'done' })
      if (!apiKey) {
        emit(target, { requestId, type: 'item', item: { kind: 'error', text: 'Добавь API-ключ в настройках ассистента.' } })
        return emit(target, { requestId, type: 'done' })
      }
      running?.abort()
      const controller = new AbortController()
      running = controller
      try {
        await conversation.send(text, {
          apiKey,
          ...getPrefs(),
          store: getStore(),
          signal: controller.signal,
          onItem: (item) => emit(target, { requestId, type: 'item', item })
        })
      } catch (err) {
        emit(target, { requestId, type: 'item', item: { kind: 'error', text: describeError(err) } })
      } finally {
        if (running === controller) running = null
        emit(target, { requestId, type: 'done' })
      }
    })
    return requestId
  })

  ipcMain.handle('ai:cancel', () => {
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
