import { useEffect, useState } from 'react'

/**
 * Animates height between 0 and auto (CSS grid 0fr → 1fr) and keeps children mounted
 * until the closing transition has finished.
 */
export default function Collapse({ open, children }: { open: boolean; children: React.ReactNode }): React.JSX.Element {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Next frame, so the browser sees the collapsed state before expanding.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)))
      return () => cancelAnimationFrame(id)
    }
    setExpanded(false)
    const t = setTimeout(() => setMounted(false), 260)
    return () => clearTimeout(t)
  }, [open])

  return (
    <div className={`collapse ${expanded ? 'open' : ''}`}>
      <div className="collapse-inner">{mounted && children}</div>
    </div>
  )
}
