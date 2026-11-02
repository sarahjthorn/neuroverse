import { useEffect } from 'react'
import './NodeCard3D.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Opened by clicking a comet in 3D - same floating card as a memory's, but
// for one saved weekly digest.
function DigestCard3D({ digest, onClose, memoryIds = [], onViewInBrain, hasReturn = false, leaving = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className={`node-card-3d${hasReturn ? ' has-return' : ''}${leaving ? ' is-leaving' : ''}`} aria-label="Weekly digest">
      <div className="node-card-3d-top">
        <div className="node-card-3d-cats">
          <span className="node-card-3d-cat">
            <span className="node-card-3d-dot" style={{ background: '#bfe9ff' }} />
            Weekly digest · comet
          </span>
        </div>
        <button type="button" className="node-card-3d-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <h3 className="node-card-3d-title">{formatDate(digest.period_start)} – {formatDate(digest.period_end)}</h3>
      <div className="node-card-3d-date">
        {memoryIds.length > 0 && onViewInBrain ? (
          <button
            type="button"
            className="explore-link"
            onClick={() => onViewInBrain(memoryIds, `Digest · ${formatDate(digest.period_start)} – ${formatDate(digest.period_end)}`)}
            title="Light up that week's memories"
          >
            {digest.memory_count} memories that week
          </button>
        ) : <>{digest.memory_count} memories that week</>}
      </div>
      <p className="node-card-3d-content node-card-3d-content-full">{digest.text}</p>
    </aside>
  )
}

export default DigestCard3D
