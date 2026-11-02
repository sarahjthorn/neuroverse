import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePresence } from '../utils/usePresence'
import { flyFromRect, rememberSearchOrigin, EASE_OUT_EXPO } from '../utils/motion'
import { getCategoryColor, nodeCategoryList } from '../utils/categories'
import { SearchIcon } from './icons'
import './GlobalSearch.css'

const MAX_RESULTS = 8

// The one search box in the top bar (Home keeps its own big "ask" bar, so
// this hides there). Typing lights matches up in the 3D view, the dropdown
// jumps straight to a memory, and Enter asks the brain on Home.
function GlobalSearch({ value, onChange, onClear, exactResults, semanticResults, semanticLoading, onPick, onAsk }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const boxRef = useRef(null)

  // Leaving Home, Home's Ask bar (still fading out underneath) is hidden and
  // this box flies up out of its spot, then gives one soft glow on landing.
  // Going back Home, it leaves its rect behind so the Ask bar can fly down.
  useLayoutEffect(() => {
    const box = boxRef.current
    const homeBar = document.querySelector('.home-layer.is-leaving .home-search-row')
    const fly = homeBar && flyFromRect(box, homeBar.getBoundingClientRect())
    let glow = null
    fly?.finished.then(() => {
      glow = box.animate([
        { boxShadow: 'var(--field-glass-highlight), 0 0 0 0 rgba(var(--accent-rgb), 0.45)' },
        { boxShadow: 'var(--field-glass-highlight), 0 0 0 6px rgba(var(--accent-rgb), 0)' }
      ], { duration: 600, easing: EASE_OUT_EXPO })
    }, () => {})
    return () => {
      rememberSearchOrigin(box)
      fly?.cancel()
      glow?.cancel()
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const seen = new Set()
  const results = [...exactResults, ...semanticResults]
    .filter(n => (seen.has(n.id) ? false : seen.add(n.id)))
    .slice(0, MAX_RESULTS)

  useEffect(() => { setActive(0) }, [value])

  const pick = (node) => {
    setOpen(false)
    inputRef.current?.blur()
    onPick(node)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => Math.min(i + 1, results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < results.length && results[active]) pick(results[active])
      else if (value.trim()) {
        setOpen(false)
        onAsk()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showDropdown = open && value.trim().length > 0
  // Fades out when closed (blur, Escape, a pick); clearing the text just
  // removes it, since there's nothing left to show.
  const [menuShown, menuLeaving] = usePresence(showDropdown, 120)

  return (
    <div className="global-search" ref={wrapRef}>
      <div
        ref={boxRef}
        className={`global-search-box ${value ? 'has-value' : ''} ${semanticLoading ? 'is-searching' : ''}`}
        onClick={() => inputRef.current?.focus()}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder="Search your brain"
          aria-label="Search your brain"
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {value
          ? <button type="button" className="global-search-clear" onClick={onClear} aria-label="Clear search">×</button>
          : <kbd>⌘K</kbd>}
      </div>

      {menuShown && value.trim() && (
        <div className={`global-search-menu${menuLeaving ? ' is-leaving' : ''}`} role="listbox">
          {results.map((node, i) => (
            <button
              key={node.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`global-search-item ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(node)}
            >
              <span className="global-search-dots">
                {nodeCategoryList(node.data).slice(0, 3).map(c => (
                  <span key={c} style={{ background: getCategoryColor(c) }} />
                ))}
              </span>
              <span className="global-search-title">{node.data.title}</span>
            </button>
          ))}
          {results.length === 0 && !semanticLoading && (
            <div className="global-search-empty">No matching memories</div>
          )}
          {semanticLoading && <div className="global-search-empty">Searching by meaning…</div>}
          <button
            type="button"
            className={`global-search-item global-search-ask ${active === results.length ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(results.length)}
            onClick={() => { setOpen(false); onAsk() }}
          >
            Ask your brain: “{value.trim()}” <span>↵</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default GlobalSearch
