import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import './KeywordChip.css'

function KeywordChip({ term, currentNodeId, onNavigateToNode }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draftDescription, setDraftDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const popoverRef = useRef(null)

  useEffect(() => {
    setOpen(false)
    setInfo(null)
    setEditing(false)
    setDraftDescription('')
  }, [term])

  // The popover hangs off the chip's left edge, so a chip near the right of
  // the panel would push it past the panel's edge and make the panel scroll
  // sideways. Nudge it left (or right) so it stays inside its scroll container.
  useLayoutEffect(() => {
    const pop = popoverRef.current
    if (!open || !pop) return
    pop.style.transform = ''
    let container = pop.parentElement
    while (container && container !== document.body) {
      const { overflowX, overflowY } = getComputedStyle(container)
      if (/(auto|scroll|hidden)/.test(overflowX + overflowY)) break
      container = container.parentElement
    }
    const bounds = (container || document.body).getBoundingClientRect()
    const rect = pop.getBoundingClientRect()
    const margin = 8
    let shift = 0
    if (rect.right > bounds.right - margin) shift = bounds.right - margin - rect.right
    if (rect.left + shift < bounds.left + margin) shift = bounds.left + margin - rect.left
    if (shift) pop.style.transform = `translateX(${shift}px)`
  }, [open, loading, info, editing])

  const fetchInfo = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/keywords/${encodeURIComponent(term)}`)
      const data = await response.json()
      setInfo(data)
      setDraftDescription(data.description || '')
    } catch (error) {
      console.error('Failed to load keyword info:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    setEditing(false)
    if (next && !info) fetchInfo()
  }

  const saveDescription = async () => {
    setSaving(true)
    try {
      await fetch(`/api/keywords/${encodeURIComponent(term)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: draftDescription })
      })
      // Re-fetch (not just use the PATCH response) so the auto-derive
      // fallback for whichever field wasn't just touched still applies -
      // e.g. saving only the description shouldn't make the defining-node
      // link disappear from view.
      await fetchInfo()
      setEditing(false)
    } catch (error) {
      console.error('Failed to save keyword description:', error)
    } finally {
      setSaving(false)
    }
  }

  const setAsDefinition = async () => {
    setSaving(true)
    try {
      await fetch(`/api/keywords/${encodeURIComponent(term)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definingNodeId: currentNodeId })
      })
      await fetchInfo()
    } catch (error) {
      console.error('Failed to set defining node:', error)
    } finally {
      setSaving(false)
    }
  }

  // null = a plain concept; otherwise one of info.entityKinds. Saved as
  // Sarah's choice, which extraction never overrides.
  const saveKind = async (kind) => {
    setSaving(true)
    try {
      await fetch(`/api/keywords/${encodeURIComponent(term)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind })
      })
      await fetchInfo()
    } catch (error) {
      console.error('Failed to save keyword type:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="keyword-chip-wrapper">
      <button type="button" className="keyword-chip" onClick={handleToggle}>
        {term}
      </button>

      {open && (
        <div className="keyword-popover" ref={popoverRef}>
          {loading && <p className="keyword-popover-loading">Loading...</p>}

          {!loading && info && !editing && (
            <>
              <p className="keyword-popover-description">
                {info.description || 'No description yet.'}
                {info.autoDerived && <span className="keyword-popover-tag"> (auto)</span>}
              </p>

              <label className="keyword-popover-kind">
                <span>Type</span>
                <select
                  value={info.kind || ''}
                  onChange={e => saveKind(e.target.value || null)}
                  disabled={saving}
                >
                  <option value="">Concept</option>
                  {(info.entityKinds || []).map(kind => (
                    <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>
                  ))}
                </select>
                {info.kind && info.kindSource === 'model' && <span className="keyword-popover-tag">(auto)</span>}
              </label>

              {info.aliases?.length > 0 && (
                <p className="keyword-popover-aliases">Also called {info.aliases.join(', ')}</p>
              )}

              {info.definingNode && (
                <button
                  type="button"
                  className="keyword-popover-link"
                  onClick={() => onNavigateToNode(info.definingNode.id)}
                >
                  → {info.definingNode.title}
                </button>
              )}

              <div className="keyword-popover-actions">
                <button type="button" onClick={() => setEditing(true)}>Edit description</button>
                {currentNodeId && (!info.definingNode || info.definingNode.id !== currentNodeId) && (
                  <button type="button" onClick={setAsDefinition} disabled={saving}>
                    Set this memory as definition
                  </button>
                )}
              </div>
            </>
          )}

          {!loading && editing && (
            <div className="keyword-popover-edit">
              <textarea
                value={draftDescription}
                onChange={e => setDraftDescription(e.target.value)}
                rows={3}
                placeholder="What does this keyword mean?"
              />
              <div className="keyword-popover-actions">
                <button type="button" onClick={saveDescription} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

export default KeywordChip
