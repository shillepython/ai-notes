import { useEffect, useState } from 'react'
import { Icon } from './Icon'

interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

let nextId = 1
const listeners = new Set<(t: Toast) => void>()

/** Shows a short message at the bottom of the window, optionally with an action such as "Отменить". */
export function toast(text: string, action?: Toast['action']): void {
  const t = { id: nextId++, text, action }
  listeners.forEach((l) => l(t))
}

const TTL = 4500

export default function Toasts(): React.JSX.Element {
  const [items, setItems] = useState<(Toast & { leaving?: boolean })[]>([])

  useEffect(() => {
    const add = (t: Toast): void => {
      setItems((prev) => [...prev.slice(-2), t])
      setTimeout(() => dismiss(t.id), TTL)
    }
    listeners.add(add)
    return () => {
      listeners.delete(add)
    }
  }, [])

  const dismiss = (id: number): void => {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 200)
  }

  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.leaving ? 'leaving' : ''}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              <Icon name="undo" size={14} />
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
