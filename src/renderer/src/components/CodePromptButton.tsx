import { useEffect, useState } from 'react'
import type { Task } from '@shared/types'
import './CodePromptButton.css'

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'copied' } | { kind: 'error'; text: string }

/**
 * Asks Claude to turn the task (including edits not saved yet) into a prompt
 * for a coding assistant, and copies it to the clipboard.
 */
export default function CodePromptButton({
  task,
  title,
  description
}: {
  task: Task
  title: string
  description: string
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    if (state.kind !== 'copied') return
    const timer = setTimeout(() => setState({ kind: 'idle' }), 2500)
    return () => clearTimeout(timer)
  }, [state])

  const generate = async (): Promise<void> => {
    setState({ kind: 'busy' })
    const res = await window.api.ai.codePrompt({
      title: title.trim() || task.title,
      description,
      dueDate: task.dueDate,
      priority: task.priority
    })
    setState(res.ok ? { kind: 'copied' } : { kind: 'error', text: res.error })
  }

  return (
    <span className="code-prompt">
      <button
        className="code-prompt-btn"
        onClick={generate}
        disabled={state.kind === 'busy'}
        title="Claude составит промпт для ассистента по коду из задачи и её шагов и скопирует его"
      >
        {state.kind === 'busy' ? 'Составляю промпт…' : state.kind === 'copied' ? 'Промпт скопирован ✓' : '⧉ Промпт для кода'}
      </button>
      {state.kind === 'error' && <span className="code-prompt-error">{state.text}</span>}
    </span>
  )
}
