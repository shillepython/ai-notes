import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AiChatItem } from '@shared/ai'
import type { CaptureOpen } from '@shared/capture'
import { useVoiceInput, type TranscriptSource } from '../voice/useVoiceInput'

// The quick capture "island": grows out of the notch, takes text or dictation, sends it to
// the assistant and shows what was done, then tucks itself back in.

type Phase = 'input' | 'working' | 'done'

const WIDTH = 560
const CLOSE_MS = 340
const AUTO_CLOSE_MS = 5000
const BARS = 28

const capture = (): typeof window.api.capture => window.api.capture

export default function Capture(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [notch, setNotch] = useState<CaptureOpen['notch']>(null)
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [sent, setSent] = useState('')
  const [items, setItems] = useState<AiChatItem[]>([])
  const [contentHeight, setContentHeight] = useState(0)
  const [hover, setHover] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<string | null>(null)
  const phaseRef = useRef<Phase>('input')
  phaseRef.current = phase
  const closingRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback((raw: string) => {
    const t = raw.trim()
    if (!t) return
    const id = crypto.randomUUID()
    requestRef.current = id
    setSent(t)
    setText('')
    setItems([])
    setPhase('working')
    void window.api.ai.capture(t, id)
  }, [])

  const onTranscript = useCallback(
    (t: string, source: TranscriptSource) => {
      // The voice hotkey sends right away; the mic button drops the text in for a look first.
      if (source === 'hotkey') send(t)
      else {
        setText((prev) => (prev ? `${prev} ${t}` : t))
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
      }
    },
    [send]
  )
  const voice = useVoiceInput({ onTranscript, listenToHotkey: false })
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  const close = useCallback(() => {
    if (closingRef.current) return
    voiceRef.current.cancel()
    setOpen(false)
    closingRef.current = setTimeout(() => {
      closingRef.current = null
      capture().setInteractive(false)
      capture().hidden()
      setHover(false)
    }, CLOSE_MS)
  }, [])

  // ---- Main process events ----

  useEffect(() => {
    const offOpen = capture().onOpen((opts) => {
      if (closingRef.current) {
        clearTimeout(closingRef.current)
        closingRef.current = null
      }
      setNotch(opts.notch)
      setPhase('input')
      setText('')
      setSent('')
      setItems([])
      requestRef.current = null
      // Start collapsed in the notch, then grow on the next frame so the transition runs.
      setOpen(false)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setOpen(true)
          inputRef.current?.focus({ preventScroll: true })
          if (opts.voice) void voiceRef.current.start('hotkey')
        })
      )
    })
    const offClose = capture().onClose(close)
    const offVoice = capture().onVoice(() => {
      if (phaseRef.current !== 'input') setPhase('input')
      voiceRef.current.toggle('hotkey')
    })
    return () => {
      offOpen()
      offClose()
      offVoice()
    }
  }, [close])

  useEffect(
    () =>
      window.api.ai.onEvent((e) => {
        if (e.requestId !== requestRef.current) return
        if (e.type === 'item') setItems((prev) => [...prev, e.item])
        else setPhase('done')
      }),
    []
  )

  // Clicking another app closes the island unless it is still listening or working.
  useEffect(() => {
    const onBlur = (): void => {
      if (voiceRef.current.state !== 'idle') return
      if (phaseRef.current === 'working') return
      close()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [close])

  // After a result, tuck away on its own unless the pointer is on it or the user is typing.
  const autoClose = phase === 'done' && !hover && !text && voice.state === 'idle' && open
  useEffect(() => {
    if (!autoClose) return
    const t = setTimeout(close, AUTO_CLOSE_MS)
    return () => clearTimeout(t)
  }, [autoClose, close])

  // ---- Size ----

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContentHeight(el.offsetHeight))
    // Border box: the notch padding changes with the screen, not only the content.
    ro.observe(el, { box: 'border-box' })
    setContentHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [])

  // Auto-grow the textarea up to a few lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  const collapsed = notch ?? { width: 132, height: 0 }
  const size = open ? { width: WIDTH, height: contentHeight } : collapsed

  // ---- Input ----

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (phase !== 'working') send(text)
    }
  }

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (voiceRef.current.state === 'recording') voiceRef.current.cancel()
        else close()
      } else if (e.key === 'o' && e.metaKey) {
        e.preventDefault()
        capture().openMain()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const listening = voice.state === 'recording'
  const transcribing = voice.state === 'transcribing'
  const actions = items.filter((i) => i.kind === 'action')
  const answer = items.filter((i) => i.kind === 'assistant').at(-1)
  const errors = items.filter((i) => i.kind === 'error')
  const mood = listening ? 'listening' : phase === 'working' || transcribing ? 'working' : errors.length ? 'error' : phase === 'done' ? 'done' : 'idle'

  return (
    <div
      className={`island island--${mood}${open ? ' island--open' : ''}${notch ? ' island--notch' : ''}`}
      style={{ width: size.width, height: size.height }}
      onMouseEnter={() => {
        setHover(true)
        capture().setInteractive(true)
      }}
      onMouseLeave={() => {
        setHover(false)
        capture().setInteractive(false)
      }}
    >
      <span className="island__ear island__ear--l" />
      <span className="island__ear island__ear--r" />
      <div className="island__clip">
        <div className="island__content" ref={contentRef} style={{ paddingTop: (notch?.height ?? 0) + 12 }}>
          {listening ? (
            <div className="row row--listening">
              <span className="orb orb--rec" />
              <Waveform level={voice.level} />
              <Elapsed since={voice.startedAt} />
              <button className="pill-btn" onClick={() => void voice.stop()} title="Остановить и отправить">
                Готово
              </button>
            </div>
          ) : (
            <div className="row">
              <span className={`orb orb--${mood}`} />
              {transcribing ? (
                <div className="shimmer">Распознаю речь…</div>
              ) : (
                <textarea
                  ref={inputRef}
                  className="capture-input"
                  rows={1}
                  value={text}
                  placeholder={phase === 'input' ? 'Задача, заметка или вопрос…' : 'Ещё что-нибудь?'}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  spellCheck={false}
                />
              )}
              <button
                className="icon-btn"
                onClick={() => voice.toggle('button')}
                disabled={transcribing}
                title="Надиктовать"
              >
                <MicIcon />
              </button>
              {text.trim() && phase !== 'working' && (
                <button className="icon-btn icon-btn--send" onClick={() => send(text)} title="Отправить (↵)">
                  <ArrowIcon />
                </button>
              )}
            </div>
          )}

          {voice.modelProgress !== null && (
            <div className="note">Загружаю модель распознавания… {Math.round(voice.modelProgress)}%</div>
          )}
          {voice.error && voice.state === 'idle' && <div className="note note--error">{voice.error}</div>}

          {(phase !== 'input' || items.length > 0) && (
            <div className="result">
              {sent && <div className="result__sent">«{sent}»</div>}
              {actions.map((a, i) => (
                <div key={i} className={`result__action${a.kind === 'action' && !a.ok ? ' result__action--fail' : ''}`}>
                  <CheckIcon />
                  <span>{a.kind === 'action' ? a.summary : ''}</span>
                </div>
              ))}
              {answer && answer.kind === 'assistant' && <div className="result__answer">{plain(answer.text)}</div>}
              {errors.map((e, i) => (
                <div key={i} className="result__error">
                  {e.kind === 'error' ? e.text : ''}
                </div>
              ))}
              {phase === 'working' && <div className="shimmer shimmer--small">{actions.length ? 'Делаю…' : 'Думаю…'}</div>}
            </div>
          )}

          <div className="footer">
            <span>
              <kbd>↵</kbd> отправить
            </span>
            <span>
              <kbd>esc</kbd> закрыть
            </span>
            <button className="link-btn" onClick={() => capture().openMain()}>
              Открыть AI Notes <kbd>⌘O</kbd>
            </button>
            {autoClose && <span className="footer__timer" style={{ animationDuration: `${AUTO_CLOSE_MS}ms` }} />}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Short answers only: drop Markdown markup the island can't render. */
function plain(md: string): string {
  return md
    .replace(/\n+Источники:.*$/s, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

/** Live bars that follow the microphone level; updated outside React for 60 fps. */
function Waveform({ level }: { level: () => number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bars = Array.from(ref.current?.children ?? []) as HTMLElement[]
    const history = new Array(BARS).fill(0)
    let raf = 0
    let frame = 0
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      // Sample every other frame so the wave scrolls at a calm pace.
      if (frame++ % 2) return
      history.shift()
      history.push(level())
      bars.forEach((b, i) => {
        // Taper the ends so the wave sits in the middle like a voice memo.
        const edge = Math.sin(((i + 0.5) / BARS) * Math.PI) ** 0.6
        const v = Math.max(0.08, history[i] * edge)
        b.style.transform = `scaleY(${v})`
      })
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [level])
  return (
    <div className="wave" ref={ref}>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  )
}

function Elapsed({ since }: { since: number | null }): React.JSX.Element {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])
  const s = since ? Math.floor((Date.now() - since) / 1000) : 0
  return <span className="elapsed">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
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

function ArrowIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
