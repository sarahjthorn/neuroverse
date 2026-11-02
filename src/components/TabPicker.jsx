import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OPTIONAL_TABS } from '../tabs'
import './TabPicker.css'

// The "+" at the end of the nav: optional tabs with a line about each and
// an on/off switch. Tabs still being planned show as "Coming soon".
function TabPicker({ enabled, onToggle }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const rootRef = useRef(null)
  const panelRef = useRef(null)
  const [shift, setShift] = useState(0)

  // The panel hangs off the "+", so in a narrow window it can run past the
  // right edge. Slide it left just enough to keep it on screen.
  useLayoutEffect(() => {
    if (!open) return
    const GUTTER = 16
    const place = () => {
      const anchor = rootRef.current?.getBoundingClientRect()
      const width = panelRef.current?.offsetWidth
      if (!anchor || !width) return
      const maxLeft = document.documentElement.clientWidth - GUTTER - width
      const left = Math.max(GUTTER, Math.min(anchor.left, maxLeft))
      setShift(anchor.left - left)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = async (id, on) => {
    setBusy(id)
    await onToggle(id, on)
    setBusy(null)
  }

  return (
    <div className="tab-picker" ref={rootRef}>
      <button
        type="button"
        className={`tab-picker-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="Add or remove tabs"
        title="Add or remove tabs"
      >
        +
      </button>

      {open && (
        <div
          className="tab-picker-panel"
          ref={panelRef}
          style={{ left: -shift }}
          role="dialog"
          aria-label="Optional tabs"
        >
          <p className="tab-picker-title">More tabs</p>
          <p className="tab-picker-intro">Switch on the extras you want. Turning one off only hides it; nothing is deleted.</p>
          <ul>
            {OPTIONAL_TABS.map(t => {
              const on = enabled.includes(t.id)
              const soon = t.status !== 'ready'
              return (
                <li key={t.id} className={soon ? 'is-soon' : ''}>
                  <div>
                    <span className="tab-picker-name">
                      {t.label}
                      {soon && <span className="tab-picker-chip">Coming soon</span>}
                    </span>
                    <span className="tab-picker-desc">{t.description}</span>
                  </div>
                  {!soon && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`Show the ${t.label} tab`}
                      className={`tab-picker-switch${on ? ' is-on' : ''}`}
                      disabled={busy === t.id}
                      onClick={() => toggle(t.id, !on)}
                    >
                      <span />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export default TabPicker
