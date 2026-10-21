import Anthropic from '@anthropic-ai/sdk'
import type { Store } from '../store'
import type { AiChatItem, AiEffort, AiModelId, AiViewContext } from '@shared/ai'
import { systemPrompt, timeStamp, viewLine } from './prompts'
import { runTool, toolDefinitions, type ToolContext } from './tools'

const MAX_STEPS = 25

// Models with server-side refusal fallback. Haiku has none, so we don't send it there.
const FALLBACK_MODELS: ReadonlySet<AiModelId> = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

/** Anthropic-hosted web search and page fetch. Haiku only supports the basic versions. */
export function webTools(model: AiModelId): Anthropic.Beta.BetaToolUnion[] {
  return model === 'claude-haiku-5-5'
    ? [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
        { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 8 }
      ]
    : [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 }
      ]
}

/**
 * Turns one response into chat items in order: text (with its web sources
 * appended as links) and a line for each web search / page fetch.
 */
export function responseItems(content: Anthropic.Beta.BetaContentBlock[]): AiChatItem[] {
  const items: AiChatItem[] = []
  const calls = new Map<string, Anthropic.Beta.BetaServerToolUseBlock>()
  let text = ''
  const sources = new Map<string, string>()

  const flush = (): void => {
    if (text.trim()) {
      const links = [...sources].map(([url, title]) => `[${title.replace(/[[\]]/g, '')}](${url})`)
      items.push({ kind: 'assistant', text: links.length ? `${text.trim()}\n\nИсточники: ${links.join(', ')}` : text.trim() })
    }
    text = ''
    sources.clear()
  }

  for (const block of content) {
    if (block.type === 'text') {
      text += block.text
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location') sources.set(c.url, c.title || new URL(c.url).hostname)
      }
    } else if (block.type === 'server_tool_use') {
      calls.set(block.id, block)
    } else if (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') {
      flush()
      const input = (calls.get(block.tool_use_id)?.input ?? {}) as { query?: string; url?: string }
      const failed = block.type === 'web_search_tool_result' ? !Array.isArray(block.content) : block.content.type !== 'web_fetch_result'
      const summary =
        block.type === 'web_search_tool_result'
          ? `Поиск в интернете: «${input.query ?? ''}»`
          : `Открыта страница ${input.url ?? ''}`
      items.push({ kind: 'action', tool: block.type, summary: failed ? `${summary} (не удалось)` : summary, ok: !failed })
    } else if (block.type === 'tool_use') {
      flush()
    }
  }
  flush()
  return items
}

export interface RunOptions {
  apiKey: string
  model: AiModelId
  effort: AiEffort
  store: Store
  /** What the user has open; decides the default topic for new tasks. */
  view?: AiViewContext | null
  /** Services the tools may use (semantic search, notification settings). */
  services?: Omit<ToolContext, 'defaultTopicId'>
  signal: AbortSignal
  onItem(item: AiChatItem): void
}

/**
 * Holds one running conversation. History is append-only: a turn is committed
 * only when it finishes, so a cancelled or failed turn leaves the history as
 * it was before (a prefix of what was already sent).
 */
export class Conversation {
  private history: Anthropic.Beta.BetaMessageParam[] = []

  reset(): void {
    this.history = []
  }

  async send(text: string, opts: RunOptions): Promise<void> {
    const client = new Anthropic({ apiKey: opts.apiKey })
    const { store, view } = opts
    const topic = view?.kind === 'topic' ? store.getTopic(view.topicId) : null
    const note = view?.kind === 'note' ? store.getNote(view.noteId) : null
    const where = viewLine({ topic: topic?.name, note: note ? { id: note.id, title: note.title } : undefined })
    const toolContext: ToolContext = { ...opts.services, defaultTopicId: topic?.id ?? null }
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...this.history,
      { role: 'user', content: `${timeStamp()}${where}\n${text}` }
    ]
    const useFallbacks = FALLBACK_MODELS.has(opts.model)

    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await client.beta.messages.create(
        {
          model: opts.model,
          max_tokens: 16000,
          system: systemPrompt(),
          cache_control: { type: 'ephemeral' },
          thinking: { type: 'adaptive' },
          output_config: { effort: opts.effort },
          tools: [...toolDefinitions, ...webTools(opts.model)],
          messages,
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
        },
        { signal: opts.signal }
      )

      if (response.stop_reason === 'refusal') {
        opts.onItem({ kind: 'error', text: 'Модель отказалась выполнять этот запрос. Попробуй переформулировать.' })
        return
      }

      for (const item of responseItems(response.content)) opts.onItem(item)
      messages.push({ role: 'assistant', content: response.content })

      if (response.stop_reason === 'pause_turn') continue

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (toolUses.length === 0) {
        if (response.stop_reason === 'max_tokens') {
          opts.onItem({ kind: 'error', text: 'Ответ оборвался из-за лимита длины.' })
        }
        this.history = messages
        return
      }
      if (response.stop_reason === 'max_tokens') {
        // A tool input cut off at max_tokens may parse as a partial object; never run it.
        opts.onItem({ kind: 'error', text: 'Ответ оборвался из-за лимита длины, действие не выполнено.' })
        return
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const use of toolUses) {
        const outcome = await runTool(store, use.name, use.input, toolContext)
        opts.onItem({ kind: 'action', tool: use.name, summary: outcome.summary, ok: !outcome.isError })
        results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError })
      }
      if (opts.signal.aborted) return
      messages.push({ role: 'user', content: results })
    }

    opts.onItem({ kind: 'error', text: 'Слишком много шагов подряд, остановился.' })
  }
}

/** Human-readable error for the chat panel. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) return 'Остановлено.'
  if (err instanceof Anthropic.AuthenticationError) return 'Ключ API не подходит. Проверь его в настройках.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'У ключа нет доступа к этой модели.'
  if (err instanceof Anthropic.RateLimitError) return 'Слишком много запросов, попробуй через минуту.'
  if (err instanceof Anthropic.BadRequestError) return `Ошибка запроса: ${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return 'Нет соединения с API Anthropic.'
  if (err instanceof Anthropic.APIError) return `Ошибка API (${err.status ?? '?'}): ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/** Cheap call to check a pasted key before saving it. */
export async function verifyKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey, maxRetries: 0 })
  await client.models.list({ limit: 1 })
}
