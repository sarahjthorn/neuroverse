import { useMemo, useState } from 'react'
import MemoryFeed from './MemoryFeed'
import { CATEGORY_ORDER, getCategoryColor, nodeCategoryList } from '../utils/categories'
import { nodeMatchesQuery } from '../utils/nodeSearch'
import { SearchIcon } from './icons'
import './AllMemoriesView.css'

const PAGE_SIZE = 15
const DAY_MS = 24 * 60 * 60 * 1000

const TIME_FILTERS = [
  { id: 'all', label: 'All time' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' }
]

const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'az', label: 'A–Z' },
  { id: 'connected', label: 'Most connected' }
]

// The full list behind Home's "See all" - a plain, filterable list of every
// memory.
function AllMemoriesView({ nodes, edges, onSelectNode, onViewInBrain, parked = false }) {
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState(() => new Set())
  const [time, setTime] = useState('all')
  const [sort, setSort] = useState('newest')
  const [shown, setShown] = useState(PAGE_SIZE)

  const degree = useMemo(() => {
    const map = new Map()
    edges.forEach(e => {
      map.set(e.source, (map.get(e.source) || 0) + 1)
      map.set(e.target, (map.get(e.target) || 0) + 1)
    })
    return map
  }, [edges])

  // Selected categories narrow the list together: a memory has to carry
  // every one of them.
  const hasAll = (n, set) => {
    const own = nodeCategoryList(n.data)
    return [...set].every(c => own.includes(c))
  }

  // Which chips to show (any category in the brain), and each chip's count:
  // how many memories it would leave if it were added to the selection.
  const counts = useMemo(() => {
    const map = new Map()
    nodes.forEach(n => nodeCategoryList(n.data).forEach(c => map.set(c, 0)))
    nodes.filter(n => hasAll(n, categories))
      .forEach(n => nodeCategoryList(n.data).forEach(c => map.set(c, map.get(c) + 1)))
    return map
  }, [nodes, categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const cutoff = time === 'all' ? null : Date.now() - Number(time) * DAY_MS
    const list = nodes.filter(n => {
      if (q && !nodeMatchesQuery(n, q)) return false
      if (!hasAll(n, categories)) return false
      if (cutoff && (!n.data.timestamp || new Date(n.data.timestamp).getTime() < cutoff)) return false
      return true
    })
    const ts = n => n.data.timestamp || ''
    const sorters = {
      newest: (a, b) => ts(b).localeCompare(ts(a)),
      oldest: (a, b) => ts(a).localeCompare(ts(b)),
      az: (a, b) => a.data.title.localeCompare(b.data.title),
      connected: (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)
    }
    return list.sort(sorters[sort])
  }, [nodes, query, categories, time, sort, degree])

  const toggleCategory = (c) => {
    setShown(PAGE_SIZE)
    setCategories(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  const filtersActive = query || categories.size > 0 || time !== 'all'
  // What Explore's search pill shows after "View in 3D".
  const filterLabel = [
    query.trim() && `"${query.trim()}"`,
    categories.size > 0 && [...categories].join(' + '),
    time !== 'all' && TIME_FILTERS.find(t => t.id === time).label.toLowerCase()
  ].filter(Boolean).join(' · ')

  return (
    <div className={`all-memories${parked ? ' is-parked' : ''}`} aria-hidden={parked || undefined}>
      <div className="all-memories-inner">
        <div className="all-memories-head">
          <h1>All memories</h1>
          <span className="all-memories-count">
            {filtersActive ? `${filtered.length} of ${nodes.length}` : nodes.length}
          </span>
          {filtersActive && filtered.length > 0 && (
            <button
              type="button"
              className="explore-link all-memories-3d"
              onClick={() => onViewInBrain(filtered.map(n => n.id), filterLabel)}
            >
              View in 3D →
            </button>
          )}
        </div>

        <div className="all-memories-controls">
          <div className="all-memories-search">
            <SearchIcon />
            <input
              type="text"
              placeholder="Filter by words in the title, text or keywords…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE) }}
            />
          </div>
          <select value={time} onChange={(e) => { setTime(e.target.value); setShown(PAGE_SIZE) }} aria-label="Time range">
            {TIME_FILTERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div className="all-memories-chips" role="group" aria-label="Filter by category">
          {CATEGORY_ORDER.filter(c => counts.has(c)).map(c => (
            <button
              key={c}
              type="button"
              className={`all-memories-chip ${categories.has(c) ? 'is-on' : ''} ${counts.get(c) === 0 ? 'is-empty' : ''}`}
              onClick={() => toggleCategory(c)}
              aria-pressed={categories.has(c)}
            >
              <span className="all-memories-dot" style={{ background: getCategoryColor(c) }} />
              {c}
              <span className="all-memories-chip-count">{counts.get(c)}</span>
            </button>
          ))}
          {filtersActive && (
            <button
              type="button"
              className="all-memories-clear"
              onClick={() => { setQuery(''); setCategories(new Set()); setTime('all'); setShown(PAGE_SIZE) }}
            >
              Clear filters
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <p className="all-memories-empty">
            {nodes.length === 0 ? 'No memories yet.' : 'No memories match these filters.'}
          </p>
        ) : (
          <MemoryFeed nodes={filtered} onSelectNode={onSelectNode} limit={shown} presorted />
        )}

        {filtered.length > shown && (
          <button type="button" className="all-memories-more" onClick={() => setShown(n => n + PAGE_SIZE)}>
            Show more ({filtered.length - shown} left)
          </button>
        )}
      </div>
    </div>
  )
}

export default AllMemoriesView
