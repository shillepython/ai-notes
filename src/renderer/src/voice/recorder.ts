const SAMPLE_RATE = 16000

// Records the microphone with MediaRecorder and decodes the result to mono 16 kHz PCM,
// which is what Whisper expects. decodeAudioData resamples to the context's rate.
export class MicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private meter: { ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null

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

  /** Current input loudness in [0, 1], for a live waveform. 0 when not recording. */
  level(): number {
    if (!this.stream) return 0
    if (!this.meter) {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(this.stream).connect(analyser)
      this.meter = { ctx, analyser, buf: new Float32Array(analyser.fftSize) }
    }
    const { analyser, buf } = this.meter
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    // RMS of speech is ~0.02-0.2; map it onto a perceptual 0..1.
    return Math.min(1, Math.sqrt(sum / buf.length) * 6)
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
    void this.meter?.ctx.close()
    this.meter = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.recorder = null
  }
}
