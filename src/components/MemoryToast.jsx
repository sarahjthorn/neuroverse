import { useEffect, useRef, useState } from 'react'
import { categoryDotBackground } from '../utils/categories'
import './MemoryToast.css'

const SHOW_MS = 6000
const MAX_TITLES = 3

// "Memory saved" pop-up after answering one of the brain's questions (Home
// card or Reflect), or when memories arrive from Claude while the app is
// open (`toast.title` then overrides the headline). Lists what the answer became and offers to show it in
// 3D. Hovering keeps it open; it fades out on its own otherwise.
function MemoryToast({ toast, onClose, onViewInBrain, onSelectNode }) {
  const [hovered, setHovered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    setLeaving(false)
  }, [toast])

  useEffect(() => {
    if (!toast || hovered) return
    timer.current = setTimeout(() => setLeaving(true), SHOW_MS)
    return () => clearTimeout(timer.current)
  }, [toast, hovered])

  if (!toast) return null
  const { nodes } = toast
  const extra = nodes.length - MAX_TITLES

  return (
    <div
      className={`memory-toast${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onAnimationEnd={(e) => { if (leaving && e.animationName === 'memory-toast-out') onClose() }}
    >
      <div className="memory-toast-head">
        <span className="memory-toast-check" aria-hidden="true">✓</span>
        <span className="memory-toast-title">
          {toast.title || (nodes.length === 0
            ? 'Thanks - nothing new to remember from that'
            : nodes.length === 1 ? 'Memory saved' : `${nodes.length} memories saved`)}
        </span>
        <button type="button" className="memory-toast-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {nodes.length > 0 && (
        <>
          <ul className="memory-toast-list">
            {nodes.slice(0, MAX_TITLES).map(node => (
              <li key={node.id}>
                <button type="button" onClick={() => { onSelectNode(node); onClose() }}>
                  <span className="memory-toast-dot" style={{ background: categoryDotBackground(node.data) }} />
                  {node.data.title}
                </button>
              </li>
            ))}
            {extra > 0 && <li className="memory-toast-more">+{extra} more</li>}
          </ul>
          <button
            type="button"
            className="memory-toast-action"
            onClick={() => { onViewInBrain(nodes.map(n => n.id), 'From your answer'); onClose() }}
          >
            See {nodes.length === 1 ? 'it' : 'them'} in your brain (3D) →
          </button>
        </>
      )}
    </div>
  )
}

export default MemoryToast
