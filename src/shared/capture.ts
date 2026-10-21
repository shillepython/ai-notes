// Types shared between main, preload and the quick capture window.

export interface CaptureOpen {
  /** Start dictating right away (opened with the voice hotkey). */
  voice: boolean
  /** Size of the menu bar notch to grow out of, or null on screens without one. */
  notch: { width: number; height: number } | null
}

export interface CaptureApi {
  onOpen(cb: (opts: CaptureOpen) => void): () => void
  /** Main asks to close (the hotkey was pressed again). */
  onClose(cb: () => void): () => void
  /** The voice hotkey was pressed while the island is open. */
  onVoice(cb: () => void): () => void
  /** Called after the close animation; hides the window. */
  hidden(): void
  /** Whether the pointer is over the island; elsewhere clicks pass through to apps below. */
  setInteractive(on: boolean): void
  openMain(): void
}
