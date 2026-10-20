import Anthropic from '@anthropic-ai/sdk'
import type { Store } from '../store'
import type { AiChatItem, AiEffort, AiModelId } from '@shared/ai'
import { executeTool, toolDefinitions } from './tools'

const MAX_STEPS = 25

// Models with server-side refusal fallback. Haiku has none, so we don't send it there.
const FALLBACK_MODELS: ReadonlySet<AiModelId> = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

function systemPrompt(): string {
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE') // YYYY-MM-DD in local time
  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' })
  return [
    'Ты встроенный ассистент приложения заметок и задач. Пользователь обычно надиктовывает голосом,',
    'поэтому текст может быть разговорным, с оговорками и без пунктуации: восстанавливай смысл.',
    '',
    'Что ты делаешь:',
    '- Превращаешь надиктованные планы в задачи (create_tasks): одна задача на одно действие, короткие названия,',
    '  детали в описание. Относительные сроки ("завтра", "в пятницу") переводи в даты.',
    '- Закрываешь задачи, когда пользователь говорит, что что-то сделал (complete_task), и кладёшь в comment то,',
    '  что он рассказал о результате. Сначала найди задачу через list_tasks или search, если id неизвестен.',
    '- Создаёшь, дописываешь и правишь заметки, ищешь по заметкам и задачам.',
    '- Если подходящих задач несколько и непонятно, какую имел в виду пользователь, спроси, а не угадывай.',
    '- Удаляешь только по явной просьбе удалить.',
    '',
    'Действуй сразу, без лишних подтверждений. После действий ответь коротко, одним-двумя предложениями,',
    'что именно сделано. Отвечай на языке пользователя (обычно русский). Не используй таблицы.',
    '',
    `Сегодня ${today}, ${weekday}.`
  ].join('\n')
}

export interface RunOptions {
  apiKey: string
  model: AiModelId
  effort: AiEffort
  store: Store
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
    const messages: Anthropic.Beta.BetaMessageParam[] = [...this.history, { role: 'user', content: text }]
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
          tools: toolDefinitions,
          messages,
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
        },
        { signal: opts.signal }
      )

      if (response.stop_reason === 'refusal') {
        opts.onItem({ kind: 'error', text: 'Модель отказалась выполнять этот запрос. Попробуй переформулировать.' })
        return
      }

      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) opts.onItem({ kind: 'assistant', text: block.text })
      }
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

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
        const outcome = executeTool(opts.store, use.name, use.input)
        opts.onItem({ kind: 'action', tool: use.name, summary: outcome.summary, ok: !outcome.isError })
        return { type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError }
      })
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
