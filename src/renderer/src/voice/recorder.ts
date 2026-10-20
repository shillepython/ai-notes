const SAMPLE_RATE = 16000

// Records the microphone with MediaRecorder and decodes the result to mono 16 kHz PCM,
// which is what Whisper expects. decodeAudioData resamples to the context's rate.
export class MicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (e): void => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  async stop(): Promise<Float32Array> {
    const recorder = this.recorder
    if (!recorder) return new Float32Array()
    const stopped = new Promise<void>((resolve) => (recorder.onstop = (): void => resolve()))
    recorder.stop()
    await stopped
    this.release()
    const blob = new Blob(this.chunks, { type: recorder.mimeType })
    this.chunks = []
    if (blob.size === 0) return new Float32Array()
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
      return decoded.getChannelData(0).slice()
    } finally {
      void ctx.close()
    }
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null
      this.recorder.stop()
    }
    this.chunks = []
    this.release()
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
  }
}
