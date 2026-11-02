import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { getCategoryColor, nodeCategoryList, categoryDotBackground } from '../utils/categories'
import KeywordChip from './KeywordChip'
import { EditIcon, SaveIcon, TrashIcon } from './icons'
import SmoothHeight from './SmoothHeight'
import { EASE_OUT_EXPO, prefersReducedMotion } from '../utils/motion'
import './NodeDetailsPanel.css'

// Connected / backlink lists start short; the rest is one click away.
const LIST_PREVIEW = 5
// Compact (Explore) shows only the strongest few connections.
const COMPACT_LINKS = 3
// Expand / collapse: the frame glides between heights over this long, and
// the sections that appear fade up one after another.
const RESIZE_MS = 520

// A linked-memory row: category dot, title, link strength.
function LinkRow({ node, strength, onClick, reveal = false }) {
  return (
    <li className={reveal ? 'details-reveal' : undefined}>
      <button type="button" className="details-link" onClick={onClick}>
        <span className="details-dot" style={{ background: categoryDotBackground(node.data) }} />
        <span className="details-link-title">{node.data.title}</span>
        {strength != null && <span className="details-link-strength">{Math.round(strength * 100)}%</span>}
      </button>
    </li>
  )
}

// One memory, floating on the right of whichever page opened it (the brain
// behind lights up its star). Two sizes of the same panel:
// - compact (Explore, while clicking from star to star): categories, title,
//   date, content and the strongest few connections, sized to fit;
// - expanded (everywhere else, or "Full details & edit"): full height, with
//   keywords, every connection, backlinks, duplicate merging, edit, delete.
// Switching between them glides the frame's height (WAAPI) and fades the
// new sections in. It follows star clicks in Explore; "Show in Explore"
// jumps there on purpose.

