import { app } from 'electron'
import { join } from 'node:path'
import type { AutomaticSpeechRecognitionPipeline, ProgressInfo } from '@huggingface/transformers'

// Local Whisper via transformers.js (onnxruntime-node). Runs fully offline after the
// first launch downloads the model into userData/models.
// whisper-small is a good speed/quality balance for Russian on Apple Silicon; switch to
// 'onnx-community/whisper-large-v3-turbo' for better accuracy at ~3x the size.
export const DEFAULT_MODEL = process.env.VOICE_MODEL || 'onnx-community/whisper-small'
const LANGUAGE = process.env.VOICE_LANGUAGE || 'russian'

export type ModelProgress = { status: string; file?: string; progress?: number }

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null

export function loadTranscriber(
  onProgress?: (p: ModelProgress) => void
): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = join(app.getPath('userData'), 'models')
      const asr = await pipeline('automatic-speech-recognition', DEFAULT_MODEL, {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: (p: ProgressInfo) => {
          onProgress?.({
            status: p.status,
            file: 'file' in p ? p.file : undefined,
            progress: 'progress' in p ? p.progress : undefined
          })
        }
      })
      return asr as AutomaticSpeechRecognitionPipeline
    })()
    // Allow a retry (e.g. no network on first launch) instead of caching the failure.
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

// `audio` is mono 16 kHz PCM in [-1, 1].
export async function transcribe(
  audio: Float32Array,
  onProgress?: (p: ModelProgress) => void
): Promise<string> {
  if (audio.length < 16000 * 0.3) return ''
  const asr = await loadTranscriber(onProgress)
  const out = await asr(audio, {
    language: LANGUAGE,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5
  })
  const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text
  return cleanup(text)
}

// Whisper hallucinates stock subtitle phrases on silence (especially in Russian).
const HALLUCINATIONS = [
  /продолжение следует\.*/gi,
  /субтитры (сделал|создавал|делал|подготовил)[^.!?]*[.!?]?/gi,
  /редактор субтитров[^.!?]*[.!?]?/gi,
  /спасибо за просмотр[.!]?/gi
]

function cleanup(text: string): string {
  let t = text
  for (const re of HALLUCINATIONS) t = t.replace(re, ' ')
  return t.replace(/\s+/g, ' ').trim()
}
