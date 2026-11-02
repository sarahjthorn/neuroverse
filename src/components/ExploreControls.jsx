import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_ORDER, getCategoryColor, nodeCategoryList } from '../utils/categories'
import { PaletteIcon, RecenterIcon, CometIcon } from './icons'
import { usePresence } from '../utils/usePresence'
import './ExploreControls.css'

const HINT_KEY = 'aibrain_3dHintSeen'

// "22nd September – 29th September 2026"
function ordinal(n) {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`
}

function formatWeek(digest) {
  const start = new Date(digest.period_start)
  const end = new Date(digest.period_end)
  const month = (d) => d.toLocaleDateString('en-GB', { month: 'long' })
  return `${ordinal(start.getDate())} ${month(start)} – ${ordinal(end.getDate())} ${month(end)} ${end.getFullYear()}`
}

function hintAlreadySeen() {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true
  }
}

// The small overlay UI on top of the 3D view - kept deliberately minimal
// so the star map stays the star: two round buttons stacked above the
// timeline's play button (search lives in the top bar), and the colour key
// only unfolds when you ask for it.
function ExploreControls({
  nodes,
  hiddenCategories, onToggleCategory,
  digests, showComets, onToggleComets, onOpenDigest,
  onRecenter
}) {
  const [openPanel, setOpenPanel] = useState(null) // 'key' | 'comets' | null
  // Closing fades the popover out; switching straight to the other one swaps.
  const [shownPanel, panelLeaving] = usePresence(openPanel, 120)
  const keyOpen = openPanel === 'key'
  const cometsOpen = openPanel === 'comets'
  const leavingClass = panelLeaving ? ' is-leaving' : ''
  const toggle = (name) => setOpenPanel(p => (p === name ? null : name))
  const [showHint, setShowHint] = useState(() => !hintAlreadySeen())
  const keyRef = useRef(null)

  const counts = useMemo(() => {
    const map = new Map()
    nodes.forEach(n => nodeCategoryList(n.data).forEach(c => map.set(c, (map.get(c) || 0) + 1)))
    return map
  }, [nodes])

  useEffect(() => {
    if (!openPanel) return
    const onDown = (e) => { if (keyRef.current && !keyRef.current.contains(e.target)) setOpenPanel(null) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [openPanel])

  const dismissHint = () => {
    setShowHint(false)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // ignore storage errors
    }
  }

  return (
    <>
      <div className="explore-tools" ref={keyRef}>
        <button
          type="button"
          className={`explore-tool ${cometsOpen ? 'is-open' : ''}`}
          onClick={() => toggle('comets')}
          title="Comets - your weekly digests"
          aria-expanded={cometsOpen}
        >
          <CometIcon />
          {digests.length > 0 && <span className="explore-tool-badge">{digests.length}</span>}
        </button>
        <button
          type="button"
          className={`explore-tool ${keyOpen ? 'is-open' : ''}`}
          onClick={() => toggle('key')}
          title="Colour key & filters"
          aria-expanded={keyOpen}
        >
          <PaletteIcon />
        </button>
        <button type="button" className="explore-tool" onClick={onRecenter} title="Recenter view">
          <RecenterIcon />
        </button>

        {shownPanel === 'key' && (
          <div className={`explore-key${leavingClass}`} role="dialog" aria-label="Colour key">
            <div className="explore-key-title">Categories</div>
            <p className="explore-key-note">Click to show or hide. Striped planets belong to several.</p>
            <ul>
              {CATEGORY_ORDER.filter(c => counts.has(c)).map(c => {
                const hidden = hiddenCategories.has(c)
                return (
                  <li key={c}>
                    <button
                      type="button"
                      className={hidden ? 'is-hidden' : ''}
                      onClick={() => onToggleCategory(c)}
                      aria-pressed={!hidden}
                    >
                      <span className="explore-key-dot" style={{ background: getCategoryColor(c) }} />
                      <span className="explore-key-name">{c}</span>
                      <span className="explore-key-count">{counts.get(c)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="explore-key-title explore-key-section">In the sky</div>
            <ul>
              <li>
                <button type="button" className={showComets ? '' : 'is-hidden'} onClick={onToggleComets} aria-pressed={showComets}>
                  <span className="explore-key-dot explore-key-comet" />
                  <span className="explore-key-name">Comets</span>
                  <span className="explore-key-count">{digests.length}</span>
                </button>
              </li>
            </ul>
            <div className="explore-key-foot">Bigger star = more connections · pulsing = new since your last visit · comets = weekly digests</div>
          </div>
        )}

        {shownPanel === 'comets' && (
          <div className={`explore-key explore-comets${leavingClass}`} role="dialog" aria-label="Comets">
            <div className="explore-comets-head">
              <div className="explore-key-title">Comets</div>
              <button type="button" className="explore-comets-toggle" onClick={onToggleComets}>
                {showComets ? 'Hide in sky' : 'Show in sky'}
              </button>
            </div>
            <p className="explore-key-note">Each weekly digest orbits the brain as a comet. Pick a week to fly to it.</p>
            {digests.length === 0 ? (
              <p className="explore-key-note">No comets yet - write a weekly digest on the Stats page to launch one.</p>
            ) : (
              <ul className="explore-comets-list">
                {digests.map(d => (
                  <li key={d.id}>
                    {/* Just the week - a preview per comet gets cluttered fast. */}
                    <button type="button" onClick={() => { setOpenPanel(null); onOpenDigest(d) }}>
                      {formatWeek(d)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* No stars to orbit or click yet - the hint would just be confusing. */}
      {showHint && nodes.length > 0 && (
        <div className="explore-hint">
          <span>Drag to orbit · scroll to zoom · click a star to open it</span>
          <button type="button" onClick={dismissHint}>Got it</button>
        </div>
      )}
    </>
  )
}

export default ExploreControls
