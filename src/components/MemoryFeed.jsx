import { getCategoryColor } from '../utils/categories'
import './MemoryFeed.css'

function relativeTime(timestamp) {
  const diffMs = Date.now() - new Date(timestamp).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Home's daily-use feed - richer cards than a compact list row
// (full content snippet + keyword chips), since this is the primary thing a
// returning user scans, not a sidebar accordion squeezed for space.
// `presorted` skips the newest-first sort, for callers (All memories) that
// already filtered and ordered the list themselves.
function MemoryFeed({ nodes, onSelectNode, limit = 40, presorted = false }) {
  if (nodes.length === 0) {
    return (
      <div className="memory-feed-empty">
        <p>No memories yet.</p>
        <p className="memory-feed-empty-hint">Connect Claude Desktop or add a conversation to get started.</p>
      </div>
    )
  }

  const recent = (presorted
    ? nodes
    : [...nodes]
      .filter(n => n.data.timestamp)
      .sort((a, b) => b.data.timestamp.localeCompare(a.data.timestamp))
  ).slice(0, limit)

  return (
    <div className="memory-feed">
      {recent.map(node => {
        const categories = node.data.categories?.length > 0 ? node.data.categories : [node.data.category].filter(Boolean)
        return (
          <button key={node.id} type="button" className="memory-card" onClick={() => onSelectNode(node)}>
            <div className="memory-card-top">
              <span className="memory-card-categories">
                {categories.length === 0 && <span className="memory-card-category">Uncategorized</span>}
                {categories.map(c => (
                  <span key={c} className="memory-card-category" style={{ color: getCategoryColor(c) }}>
                    <span className="memory-card-dot" style={{ background: getCategoryColor(c) }} />
                    {c}
                  </span>
                ))}
              </span>
              {node.data.timestamp && <span className="memory-card-time">{relativeTime(node.data.timestamp)}</span>}
            </div>
            <div className="memory-card-title">{node.data.title}</div>
            {node.data.content && <div className="memory-card-content">{node.data.content}</div>}
            {node.data.keywords?.length > 0 && (
              <div className="memory-card-keywords">
                {node.data.keywords.slice(0, 4).map(k => (
                  <span key={k} className="memory-card-chip">{k}</span>
                ))}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default MemoryFeed
