// Keyboard shortcut helpers. Letters are matched by physical key (e.code), so shortcuts
// work the same with the Russian layout: ⌘K is ⌘K, not ⌘Л.

const CODE: Record<string, string> = {
  enter: 'Enter',
  esc: 'Escape',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  '\\': 'Backslash',
  '/': 'Slash',
  '.': 'Period',
  ',': 'Comma'
}

const codeFor = (key: string): string => {
  if (CODE[key]) return CODE[key]
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return key
}

/** True when the event matches a combo like "mod+shift+k". `mod` is ⌘ on macOS and Ctrl elsewhere. */
export function matches(e: KeyboardEvent | React.KeyboardEvent, combo: string): boolean {
  const parts = combo.split('+')
  const key = parts.pop()!
  const mods = new Set(parts)
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mods.has('mod') !== mod) return false
  if (mods.has('shift') !== e.shiftKey) return false
  if (mods.has('alt') !== e.altKey) return false
  if (isMac && mods.has('ctrl') !== e.ctrlKey) return false
  return e.code === codeFor(key) || e.key === CODE[key]
}

/** True when keyboard focus is in a text field, so single-key shortcuts must not fire. */
export function isTyping(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** App-wide UI events, so a shortcut in one place can drive a component elsewhere. */
export type UiEvent = 'quick-add:focus' | 'assistant:focus'

export const emitUi = (name: UiEvent): void => {
  window.dispatchEvent(new Event(`ui:${name}`))
}

export const onUi = (name: UiEvent, cb: () => void): (() => void) => {
  window.addEventListener(`ui:${name}`, cb)
  return () => window.removeEventListener(`ui:${name}`, cb)
}
