import { useEffect, useState } from 'react'
import { getCategoryColor, nodeCategoryList, categoryDotBackground } from '../utils/categories'
import SmoothHeight from './SmoothHeight'
import './NodeCard3D.css'

// Only the strongest few links at first (connectedNodes arrives sorted by
// strength) - the card stays small; "+N more" expands the rest.
const MAX_LINKED = 3

function formatDate(timestamp) {
  if (!timestamp) return null
  return new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// A small read-only card for one star: categories, title, date, content and
// its strongest links (each flies the camera over). Used by the portfolio
// embed (src/embed/portfolio.jsx); the app itself uses NodeDetailsPanel,
// compact in Explore.
function NodeCard3D({ node, connectedNodes, onSelectLinked, onOpenDetails, onClose, hasReturn = false, leaving = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const categories = nodeCategoryList(node.data)
  const [showAllLinked, setShowAllLinked] = useState(false)
  useEffect(() => { setShowAllLinked(false) }, [node.id])
  const linked = showAllLinked ? connectedNodes : connectedNodes.slice(0, MAX_LINKED)
  const date = formatDate(node.data.timestamp)

  return (
    <aside
      className={`node-card-3d${hasReturn ? ' has-return' : ''}${leaving ? ' is-leaving' : ''}`}
      aria-label="Memory preview"
    >
      <div className="node-card-3d-top">
        <div className="node-card-3d-cats">
          {categories.map(c => (
            <span key={c} className="node-card-3d-cat">
              <span className="node-card-3d-dot" style={{ background: getCategoryColor(c) }} />
              {c}
            </span>
          ))}
        </div>
        <button type="button" className="node-card-3d-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <h3 className="node-card-3d-title">{node.data.title}</h3>
      {date && <div className="node-card-3d-date">{date}</div>}
      {node.data.content && <p className="node-card-3d-content">{node.data.content}</p>}

      {linked.length > 0 && (
        <div className="node-card-3d-linked">
          <div className="node-card-3d-label">Linked memories</div>
          <SmoothHeight trigger={showAllLinked}>
            <ul>
              {linked.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => onSelectLinked(n)}>
                    <span
                      className="node-card-3d-dot"
                      style={{ background: categoryDotBackground(n.data) }}
                    />
                    <span className="node-card-3d-linked-title">{n.data.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </SmoothHeight>
          {connectedNodes.length > MAX_LINKED && (
            <button type="button" className="node-card-3d-more" onClick={() => setShowAllLinked(v => !v)}>
              {showAllLinked ? 'Show fewer' : `+${connectedNodes.length - MAX_LINKED} more`}
            </button>
          )}
        </div>
      )}

      {onOpenDetails && (
        <button type="button" className="node-card-3d-details" onClick={onOpenDetails}>
          Full details & edit →
        </button>
      )}
    </aside>
  )
}

export default NodeCard3D
