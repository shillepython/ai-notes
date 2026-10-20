import Anthropic from '@anthropic-ai/sdk'
import type { AiEffort, AiModelId } from '@shared/ai'
import { CODE_PROMPT_SYSTEM, codePromptRequest, type CodePromptTask } from './prompts'

const FALLBACK_MODELS: ReadonlySet<AiModelId> = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

/** Turns a task and its subtasks into a ready-to-paste prompt for a coding assistant. */
export async function generateCodePrompt(
  task: CodePromptTask,
  opts: { apiKey: string; model: AiModelId; effort: AiEffort }
): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey })
  const response = await client.beta.messages.create({
    model: opts.model,
    max_tokens: 16000,
    system: CODE_PROMPT_SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort },
    messages: [{ role: 'user', content: codePromptRequest(task) }],
    ...(FALLBACK_MODELS.has(opts.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
  })
  if (response.stop_reason === 'refusal') throw new Error('Модель отказалась составлять промпт для этой задачи.')
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (!text) throw new Error('Модель вернула пустой ответ.')
  return text
}