function NodeDetailsPanel({
  node, onClose, onShowInExplore, onUpdate, onDelete, connectedNodes, backlinkNodes, onNavigateToNode, onViewInBrain,
  duplicateSuggestion, onResolveDuplicate, onDismissDuplicate, resolvingDuplicate,
  compact = false, onExpand, onCollapse,
  swapIn = false, leaving = false
}) {
  // Fixed at mount: the panel slides in when it opens, but switching memories
  // while it's open (it remounts per node) only cross-fades the contents.
  const [entry] = useState(swapIn ? ' is-swapping-in' : '')
  const panelRef = useRef(null)

  // Expand / collapse: measure the frame before and after React swaps the
  // contents, then glide between the two heights. `is-resizing` staggers
  // the sections that just appeared (CSS). Only on a change of size, never
  // at mount - opening still slides in, switching memories cross-fades.
  const lastHeight = useRef(null)
  const lastCompact = useRef(compact)
  useLayoutEffect(() => {
    const el = panelRef.current
    const height = el.getBoundingClientRect().height
    const from = lastHeight.current
    const changed = lastCompact.current !== compact
    lastHeight.current = height
    lastCompact.current = compact
    if (!changed || from == null || prefersReducedMotion() || Math.abs(from - height) < 2) return
    el.classList.add(compact ? 'is-collapsing' : 'is-expanding')
    const anim = el.animate(
      [{ height: `${from}px` }, { height: `${height}px` }],
      { duration: RESIZE_MS, easing: EASE_OUT_EXPO }
    )
    anim.onfinish = anim.oncancel = () => el.classList.remove('is-expanding', 'is-collapsing')
    return () => anim.cancel()
  }, [compact])
  // Keep the "before" height current as the contents change size on their
  // own (show all connections, editing...).
  useEffect(() => {
    const el = panelRef.current
    const observer = new ResizeObserver(() => {
      if (!el.getAnimations().length) lastHeight.current = el.getBoundingClientRect().height
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const [isEditing, setIsEditing] = useState(false)
  const [editedTitle, setEditedTitle] = useState(node.data.title)
  const [editedContent, setEditedContent] = useState(node.data.content)
  const [editedKeywords, setEditedKeywords] = useState(node.data.keywords || [])
  const [keywordDraft, setKeywordDraft] = useState('')
  const [editedCategories, setEditedCategories] = useState(
    node.data.categories?.length > 0 ? node.data.categories : [node.data.category].filter(Boolean)
  )
  const [approvedCategories, setApprovedCategories] = useState([])
  const [showAllConnected, setShowAllConnected] = useState(false)
  const [showAllBacklinks, setShowAllBacklinks] = useState(false)

  // Categories are constrained to the approved taxonomy (unlike keywords,
  // which are free text) - the server rejects anything else - so the picker
  // needs the live approved list, fetched lazily once editing actually starts.
  useEffect(() => {
    if (!isEditing || approvedCategories.length > 0) return
    fetch('/api/categories')
      .then(res => res.json())
      .then(rows => setApprovedCategories(rows.map(r => r.name).sort()))
      .catch(err => console.error('Failed to load categories:', err))
  }, [isEditing, approvedCategories.length])

  const resetDrafts = () => {
    setEditedTitle(node.data.title)
    setEditedContent(node.data.content)
    setEditedKeywords(node.data.keywords || [])
    setKeywordDraft('')
    setEditedCategories(node.data.categories?.length > 0 ? node.data.categories : [node.data.category].filter(Boolean))
  }

  const toggleCategory = (name) => {
    setEditedCategories(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    )
  }

  const addKeyword = () => {
    const term = keywordDraft.trim()
    if (!term) return
    if (editedKeywords.some(k => k.toLowerCase() === term.toLowerCase())) {
      setKeywordDraft('')
      return
    }
    setEditedKeywords([...editedKeywords, term])
    setKeywordDraft('')
  }

  const removeKeyword = (term) => {
    setEditedKeywords(editedKeywords.filter(k => k !== term))
  }

  const handleSave = () => {
    if (editedCategories.length === 0) {
      alert('Pick at least one category before saving.')
      return
    }
    onUpdate(node.id, {
      data: {
        ...node.data,
        title: editedTitle,
        content: editedContent,
        keywords: editedKeywords,
        categories: editedCategories
      }
    })
    setIsEditing(false)
  }

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this memory?')) {
      onDelete(node.id)
    }
  }

  // Section order for the staggered fade-in when expanding.
  let reveal = 0
  const revealStyle = () => ({ '--reveal-i': reveal++ })

  useEffect(() => {
    if (isEditing) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isEditing, onClose])

  const formatDate = (timestamp) => {
    if (!timestamp) return null
    return new Date(timestamp).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  const created = formatDate(node.data.timestamp)

  return (
    <aside
      ref={panelRef}
      className={`node-details-panel${entry}${compact ? ' is-compact' : ''}${leaving ? ' is-leaving' : ''}${isEditing ? ' is-editing' : ''}`}
      aria-label="Memory details"
      aria-hidden={leaving || undefined}
    >
      <div className="details-header">
        <span className="details-kicker">{isEditing ? 'Editing memory' : 'Memory'}</span>
        <div className="details-header-actions">
          {onShowInExplore && !isEditing && (
            <button type="button" className="details-explore" onClick={onShowInExplore}>
              Show in Explore →
            </button>
          )}
          {/* Explore only: one chevron toggles the size - ^ shrinks it, v
              (the same icon, turned over) grows it back. */}
          {onCollapse && !isEditing && (
            <button
              type="button"
              className={`details-collapse${compact ? ' is-flipped' : ''}`}
              onClick={compact ? onExpand : onCollapse}
              aria-label={compact ? 'Show more' : 'Show less'}
              title={compact ? 'Show more' : 'Show less'}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
            </button>
          )}
          <button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>

      <div className="details-content">
        {!isEditing ? (
          <>
            <div className="details-cats">
              {nodeCategoryList(node.data).map(category => (
                <span key={category} className="details-cat">
                  <span className="details-dot" style={{ background: getCategoryColor(category) }} />
                  {category}
                </span>
              ))}
            </div>
            <h3 className="node-detail-title">{node.data.title}</h3>
            {created && <div className="details-date">{created}</div>}
            {node.data.content && <p className="node-detail-content">{node.data.content}</p>}

            {!compact && duplicateSuggestion && (() => {
              const [otherId, otherTitle] = duplicateSuggestion.existingId === node.id
                ? [duplicateSuggestion.duplicateId, duplicateSuggestion.duplicateTitle]
                : [duplicateSuggestion.existingId, duplicateSuggestion.existingTitle]
              const pairKey = [duplicateSuggestion.existingId, duplicateSuggestion.duplicateId].sort().join('|')
              return (
                <div className="detail-section duplicate-suggestion details-reveal" style={revealStyle()}>
                  <p>
                    This looks like a near-duplicate of{' '}
                    <button type="button" className="duplicate-suggestion-link" onClick={() => onNavigateToNode(otherId)}>
                      {otherTitle}
                    </button>{' '}
                    {duplicateSuggestion.source === 'claude'
                      ? '(Claude thinks these say the same thing).'
                      : `(${Math.round(duplicateSuggestion.score * 100)}% match).`}{' '}
                    Merge them into one? The memory you keep gets the other's keywords
                    and categories; the other's text is removed.
                  </p>
                  {duplicateSuggestion.reason && (
                    <p className="duplicate-suggestion-reason">{duplicateSuggestion.reason}</p>
                  )}
                  <div className="duplicate-suggestion-actions">
                    <button
                      type="button"
                      className="save-button"
                      disabled={resolvingDuplicate}
                      onClick={() => onResolveDuplicate(node.id, otherId)}
                    >
                      Keep this one
                    </button>
                    <button
                      type="button"
                      className="save-button"
                      disabled={resolvingDuplicate}
                      onClick={() => onResolveDuplicate(otherId, node.id)}
                    >
                      Keep the other
                    </button>
                    <button
                      type="button"
                      className="cancel-button"
                      disabled={resolvingDuplicate}
                      onClick={() => onDismissDuplicate(pairKey)}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              )
            })()}

            {!compact && node.data.keywords && node.data.keywords.length > 0 && (
              <div className="detail-section details-reveal" style={revealStyle()}>
                <label>Keywords</label>
                <div className="keywords-list">
                  {node.data.keywords.map((keyword) => (
                    <KeywordChip
                      key={keyword}
                      term={keyword}
                      currentNodeId={node.id}
                      onNavigateToNode={onNavigateToNode}
                    />
                  ))}
                </div>
              </div>
            )}

            {connectedNodes && connectedNodes.length > 0 && (
              <div className="detail-section">
                <div className="details-links-head">
                  <label>Connected memories · {connectedNodes.length}</label>
                  {onViewInBrain && (
                    <button
                      type="button"
                      className="explore-link details-links-3d"
                      onClick={() => onViewInBrain([node.id, ...connectedNodes.map(n => n.id)], `Links: ${node.data.title}`)}
                      title="Light up this memory and everything it's linked to"
                    >
                      See in 3D
                    </button>
                  )}
                </div>
                <SmoothHeight trigger={showAllConnected}>
                  <ul className="details-links">
                    {(compact ? connectedNodes.slice(0, COMPACT_LINKS) : showAllConnected ? connectedNodes : connectedNodes.slice(0, LIST_PREVIEW)).map((connected, i) => (
                      <LinkRow
                        key={connected.id}
                        node={connected}
                        strength={connected.strength}
                        onClick={() => onNavigateToNode(connected.id)}
                        reveal={i >= COMPACT_LINKS}
                      />
                    ))}
                  </ul>
                </SmoothHeight>
                {!compact && connectedNodes.length > LIST_PREVIEW && (
                  <button type="button" className="show-more-button" onClick={() => setShowAllConnected(v => !v)}>
                    {showAllConnected ? 'Show fewer' : `Show all ${connectedNodes.length}`}
                  </button>
                )}
              </div>
            )}

            {/* Phase B: a literal "referenced by" list, separate from the
                strength-sorted "related to" one above - see App.jsx for what
                counts as a backlink here. */}
            {!compact && backlinkNodes && backlinkNodes.length > 0 && (
              <div className="detail-section details-reveal" style={revealStyle()}>
                <label>Referenced by · {backlinkNodes.length}</label>
                <SmoothHeight trigger={showAllBacklinks}>
                  <ul className="details-links">
                    {(showAllBacklinks ? backlinkNodes : backlinkNodes.slice(0, LIST_PREVIEW)).map((backlink) => (
                      <LinkRow
                        key={backlink.id}
                        node={backlink}
                        onClick={() => onNavigateToNode(backlink.id)}
                      />
                    ))}
                  </ul>
                </SmoothHeight>
                {backlinkNodes.length > LIST_PREVIEW && (
                  <button type="button" className="show-more-button" onClick={() => setShowAllBacklinks(v => !v)}>
                    {showAllBacklinks ? 'Show fewer' : `Show all ${backlinkNodes.length}`}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="detail-section">
              <label>Categories</label>
              <div className="categories-picker">
                {(approvedCategories.length > 0 ? approvedCategories : editedCategories).map(name => {
                  const active = editedCategories.includes(name)
                  const color = getCategoryColor(name)
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`category-toggle ${active ? 'active' : ''}`}
                      style={active ? {
                        color,
                        borderColor: color,
                        backgroundColor: `${color}20`
                      } : undefined}
                      onClick={() => toggleCategory(name)}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
              {approvedCategories.length === 0 && (
                <p className="categories-loading">Loading categories...</p>
              )}
            </div>

            <div className="detail-section">
              <label>Title</label>
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="edit-input"
              />
            </div>

            <div className="detail-section">
              <label>Content</label>
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="edit-textarea"
                rows={6}
              />
            </div>

            <div className="detail-section">
              <label>Keywords</label>
              <div className="keywords-list">
                {editedKeywords.map((keyword, idx) => (
                  <span key={idx} className="keyword-chip editable-keyword-chip">
                    {keyword}
                    <button
                      type="button"
                      className="remove-keyword-button"
                      onClick={() => removeKeyword(keyword)}
                      aria-label={`Remove ${keyword}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="add-keyword-row">
                <input
                  type="text"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addKeyword()
                    }
                  }}
                  placeholder="Add a keyword..."
                  className="edit-input"
                />
                <button type="button" className="add-keyword-button" onClick={addKeyword}>
                  Add
                </button>
              </div>
            </div>

          </>
        )}
      </div>

      {compact ? (
        <div className="details-footer details-footer-compact">
          <button type="button" className="details-expand" onClick={onExpand}>
            Full details &amp; edit
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
          </button>
        </div>
      ) : !isEditing ? (
        <div className="details-footer details-reveal" style={revealStyle()}>
          <button type="button" className="edit-button" onClick={() => {
            // The node can change while the panel stays open (e.g. a merge
            // adds categories), so start the drafts from what's shown now.
            resetDrafts()
            setIsEditing(true)
          }}>
            <EditIcon /> Edit
          </button>
          <button type="button" className="delete-button" onClick={handleDelete}>
            <TrashIcon /> Delete
          </button>
        </div>
      ) : (
        <div className="details-footer">
          <button
            className="save-button"
            onClick={handleSave}
          >
            <SaveIcon /> Save
          </button>
          <button
            className="cancel-button"
            onClick={() => {
              resetDrafts()
              setIsEditing(false)
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </aside>
  )
}

export default NodeDetailsPanel
