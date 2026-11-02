// Builds the public, redacted snapshot of the brain that the portfolio
// background loads (see docs/PORTFOLIO.md). Reads the local database only -
// no API calls, no cost.
//
//   npm run export:portfolio                      (to config.outputDir)
//   node scripts/export-portfolio-snapshot.js <dir>   (somewhere else)
//
// Privacy rules, all applied here at export time (nothing private is ever
// written to the file and hidden later in the browser):
// - A memory is PUBLIC only if every one of its categories is in
//   `publicCategories`. One private category (e.g. Project + Health) makes
//   the whole memory private, since its text could be about either.
// - `conditionalCategories` lets a category through only in company:
//   `with` - alongside one of these categories (Preferences + Interests is
//   a taste worth showing; Preferences + Project is a build detail);
//   `timeline` - when the memory matches a timeline row, so Career shows
//   for roles listed on the page and nothing else.
// - It also has to be on or before `reviewedThrough`. Anything newer is held
//   back as private until you've read its title in the review file and moved
//   the date on, so a new memory can't go public without you seeing it.
// - `hideIds` and `hidePatterns` (matched against the title, text and
//   keywords) force a memory private even if it passes the rules above.
// - PUBLIC memories keep their title, categories and date. Their content
//   is left out unless `includeContent` is true.
// - Everything else becomes a PRIVATE star: no title, text, keywords or
//   date. It keeps its categories (so the brain's colours stay true), except
//   any in `maskOnPrivate`, which are dropped entirely.
// - Tags (`tags.projects`, `tags.timeline`, `tags.topics`) are matched
//   against every memory's full text here, and only the tag ids are written.
//   Projects and timeline rows can light private stars; topics are public
//   memories only, because the page lists their titles.
// - When several memories share a title, only the newest is public.
// - Real memory ids are replaced with sequential ones, in time order.
// - Positions are worked out here (the page just draws them), and links are
//   trimmed to each memory's strongest `maxLinksPerNode`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { loadGraph } from '../server/services/storage.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'scripts/portfolio-snapshot.config.json')
if (!existsSync(configPath)) {
  console.error('No scripts/portfolio-snapshot.config.json yet. Copy scripts/portfolio-snapshot.config.example.json to it and edit it first.')
  process.exit(1)
}
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const outputDir = resolve(root, process.argv[2] || config.outputDir)
const publicCategories = new Set(config.publicCategories)
const conditional = config.conditionalCategories || {}
const maskOnPrivate = new Set(config.maskOnPrivate || [])
const hideIds = new Set((config.hideIds || []).map(h => typeof h === 'string' ? h : h.id))
const reviewedThrough = config.reviewedThrough || null
const maxLinks = config.maxLinksPerNode || Infinity
const tags = config.tags || {}

