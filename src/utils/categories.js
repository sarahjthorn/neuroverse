// Category colours and helpers shared by every view.

// One colour per category, tuned so every pair stays distinguishable
// (OKLab ΔE >= 15 for all 66 pairs): 12 categories can't all get their own
// hue, so neighbours on the colour wheel are split by lightness instead
// (e.g. Career light sky vs Project deep blue). Re-check with a ΔE script
// before changing any of these. `default` is only
// a defensive fallback - none of the 12 real categories should ever hit it.
const CATEGORY_COLORS = {
  Career: '#56b7fc',
  Personal: '#e64249',
  Health: '#fe7fad',
  Research: '#84ebff',
  Travel: '#ffd43b',
  Financial: '#12d2a0',
  Project: '#2e80fc',
  Interests: '#2b8a3e',
  Technical: '#ae85fe',
  Relationships: '#f3beff',
  Preferences: '#ff8c1a',
  Mind: '#9c36b5',
  default: '#9a9a9e'
}

// Fixed order for anywhere a stable category ordering is useful.
export const CATEGORY_ORDER = [
  'Career', 'Personal', 'Health', 'Research', 'Travel', 'Financial',
  'Project', 'Interests', 'Technical', 'Relationships', 'Preferences',
  'Mind'
]

export function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.default
}

// Nodes carry either a `categories` array or a single legacy `category`
// string - this normalizes either shape to a non-empty array.
export function nodeCategoryList(data) {
  return (data?.categories?.length ? data.categories : [data?.category]).filter(Boolean)
}

// A memory's dot: one colour, or a split dot with one band per category -
// the same "every category shows" rule as the striped 3D stars. Use as a
// CSS `background`.
export function categoryDotBackground(data) {
  const colors = nodeCategoryList(data).map(getCategoryColor)
  if (colors.length <= 1) return colors[0] || getCategoryColor('default')
  const step = 100 / colors.length
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`
}

function hexToRgbTuple(hex) {
  const clean = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(clean.slice(i, i + 2), 16))
}

// Edge colour (BrainGraph3D.jsx): a same-category edge stays the
// graph's neutral theme color - expected, not interesting - but an edge
// bridging two nodes that share no category gets tinted toward both
// endpoints' category colors instead, so a genuinely cross-domain
// connection reads as visually distinct at a glance rather than looking
// identical to every other edge. Returns null (caller falls back to the
// neutral theme color) when the pair shares a category.
export function categoryBridgeRgb(dataA, dataB) {
  const catsA = nodeCategoryList(dataA)
  const catsB = nodeCategoryList(dataB)
  const setA = new Set(catsA)
  if (catsB.some(c => setA.has(c))) return null

  const [ar, ag, ab] = hexToRgbTuple(getCategoryColor(catsA[0]))
  const [br, bg, bb] = hexToRgbTuple(getCategoryColor(catsB[0]))
  return `${Math.round((ar + br) / 2)}, ${Math.round((ag + bg) / 2)}, ${Math.round((ab + bb) / 2)}`
}
