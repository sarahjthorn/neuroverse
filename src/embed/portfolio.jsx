import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import BrainGraph3D from '../components/BrainGraph3D'
import NodeCard3D from '../components/NodeCard3D'
import './portfolio.css'

// Portfolio embed (built by `npm run build:portfolio`, see docs/PORTFOLIO.md).
// On the host page:
//   <div data-brain-background data-snapshot="brain/snapshot.json"></div>
//   <button data-brain-explore>explore it</button>
//   <link rel="stylesheet" href="brain/brain-background.css">
//   <script defer src="brain/brain-background.js"></script>
// The background is a quiet, non-interactive "paper" render in the page's
// own inks; any [data-brain-explore] element opens the full galaxy view.

const NO_IDS = new Set()

// Resolve a CSS colour (including oklch() tokens) to hex by painting one
// pixel - THREE.Color can't parse oklch directly.
function resolveColor(cssColor, fallback) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = fallback
    ctx.fillStyle = cssColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
  } catch {
    return fallback
  }
}

function readToken(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value ? resolveColor(value, fallback) : fallback
}

function hexToRgbString(hex) {
  const clean = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16)).join(', ')
}

// Riso inks: making things (Project, Technical) in blue, curiosity
// (Interests, Research) in pink, private memories in the page's neutral.
function paperPalette() {
  const blue = readToken('--color-second', '#3f7cc4')
  const pink = readToken('--color-accent', '#f25f8c')
  const neutral = readToken('--color-neutral', '#8a7f7f')
  const rule = readToken('--color-rule', '#dcd3d3')
  const inkFor = { Project: blue, Technical: blue, Interests: pink, Research: pink }
  return {
    categoryColor: c => inkFor[c] || neutral,
    anonymousColor: neutral,
    linkRgb: hexToRgbString(rule)
  }
}

function PortfolioBrain({ snapshotUrl }) {
  const [snapshot, setSnapshot] = useState(null)
  const [exploring, setExploring] = useState(false)
  const [cardNode, setCardNode] = useState(null)
  const [focusRequest, setFocusRequest] = useState(null)
  const palette = useMemo(() => paperPalette(), [])

  useEffect(() => {
    fetch(snapshotUrl)
      .then(r => r.json())
      .then(setSnapshot)
      .catch(error => console.warn('Brain snapshot failed to load:', error))
  }, [snapshotUrl])

  useEffect(() => {
    const open = (e) => {
      e.preventDefault()
      setExploring(true)
    }
    const triggers = document.querySelectorAll('[data-brain-explore]')
    triggers.forEach(el => el.addEventListener('click', open))
    return () => triggers.forEach(el => el.removeEventListener('click', open))
  }, [])

  useEffect(() => {
    if (!exploring) return
    const onKey = (e) => { if (e.key === 'Escape' && !cardNode) setExploring(false) }
    window.addEventListener('keydown', onKey)
    document.documentElement.classList.add('brain-exploring')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('brain-exploring')
    }
  }, [exploring, cardNode])

  if (!snapshot) return null

  const publicCount = snapshot.nodes.filter(n => !n.data.anonymous).length
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]))
  const linkedTo = (id) => snapshot.edges
    .filter(e => e.source === id || e.target === id)
    .map(e => ({ ...byId.get(e.source === id ? e.target : e.source), strength: e.data.strength }))
    .filter(n => n.data && !n.data.anonymous)
    .sort((a, b) => b.strength - a.strength)

  const selectNode = (node) => {
    if (node.data.anonymous) return
    setCardNode(node)
    setFocusRequest({ id: node.id, nonce: Date.now() })
  }

  return (
    <>
      <BrainGraph3D
        nodes={snapshot.nodes}
        edges={snapshot.edges}
        visibleNodeIds={null}
        highlightNodeIds={null}
        newNodeIds={NO_IDS}
        selectedNodeId={null}
        look="paper"
        palette={palette}
        interactive={false}
        autoRotateSpeed={0.25}
      />

      {exploring && createPortal(
        <div className="brain-explore" role="dialog" aria-modal="true" aria-label="Sarah's brain, in 3D">
          <BrainGraph3D
            nodes={snapshot.nodes}
            edges={snapshot.edges}
            visibleNodeIds={null}
            highlightNodeIds={null}
            newNodeIds={NO_IDS}
            selectedNodeId={cardNode?.id ?? null}
            focusRequest={focusRequest}
            onNodeClick={selectNode}
            onBackgroundClick={() => setCardNode(null)}
          />
          <div className="brain-explore-caption">
            <strong>My brain.</strong> {publicCount} things I've built, learned or wondered about, linked by meaning
            - plus {snapshot.nodes.length - publicCount} personal ones, shown as plain stars.
            <span className="brain-explore-how">Drag to orbit · scroll to zoom · click a star</span>
          </div>
          <button type="button" className="brain-explore-close" onClick={() => setExploring(false)} aria-label="Close">
            close ×
          </button>
          {cardNode && (
            <NodeCard3D
              node={cardNode}
              connectedNodes={linkedTo(cardNode.id)}
              onSelectLinked={selectNode}
              onOpenDetails={null}
              onClose={() => setCardNode(null)}
            />
          )}
        </div>,
        document.body
      )}
    </>
  )
}

function mount() {
  document.querySelectorAll('[data-brain-background]').forEach(el => {
    if (el.dataset.brainMounted) return
    el.dataset.brainMounted = '1'
    createRoot(el).render(<PortfolioBrain snapshotUrl={el.dataset.snapshot || 'brain/snapshot.json'} />)
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  mount()
}
