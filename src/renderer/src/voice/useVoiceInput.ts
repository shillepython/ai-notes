import { useCallback, useEffect, useRef, useState } from 'react'
import { MicRecorder } from './recorder'

export type VoiceState = 'idle' | 'recording' | 'transcribing'
export type TranscriptSource = 'button' | 'hotkey'

const MAX_RECORDING_MS = 3 * 60 * 1000

type Options = {
  onTranscript: (text: string, source: TranscriptSource) => void
  // Only one component should own the global hotkey.
  listenToHotkey?: boolean
}

export function useVoiceInput({ onTranscript, listenToHotkey = true }: Options) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [modelProgress, setModelProgress] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  const recorder = useRef(new MicRecorder())
  const stateRef = useRef<VoiceState>('idle')
  const sourceRef = useRef<TranscriptSource>('button')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const update = (s: VoiceState): void => {
    stateRef.current = s
    setState(s)
  }

  const stop = useCallback(async () => {
    if (stateRef.current !== 'recording') return
    if (timer.current) clearTimeout(timer.current)
    update('transcribing')
    setStartedAt(null)
    try {
      const audio = await recorder.current.stop()
      const text = await window.api.voice.transcribe(audio)
      if (text) onTranscriptRef.current(text, sourceRef.current)
      else setError('Не удалось разобрать речь')
    } catch (e) {
      setError(`Ошибка распознавания: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      update('idle')
    }
  }, [])

  const start = useCallback(
    async (source: TranscriptSource = 'button') => {
      if (stateRef.current !== 'idle') return
      setError(null)
      sourceRef.current = source
      try {
        if (!(await window.api.voice.ensureMicAccess())) {
          setError('Нет доступа к микрофону: Системные настройки → Конфиденциальность → Микрофон')
          return
        }
        await recorder.current.start()
        update('recording')
        setStartedAt(Date.now())
        timer.current = setTimeout(() => void stop(), MAX_RECORDING_MS)
      } catch (e) {
        setError(`Микрофон недоступен: ${e instanceof Error ? e.message : String(e)}`)
        update('idle')
      }
    },
    [stop]
  )

  const cancel = useCallback(() => {
    if (stateRef.current !== 'recording') return
    if (timer.current) clearTimeout(timer.current)
    recorder.current.cancel()
    setStartedAt(null)
    update('idle')
  }, [])

  const toggle = useCallback(
    (source: TranscriptSource = 'button') => {
      if (stateRef.current === 'recording') void stop()
      else void start(source)
    },
    [start, stop]
  )

  useEffect(() => {
    const offProgress = window.api.voice.onModelProgress((p) => {
      if (p.status === 'progress_total' && typeof p.progress === 'number') setModelProgress(p.progress)
      if (p.status === 'ready') setModelProgress(null)
    })
    // Load the model in the background so the first dictation is not slow.
    window.api.voice.warmup().catch((e) => {
      setModelProgress(null)
      setError(`Не удалось загрузить модель распознавания: ${e instanceof Error ? e.message : String(e)}`)
    })
    return () => {
      offProgress()
      recorder.current.cancel()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  useEffect(() => {
    if (!listenToHotkey) return
    return window.api.voice.onToggle(() => toggle('hotkey'))
  }, [listenToHotkey, toggle])

  const level = useCallback(() => recorder.current.level(), [])

  return { state, error, modelProgress, startedAt, start, stop, cancel, toggle, level }
}
