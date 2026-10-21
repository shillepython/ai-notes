// Types shared between main, preload and renderer for the AI assistant.

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (умнее)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (быстрее, дешевле)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (самый быстрый)' }
] as const

export type AiModelId = (typeof AI_MODELS)[number]['id']
export type AiEffort = 'low' | 'medium' | 'high'

export interface AiSettings {
  hasKey: boolean
  /** Last 4 chars of the stored key, for display only. */
  keyHint: string | null
  model: AiModelId
  effort: AiEffort
  /** False when the OS keychain is unavailable and the key cannot be encrypted. */
  encryptionAvailable: boolean
}

export interface AiSettingsPatch {
  model?: AiModelId
  effort?: AiEffort
}

/** What the user has open in the main window; new tasks go into an open topic by default. */
export type AiViewContext =
  | { kind: 'tasks'; filter: string }
  | { kind: 'topic'; topicId: string }
  | { kind: 'note'; noteId: string }

/** Formats the API takes as vision input; anything else is re-encoded in the renderer first. */
export const AI_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type AiImageType = (typeof AI_IMAGE_TYPES)[number]

/** A picture sent along with a message (pasted, dropped or picked). */
export interface AiImage {
  name: string
  mediaType: AiImageType
  data: Uint8Array
}

/** One visible line in the chat panel. */
export type AiChatItem =
  | { kind: 'user'; text: string; /** Preview URLs of attached pictures. */ images?: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'action'; tool: string; summary: string; ok: boolean }
  | { kind: 'error'; text: string }

/** Streamed from main to renderer while a request runs. */
export type AiEvent =
  | { requestId: string; type: 'item'; item: AiChatItem }
  | { requestId: string; type: 'done' }

export interface AiApi {
  getSettings(): Promise<AiSettings>
  setKey(key: string): Promise<{ ok: true } | { ok: false; error: string }>
  clearKey(): Promise<void>
  updateSettings(patch: AiSettingsPatch): Promise<AiSettings>
  /**
   * Sends a message; results arrive through onEvent tagged with requestId. The caller picks
   * the id before sending, because events can arrive before this promise resolves.
   */
  send(text: string, requestId: string, images?: AiImage[]): Promise<void>
  /**
   * Like send, for the quick capture window: a separate short conversation (kept for a few
   * minutes for follow-ups) that never touches the main panel's chat.
   */
  capture(text: string, requestId: string, images?: AiImage[]): Promise<void>
  cancel(): Promise<void>
  /** Tells the assistant what is open now. Call on every view change. */
  setViewContext(view: AiViewContext): Promise<void>
  resetConversation(): Promise<void>
  onEvent(cb: (event: AiEvent) => void): () => void
  /** Generates a coding-assistant prompt from a task (with unsaved edits) and copies it to the clipboard. */
  codePrompt(task: { title: string; description: string; dueDate: string | null; priority: string }): Promise<{ ok: true; prompt: string } | { ok: false; error: string }>
}
