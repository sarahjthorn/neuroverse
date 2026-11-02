import { getCategoryColor } from '../utils/categories'

const DAY_MS = 24 * 60 * 60 * 1000
// How long an active item can sit untouched before the page asks whether
// it's still wanted - Sarah likes to take her time, so this is a gentle
// "do you still want this?" rather than a reminder to buy.
const CHECK_IN_DAYS = 30

export const STAGES = [
  { id: 'idea', label: 'Idea' },
  { id: 'researching', label: 'Researching' },
  { id: 'ready', label: 'Ready to buy' }
]
export const STATUS_LABELS = { idea: 'Idea', researching: 'Researching', ready: 'Ready to buy', bought: 'Bought', dropped: 'Dropped' }
// Board order: closest to buying first.
export const STATUS_RANK = { ready: 0, researching: 1, idea: 2, bought: 3, dropped: 4 }

export const isDone = item => item.status === 'bought' || item.status === 'dropped'

export const daysSince = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS))

export function ageLabel(days) {
  if (days < 1) return 'today'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  return `${Math.round(days / 30)} months`
}

export const formatDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// Quiet for CHECK_IN_DAYS since it was last mentioned, moved, or confirmed.
export function needsCheckIn(item) {
  if (isDone(item)) return false
  const touched = [item.last_mentioned, item.status_changed_at, item.checked_in_at].filter(Boolean).sort().pop()
  return daysSince(touched) >= CHECK_IN_DAYS
}

// Memories sharing a keyword with the item, most shared first - the "why
// did I want this?" context (e.g. the Garmin next to the marathon memories).
export function relatedMemories(item, nodes, limit = 5) {
  const kws = new Set(item.keywords.map(k => k.toLowerCase()))
  if (kws.size === 0) return []
  return nodes
    .map(n => ({ node: n, shared: (n.data.keywords || []).filter(k => kws.has(k.toLowerCase())).length }))
    .filter(r => r.shared > 0)
    .sort((a, b) => b.shared - a.shared || (b.node.data.timestamp || '').localeCompare(a.node.data.timestamp || ''))
    .slice(0, limit)
    .map(r => r.node)
}

// Photos only appear once it's down to a specific product: Ready to buy,
// with a shop link. Everything else keeps its colour poster - a general
// stock photo of "running shoes" felt off on the board.
export const showsPhoto = item => Boolean(item.image_url && item.link && item.status === 'ready')

// Stand-in "poster" for items without a photo: their category colours.
// Each item gets its own shade, angle and glow spot from its name, so a
// board of mostly-Health items isn't seven identical pink squares.
export function posterBackground(item) {
  const [a, b = a] = (item.categories.length ? item.categories : ['default']).map(getCategoryColor)
  const h = [...item.name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
  const tint = h % 2 ? '#fff' : '#ffb38a'
  const deep = ['#1a1030', '#3a0f2a', '#0f2236', '#2b1a0a'][h % 4]
  const angle = 110 + (h % 90)
  const spotX = 10 + (h % 70)
  const spotY = 5 + ((h >> 3) % 40)
  return `radial-gradient(circle at ${spotX}% ${spotY}%, color-mix(in srgb, ${a} ${40 + (h % 30)}%, ${tint}) 0%, transparent 60%),
    linear-gradient(${angle}deg, ${a} 0%, color-mix(in srgb, ${b} ${55 + ((h >> 5) % 30)}%, ${deep}) 100%)`
}
