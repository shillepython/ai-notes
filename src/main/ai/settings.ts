import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_MODELS, type AiEffort, type AiModelId, type AiSettings, type AiSettingsPatch } from '@shared/ai'

// The API key is encrypted with Electron safeStorage (macOS Keychain-backed)
// and never leaves the main process; the renderer only sees a 4-char hint.

const keyPath = (): string => join(app.getPath('userData'), 'anthropic-key.bin')
const prefsPath = (): string => join(app.getPath('userData'), 'ai-settings.json')

interface Prefs {
  model: AiModelId
  effort: AiEffort
}

const DEFAULT_PREFS: Prefs = { model: 'claude-opus-5-5', effort: 'medium' }

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), 'utf8')) as Partial<Prefs>
    const model = AI_MODELS.some((m) => m.id === raw.model) ? (raw.model as AiModelId) : DEFAULT_PREFS.model
    const effort = raw.effort === 'low' || raw.effort === 'medium' || raw.effort === 'high' ? raw.effort : DEFAULT_PREFS.effort
    return { model, effort }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function getApiKey(): string | null {
  if (!existsSync(keyPath()) || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(readFileSync(keyPath()))
  } catch {
    return null
  }
}

export function saveApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Системное шифрование недоступно, ключ не может быть сохранён безопасно')
  }
  writeFileSync(keyPath(), safeStorage.encryptString(key), { mode: 0o600 })
}

export function clearApiKey(): void {
  rmSync(keyPath(), { force: true })
}

export function getPrefs(): Prefs {
  return readPrefs()
}

export function updatePrefs(patch: AiSettingsPatch): void {
  const next = { ...readPrefs() }
  if (patch.model && AI_MODELS.some((m) => m.id === patch.model)) next.model = patch.model
  if (patch.effort) next.effort = patch.effort
  writeFileSync(prefsPath(), JSON.stringify(next, null, 2))
}

export function getSettings(): AiSettings {
  const key = getApiKey()
  return {
    hasKey: key !== null,
    keyHint: key ? key.slice(-4) : null,
    ...readPrefs(),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}
