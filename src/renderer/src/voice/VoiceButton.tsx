import { useEffect, useState } from 'react'
import { useVoiceInput, type TranscriptSource } from './useVoiceInput'
import './voice.css'

type Props = {
  onTranscript: (text: string, source: TranscriptSource) => void
  listenToHotkey?: boolean
}

// Click to start dictating, click again (or press the global hotkey) to stop.
// Esc cancels the recording without transcribing.
export function VoiceButton({ onTranscript, listenToHotkey = true }: Props): React.JSX.Element {
  const voice = useVoiceInput({ onTranscript, listenToHotkey })
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    window.api.voice.getShortcut().then(setShortcut).catch(() => setShortcut(null))
  }, [])

  useEffect(() => {
    if (voice.state !== 'recording') return
    const tick = setInterval(() => setNow(Date.now()), 250)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') voice.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(tick)
      window.removeEventListener('keydown', onKey)
    }
  }, [voice.state, voice.cancel])

  const seconds = voice.startedAt ? Math.floor((now - voice.startedAt) / 1000) : 0
  const hint = shortcut ? ` (${formatShortcut(shortcut)})` : ''
  const title =
    voice.state === 'recording'
      ? `Остановить и распознать${hint}, Esc — отмена`
      : voice.state === 'transcribing'
        ? 'Распознаю…'
        : `Надиктовать${hint}`

  let status: string | null = null
  if (voice.state === 'recording') status = `Запись ${formatTime(seconds)}`
  else if (voice.modelProgress !== null) status = `Загрузка модели ${Math.round(voice.modelProgress)}%`
  else if (voice.state === 'transcribing') status = 'Распознаю…'
  else if (voice.error) status = voice.error

  return (
    <div className="voice">
      <button
        type="button"
        className={`voice-button voice-button--${voice.state}`}
        onClick={() => voice.toggle('button')}
        disabled={voice.state === 'transcribing'}
        title={title}
        aria-label={title}
      >
        {voice.state === 'transcribing' ? <span className="voice-spinner" /> : <MicIcon />}
      </button>
      {status && <span className={`voice-status${voice.error && voice.state === 'idle' ? ' voice-status--error' : ''}`}>{status}</span>}
    </div>
  )
}

function MicIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  )
}

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function formatShortcut(accel: string): string {
  return accel
    .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘')
    .replace(/Shift/g, '⇧')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Control|Ctrl/g, '⌃')
    .replace(/\+/g, '')
}
