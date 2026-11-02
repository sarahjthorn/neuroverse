import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_ORDER, getCategoryColor } from '../utils/categories'
import WishlistPhoto from './WishlistPhoto'
import WishlistSpotlight from './WishlistSpotlight'
import { STATUS_LABELS, STATUS_RANK, isDone, needsCheckIn } from './wishlistUtils'
import './WishlistView.css'

const TABS = [
  { id: 'all', label: 'All', match: i => !isDone(i) },
  { id: 'ready', label: 'Ready to buy', match: i => i.status === 'ready' },
  { id: 'researching', label: 'Researching', match: i => i.status === 'researching' },
  { id: 'idea', label: 'Ideas', match: i => i.status === 'idea' },
  { id: 'done', label: 'Bought & dropped', match: isDone }
]

const jsonOrError = async r => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)))

function AddForm({ onAdd, onCancel }) {
  const [draft, setDraft] = useState({ name: '', why: '', link: '' })
  const [busy, setBusy] = useState(false)
  const set = key => e => setDraft(d => ({ ...d, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    setBusy(true)
    const ok = await onAdd(draft)
    setBusy(false)
    if (ok) setDraft({ name: '', why: '', link: '' })
  }

  return (
    <form className="wl-add" onSubmit={submit}>
      <input autoFocus type="text" placeholder="What is it?" value={draft.name} onChange={set('name')} aria-label="Item name" />
      <input type="text" placeholder="Why do you want it? (optional)" value={draft.why} onChange={set('why')} aria-label="Why you want it" />
      <input type="url" placeholder="Shop link (optional)" value={draft.link} onChange={set('link')} aria-label="Shop link" />
      <div className="wl-add-actions">
        <button type="button" className="wl-text-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="wl-primary" disabled={!draft.name.trim() || busy}>
          {busy ? (draft.link.trim() ? 'Fetching photo…' : 'Adding…') : 'Add to wishlist'}
        </button>
      </div>
    </form>
  )
}

const GAP = 14

// Pinterest-style: every tile its own height, picked from its name so it
// stays put between visits, and taller the more often it's come up.
function tileHeight(item) {
  const h = [...item.name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  const base = [160, 240, 320, 190, 280, 350][h % 6]
  return base + Math.min(item.mention_count - 1, 3) * 70
}

// Columns sized to the board's width; tiles go into the shortest column in
// turn, so the order (ready first, then most mentioned) still reads left to
// right, top to bottom - unlike CSS columns, which fill one column first.
function useMasonry(items) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const columns = useMemo(() => {
    const minCol = width < 600 ? 140 : 200
    const count = Math.max(2, Math.floor((width + GAP) / (minCol + GAP)))
    // Heights are tuned for ~220px columns; narrow phone columns scale down.
    const scale = Math.min(1, Math.max(0.7, (width - (count - 1) * GAP) / count / 220))
    const cols = Array.from({ length: count }, () => ({ height: 0, items: [] }))
    for (const item of items) {
      const shortest = cols.reduce((a, b) => (b.height < a.height ? b : a))
      const height = Math.round(tileHeight(item) * scale)
      shortest.items.push({ item, height })
      shortest.height += height + GAP
    }
    return cols
  }, [items, width])
  return [ref, columns]
}

function Tile({ item, height, onOpen }) {
  const stale = needsCheckIn(item)
  return (
    <button type="button" className={`wl-tile is-${item.status}`} style={{ height }} onClick={() => onOpen(item.id)}>
      <WishlistPhoto item={item} size="tile" />
      <span className="wl-tile-caption">
        <span className="wl-tile-name">{item.name}</span>
        <span className="wl-tile-sub">
          {item.categories.slice(0, 2).map(c => <span key={c} className="wl-dot" style={{ background: getCategoryColor(c) }} />)}
          {item.price || STATUS_LABELS[item.status]}
          {item.options.length > 1 && !item.options.some(o => o.chosen) && ` · ${item.options.length} options`}
        </span>
      </span>
      {item.status === 'ready' && <span className="wl-tile-flag">Ready</span>}
      {item.mention_count > 1 && <span className="wl-tile-mentions" title={`Mentioned ${item.mention_count} times`}>{item.mention_count}×</span>}
      {stale && <span className="wl-tile-flag is-stale" title="Hasn't come up in a while">Still want?</span>}
    </button>
  )
}

// Things Sarah is thinking about buying, fed mostly by Claude (the ai-brain
// MCP server's add_wishlist_item) from chats. Not graph nodes - see the
// wishlist_items table in server/services/db.js. A photo moodboard that
// opens into a one-at-a-time spotlight (WishlistSpotlight) for deciding.
function WishlistView({ nodes = [], onSelectNode }) {
  const [items, setItems] = useState(null)
  const [tab, setTab] = useState('all')
  const [categories, setCategories] = useState(() => new Set())
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    fetch('/api/wishlist').then(jsonOrError)
      .then(d => { setItems(d.items); setError(null) })
      .catch(() => setError('Couldn\'t load the wishlist - is the server running?'))
  }, [])

  const replace = updated => setItems(prev => {
    const at = prev.findIndex(i => i.id === updated.id)
    return at === -1 ? [updated, ...prev] : prev.map(i => (i.id === updated.id ? updated : i))
  })

  // Resolves to an error message, or null once saved.
  const patch = useCallback(async (id, changes) => {
    try {
      const d = await fetch(`/api/wishlist/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes)
      }).then(jsonOrError)
      replace(d.item)
      return null
    } catch (e) {
      return e.message
    }
  }, [])

  const remove = useCallback(async (id) => {
    const r = await fetch(`/api/wishlist/${id}`, { method: 'DELETE' })
    if (r.ok) setItems(prev => prev.filter(i => i.id !== id))
  }, [])

  // Resolves to an error message for the photo form, or null when saved.
  const attachPhoto = useCallback(async (id, body) => {
    try {
      const d = await fetch(`/api/wishlist/${id}/photo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(jsonOrError)
      replace(d.item)
      return null
    } catch (e) {
      return e.message
    }
  }, [])

  const add = async (draft) => {
    const post = body => fetch('/api/wishlist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    let r = await post(draft)
    if (r.status === 409) {
      const { similar = [] } = await r.json()
      const names = similar.map(i => `"${i.name}"`).join(', ')
      if (!window.confirm(`This looks like ${names}, already on your list. Add "${draft.name.trim()}" as a separate item anyway?`)) return false
      r = await post({ ...draft, force: true })
    }
    if (!r.ok) return false
    const { item } = await r.json()
    replace(item)
    setAdding(false)
    setTab('all')
    setOpenId(item.id)
    return true
  }

  const toggleCategory = c => setCategories(prev => {
    const next = new Set(prev)
    if (next.has(c)) next.delete(c)
    else next.add(c)
    return next
  })

  const tabCounts = useMemo(() => Object.fromEntries(TABS.map(t => [t.id, (items || []).filter(t.match).length])), [items])

  const inTab = useMemo(() => (items || []).filter(TABS.find(t => t.id === tab).match), [items, tab])

  const categoryCounts = useMemo(() => {
    const map = new Map()
    inTab.forEach(i => i.categories.forEach(c => map.set(c, (map.get(c) || 0) + 1)))
    return map
  }, [inTab])

  const shown = useMemo(() => inTab
    .filter(i => categories.size === 0 || i.categories.some(c => categories.has(c)))
    .sort((a, b) => tab === 'done'
      ? b.status_changed_at.localeCompare(a.status_changed_at)
      // Ready to buy first, then whatever keeps coming up.
      : (b.status === 'ready') - (a.status === 'ready') || b.mention_count - a.mention_count ||
        STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.first_mentioned.localeCompare(b.first_mentioned)),
  [inTab, categories, tab])

  const [boardRef, columns] = useMasonry(shown)

  const closeSpotlight = useCallback(() => setOpenId(null), [])

  return (
    <div className={`wishlist-view${openId ? ' is-spotlit' : ''}`}>
      <div className="wl-scroll" inert={openId ? '' : undefined}>
        <div className="wl-inner">
          <header className="wl-head">
            <div>
              <h1>Wishlist <span className="wl-count">{tabCounts.all ?? ''}</span></h1>
              <p className="wl-intro">Things you're thinking about buying. Claude adds to it when they come up in chat.</p>
            </div>
            {!adding && <button type="button" className="wl-primary" onClick={() => setAdding(true)}>+ Add something</button>}
          </header>

          {adding && <AddForm onAdd={add} onCancel={() => setAdding(false)} />}

          <nav className="wl-tabs" aria-label="Filter by status">
            {TABS.filter(t => t.id === 'all' || tabCounts[t.id] > 0).map(t => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? 'is-on' : ''}
                aria-pressed={tab === t.id}
                onClick={() => { setTab(t.id); setCategories(new Set()) }}
              >
                {t.label} <span>{tabCounts[t.id]}</span>
              </button>
            ))}
          </nav>

          {categoryCounts.size > 1 && (
            <div className="wl-chips" role="group" aria-label="Filter by category">
              {CATEGORY_ORDER.filter(c => categoryCounts.has(c)).map(c => (
                <button
                  key={c}
                  type="button"
                  className={`wl-chip${categories.has(c) ? ' is-on' : ''}`}
                  onClick={() => toggleCategory(c)}
                  aria-pressed={categories.has(c)}
                >
                  <span className="wl-dot" style={{ background: getCategoryColor(c) }} />
                  {c}
                  <span className="wl-chip-count">{categoryCounts.get(c)}</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="wl-empty">{error}</p>}
          {items && shown.length === 0 && !error && (
            <p className="wl-empty">{categories.size ? 'Nothing in these categories.' : 'Nothing here yet.'}</p>
          )}

          <div className="wl-board" ref={boardRef}>
            {columns.map((col, c) => (
              <div key={c} className="wl-col">
                {col.items.map(({ item, height }) => <Tile key={item.id} item={item} height={height} onOpen={setOpenId} />)}
              </div>
            ))}
          </div>
        </div>
      </div>

      {openId && items && (
        <WishlistSpotlight
          items={items}
          orderIds={shown.map(i => i.id)}
          startId={openId}
          nodes={nodes}
          onClose={closeSpotlight}
          onPatch={patch}
          onDelete={remove}
          onAttach={attachPhoto}
          onSelectNode={onSelectNode}
        />
      )}
    </div>
  )
}

export default WishlistView