// "neuroverse" matches the word (or its plural) anywhere; "/regex/" is used
// as written. Both ignore case.
function matcher(patterns = []) {
  const res = patterns.map(p => p.startsWith('/') && p.endsWith('/')
    ? new RegExp(p.slice(1, -1), 'i')
    : new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?($|[^a-z0-9])`, 'i'))
  return text => res.some(re => re.test(text))
}
const hidden = matcher(config.hidePatterns)
const projectRules = Object.entries(tags.projects || {}).map(([id, p]) => [id, matcher(p)])
const timelineRules = (tags.timeline || []).map(p => p.length ? matcher(p) : null)
const topicRules = Object.entries(tags.topics || {}).map(([id, t]) => [id, matcher(t.match)])

const graph = loadGraph()
const nodes = [...graph.nodes].sort((a, b) => (a.data.timestamp || '').localeCompare(b.data.timestamp || ''))

// Two memories with the same title would show up twice in the page's lists,
// so only the newest keeps its title; older ones become private stars.
const newestByTitle = new Map(nodes.map(n => [n.data.title.trim().toLowerCase(), n.id]))

const idMap = new Map()
const review = { public: [], held: [], hiddenId: [], hiddenPattern: [], duplicate: [] }
const tagCounts = {}
const count = key => { tagCounts[key] = (tagCounts[key] || 0) + 1 }

const snapshotNodes = nodes.map((node, i) => {
  const id = `m${i + 1}`
  idMap.set(node.id, id)
  const d = node.data
  const categories = d.categories?.length ? d.categories : [d.category].filter(Boolean)
  const text = [d.title, d.content, ...(d.keywords || [])].join(' \n ')
  const day = d.timestamp ? d.timestamp.slice(0, 10) : null
  const entry = { title: d.title, categories, day, realId: node.id }

  const projects = projectRules.filter(([, m]) => m(text)).map(([pid]) => pid)
  const timeline = timelineRules.map((m, ti) => m && m(text) ? ti : -1).filter(ti => ti >= 0)

  const allowed = c => {
    if (publicCategories.has(c)) return true
    const rule = conditional[c]
    if (!rule) return false
    return (rule.with || []).some(w => categories.includes(w)) || (rule.timeline && timeline.length > 0)
  }
  let isPublic = categories.length > 0 && categories.every(allowed)
  if (isPublic && hideIds.has(node.id)) { isPublic = false; review.hiddenId.push(entry) }
  else if (isPublic && hidden(text)) { isPublic = false; review.hiddenPattern.push(entry) }
  else if (isPublic && newestByTitle.get(d.title.trim().toLowerCase()) !== node.id) { isPublic = false; review.duplicate.push(entry) }
  else if (isPublic && reviewedThrough && (!day || day > reviewedThrough)) { isPublic = false; review.held.push(entry) }
  else if (isPublic) review.public.push(entry)

  const topics = isPublic ? topicRules.filter(([, m]) => m(text)).map(([tid]) => tid) : []
  projects.forEach(p => count(`project ${p}`))
  timeline.forEach(t => count(`timeline row ${t}`))
  topics.forEach(t => count(`topic ${t}`))
  const tagFields = {
    ...(projects.length ? { projects } : {}),
    ...(timeline.length ? { timeline } : {}),
    ...(topics.length ? { topics } : {})
  }

  if (!isPublic) {
    const shown = categories.filter(c => !maskOnPrivate.has(c))
    return { id, data: { anonymous: true, categories: shown, ...tagFields } }
  }
  return {
    id,
    data: {
      title: d.title,
      categories,
      timestamp: day,
      ...(config.includeContent ? { content: d.content } : {}),
      ...tagFields
    }
  }
})

// Keep an edge if it's one of the strongest `maxLinksPerNode` for either end.
const allEdges = graph.edges
  .filter(e => idMap.has(e.source) && idMap.has(e.target) && e.source !== e.target)
  .map(e => ({ source: idMap.get(e.source), target: idMap.get(e.target), strength: Math.round((e.data?.strength ?? 0.6) * 100) / 100 }))
const byNode = new Map()
allEdges.forEach((e, i) => [e.source, e.target].forEach(n => (byNode.get(n) || byNode.set(n, []).get(n)).push(i)))
const keep = new Set()
for (const list of byNode.values()) {
  list.sort((a, b) => allEdges[b].strength - allEdges[a].strength).slice(0, maxLinks).forEach(i => keep.add(i))
}
const snapshotEdges = allEdges
  .filter((_, i) => keep.has(i))
  .map(e => ({ source: e.source, target: e.target, data: { strength: e.strength } }))

layout(snapshotNodes, snapshotEdges)

const snapshot = {
  generatedAt: new Date().toISOString().slice(0, 10),
  publicCategories: [...publicCategories],
  // Which tag sets the page should trust over its own keyword fallback.
  tagSets: {
    projects: projectRules.map(([id]) => id),
    timeline: timelineRules.map((m, i) => m ? i : -1).filter(i => i >= 0),
    topics: Object.entries(tags.topics || {}).map(([id, t]) => ({ id, label: t.label }))
  },
  nodes: snapshotNodes,
  edges: snapshotEdges
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, 'snapshot.json'), JSON.stringify(snapshot))

// A human-readable list of exactly what's public, for review before you
// publish. Copy a realId into `hideIds` to make one private.
const line = p => `- ${p.title}  [${p.categories.join(', ')}]  ${p.day || ''}  (${p.realId})`
const byTitle = list => [...list].sort((a, b) => a.title.localeCompare(b.title)).map(line)
const anonymous = snapshotNodes.length - review.public.length
const reviewText = [
  `Portfolio snapshot - ${snapshot.generatedAt}`,
  `${review.public.length} public memories (title + categories + date${config.includeContent ? ' + content' : ''}), ${anonymous} private stars, ${snapshotEdges.length} of ${allEdges.length} links.`,
  '',
  `## Held for review: newer than reviewedThrough (${reviewedThrough}) - ${review.held.length}`,
  'Read these titles, hide any you don\'t want shown, then move reviewedThrough on.',
  ...byTitle(review.held),
  '',
  `## Public - ${review.public.length}`,
  ...byTitle(review.public),
  '',
  `## Hidden by hidePatterns - ${review.hiddenPattern.length}`,
  ...byTitle(review.hiddenPattern),
  '',
  `## Hidden by hideIds - ${review.hiddenId.length}`,
  ...byTitle(review.hiddenId),
  '',
  `## Older duplicates of a newer title - ${review.duplicate.length}`,
  'Worth merging in Tidy up.',
  ...byTitle(review.duplicate),
  '',
  '## Tags (public and private memories)',
  ...Object.entries(tagCounts).sort().map(([k, n]) => `- ${k}: ${n}`)
].join('\n')
writeFileSync(join(root, 'scripts/portfolio-snapshot.review.txt'), reviewText + '\n')

console.log(`Wrote ${join(outputDir, 'snapshot.json')}`)
console.log(`${review.public.length} public, ${anonymous} private (${review.held.length} held for review), ${snapshotEdges.length} links`)
console.log('Review what is public in scripts/portfolio-snapshot.review.txt before publishing.')

// Force layout, run once here so the page doesn't have to. Same model as the
// design prototype: repulsion, springs on links, a pull toward each
// category's anchor (shown categories only, so a masked category doesn't
// move a star toward where it would be) and a little gravity.
function layout(nodes, edges) {
  const A = { Project: [0.3, -0.3, 0], Technical: [-0.15, -0.4, 0.1], Interests: [-0.3, 0.35, -0.1], Research: [0.3, 0.35, 0.15], Career: [0.55, -0.05, -0.2], Personal: [-0.55, -0.05, 0.2], Health: [-0.5, -0.4, -0.25], Relationships: [-0.45, 0.6, 0.2], Mind: [0.05, 0.65, -0.3], Travel: [0.6, 0.5, -0.1], Financial: [0.55, -0.55, 0.25], Preferences: [-0.1, 0.05, 0.55] }
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const N = nodes.map(n => {
    const cats = n.data.categories || []
    const anc = cats.length ? [0, 1, 2].map(k => cats.reduce((s, c) => s + (A[c] || [0, 0, 0])[k], 0) / cats.length) : null
    return { pub: !n.data.anonymous, anc, x: (rnd() - 0.5) * 0.6, y: (rnd() - 0.5) * 0.6, z: (rnd() - 0.5) * 0.6, vx: 0, vy: 0, vz: 0 }
  })
  const E = edges.map(e => [index.get(e.source), index.get(e.target), e.data.strength])
  const steps = 320
  for (let it = 0; it < steps; it++) {
    const cool = 1 - it / steps
    for (let i = 0; i < N.length; i++) {
      const a = N[i]
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j]
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
        const f = (a.pub && b.pub ? 0.0016 : 0.0006) / Math.max(dx * dx + dy * dy + dz * dz, 0.0004)
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f
        b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f
      }
    }
    for (const [ai, bi, st] of E) {
      const a = N[ai], b = N[bi]
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 0.001
      const f = (d - 0.18) * 0.04 * st / d
      a.vx += dx * f; a.vy += dy * f; a.vz += dz * f
      b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f
    }
    for (const n of N) {
      if (n.anc) { n.vx += (n.anc[0] - n.x) * 0.006; n.vy += (n.anc[1] - n.y) * 0.006; n.vz += (n.anc[2] - n.z) * 0.006 }
      n.vx -= n.x * 0.004; n.vy -= n.y * 0.004; n.vz -= n.z * 0.004
      n.x += n.vx * cool; n.y += n.vy * cool; n.z += n.vz * cool
      n.vx *= 0.82; n.vy *= 0.82; n.vz *= 0.82
    }
  }
  // Recentre, scale by the 85th-percentile radius and log-compress outliers.
  const c = [0, 1, 2].map(k => N.reduce((s, n) => s + [n.x, n.y, n.z][k], 0) / N.length)
  const radii = N.map(n => { n.x -= c[0]; n.y -= c[1]; n.z -= c[2]; return Math.hypot(n.x, n.y, n.z) }).sort((a, b) => a - b)
  const R = radii[Math.floor(radii.length * 0.85)] || 1
  N.forEach((n, i) => {
    let k = 1 / R
    const r = Math.hypot(n.x, n.y, n.z) * k
    if (r > 1.15) k *= (1.15 + Math.log(r / 1.15) * 0.3) / r
    k *= 0.85
    nodes[i].p = [n.x, n.y, n.z].map(v => Math.round(v * k * 1000) / 1000)
  })
}
