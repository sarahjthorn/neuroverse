import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import BrainGraph3D from './components/BrainGraph3D'
import TopNav from './components/TopNav'
import HomeView from './components/HomeView'
import NodeDetailsPanel from './components/NodeDetailsPanel'
import DigestCard3D from './components/DigestCard3D'
import ExploreControls from './components/ExploreControls'
import ReflectView, { digestMemoryIds } from './components/ReflectView'
import MemoryToast from './components/MemoryToast'
import FirstLight from './components/FirstLight'
import { useQuestions } from './components/useQuestions'
import GlobalSearch from './components/GlobalSearch'
import AllMemoriesView from './components/AllMemoriesView'
import WishlistView from './components/WishlistView'
import AxonView from './components/AxonView'
import Axon from './components/Axon'
import AboutView from './components/AboutView'
import { isOptionalTab } from './tabs'
import TimeRangeScrubber from './components/TimeRangeScrubber'
import { nodeMatchesQuery } from './utils/nodeSearch'
import { usePresence } from './utils/usePresence'
import { EASE_OUT_EXPO, prefersReducedMotion } from './utils/motion'
import './App.css'

const LAST_SEEN_KEY = 'aibrain_lastSeenAt'
const DISMISSED_DUPLICATES_KEY = 'aibrain_dismissedDuplicates'
const THEME_KEY = 'aibrain_theme'
const VIEW_KEY = 'aibrain_view'

// Semantic hits worth treating as "matches" (lighting up in 3D, listed on
// Home) - an absolute floor plus staying close to the best hit, since the
// embedding scores for this data sit in a narrow band and a fixed cutoff
// alone either lets everything through or nothing.
const SEMANTIC_MIN_SIMILARITY = 0.2
const SEMANTIC_RELATIVE_WINDOW = 0.07

// Memories the First Light intro created (server/routes/intro.js) - Home
// keeps "waiting for Claude" up until there's one that isn't.
const INTRO_THREAD = 'First Light'
// How often the open app checks for memories stored from elsewhere (Claude
// over MCP). The check is a single COUNT/MAX query - free.
const GRAPH_POLL_MS = 5000
// Intro beats where you can orbit and click the stars.
const INTRO_INTERACTIVE_PHASES = new Set(['orbit', 'click', 'handoff'])

const VIEW_LABELS = { home: 'Home', memories: 'Memories', reflect: 'Reflect', about: 'About' }

const VALID_THEMES = new Set(['light', 'dark'])

function systemTheme() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

// Explicit only once the user has actually picked one via ThemeSwitcher - an
// old stored value from the retired minimal/glass/neon theme set doesn't
// count either, so a returning visitor from before this change falls back to
// following their system instead of getting stuck on a theme that no longer
// exists.
function hasExplicitTheme() {
  try {
    return VALID_THEMES.has(localStorage.getItem(THEME_KEY))
  } catch {
    return false
  }
}

function loadTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return VALID_THEMES.has(stored) ? stored : systemTheme()
  } catch {
    return systemTheme()
  }
}

// Which page greeted you last - a viewing preference, same reasoning as
// theme, so reopening the app doesn't reset you to Home every time if you
// live in Explore.
function loadView() {
  try {
    const stored = localStorage.getItem(VIEW_KEY) || 'home'
    // Stats was merged into Reflect (2026-10-06); Organize was retired.
    if (stored === 'stats') return 'reflect'
    return stored === 'organize' ? 'home' : stored
  } catch {
    return 'home'
  }
}

function loadDismissedSet(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

const duplicatePairKey = (d) => [d.existingId, d.duplicateId].sort().join('|')

// Combines any number of independent, additive matched-id filters (search,
// timeline, category toggles, ...) into the single set the 3D view
// understands - `null` (not present, or an inactive filter) means "no
// opinion," so it drops out rather than forcing an intersection with
// nothing.
function intersectMatchSets(sets) {
  const active = sets.filter(Boolean)
  if (active.length === 0) return null
  return active.reduce((acc, s) => new Set([...acc].filter(id => s.has(id))))
}

const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, label, summary, [role], [contenteditable], [tabindex]'

// Is a click on the brain showing through a page, rather than on its
// content? True unless something between the target and `root` is
// interactive, a visible surface (a card, pill or panel - any background
// or frosted glass), or the clicked element's own text.
function isBackdropTarget(target, root) {
  if (target.closest('.brain-stage')) return true
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.matches(INTERACTIVE_SELECTOR)) return false
    if (el === target && [...el.childNodes].some(c => c.nodeType === Node.TEXT_NODE && c.textContent.trim())) return false
    const style = getComputedStyle(el)
    const bg = style.backgroundColor
    const clear = bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg)
    if (!clear || style.backgroundImage !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none')) return false
    if (el.tagName === 'svg' || el.closest('svg')) return false
  }
  return true
}

// How long the details panel lingers to slide out (--panel-out-ms).
const DETAILS_EXIT_MS = 200
// ...and the Explore digest card to fade out.
const CARD_EXIT_MS = 140

// Pages that make room for the details panel (see .has-details in App.css).
const DETAILS_PAGES = [
  ':scope > .home-layer:not(.is-leaving)',
  ':scope > .all-memories:not(.is-parked)',
  ':scope > .stats-view:not(.is-parked)',
  ':scope > .wishlist-view'
].join(', ')

function App() {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selectedNode, setSelectedNode] = useState(null)
  // What the panel renders: selectedNode, or the one sliding out after close.
  const [detailsNode, detailsLeaving] = usePresence(selectedNode, DETAILS_EXIT_MS)
  // Was the panel already on screen? Then a new node swaps contents in place
  // instead of sliding the whole panel in again. Updated after each commit.
  const detailsShownRef = useRef(false)
  useEffect(() => { detailsShownRef.current = !!detailsNode })

  // The page beside the panel switches to its narrower layout in one step
  // (animating the width crossed container-query breakpoints mid-glide, so
  // columns snapped partway through), then settles in the direction the
  // panel pushed it - before paint, so the jump itself is never seen alone.
  const contentRef = useRef(null)
  const detailsOpen = !!selectedNode
  const prevDetailsOpen = useRef(detailsOpen)
  useLayoutEffect(() => {
    if (prevDetailsOpen.current === detailsOpen) return
    prevDetailsOpen.current = detailsOpen
    if (prefersReducedMotion() || !contentRef.current) return
    const shift = detailsOpen ? 32 : -32
    contentRef.current.querySelectorAll(DETAILS_PAGES).forEach(el => {
      el.animate(
        [{ transform: `translateX(${shift}px)` }, { transform: 'none' }],
        { duration: 380, easing: EASE_OUT_EXPO }
      )
    })
  }, [detailsOpen])

  const [loading, setLoading] = useState(false)
  const [newNodeIds, setNewNodeIds] = useState(new Set())
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0)
  const [recalculating, setRecalculating] = useState(false)
  const [recalcMessage, setRecalcMessage] = useState(null)
  const [suggestedDuplicates, setSuggestedDuplicates] = useState([])
  const [dismissedDuplicates, setDismissedDuplicates] = useState(() => loadDismissedSet(DISMISSED_DUPLICATES_KEY))
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [duplicateCheckMessage, setDuplicateCheckMessage] = useState(null)
  const [resolvingDuplicate, setResolvingDuplicate] = useState(false)
  const [theme, setTheme] = useState(() => loadTheme())
  const [themeExplicit, setThemeExplicit] = useState(() => hasExplicitTheme())
  const [view, setView] = useState(() => loadView())
  // Optional tabs switched on (src/tabs.js); null until loaded.
  const [enabledTabs, setEnabledTabs] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  // Embedding search results for the current query (Home's "Related by
  // meaning" list), fetched debounced alongside the instant substring match.
  const [semanticResults, setSemanticResults] = useState([])
  const [semanticLoading, setSemanticLoading] = useState(false)
  // Last "ask your brain" answer: { question, status, answer, citedIds, retrievedIds }
  const [askState, setAskState] = useState(null)
  // An explicit set of nodes to light up in the 3D view, sent from Home
  // ("View in 3D") - overrides the live search match while it's set.
  const [brainHighlight, setBrainHighlight] = useState(null)
  // The details panel's size: compact while clicking from star to star in
  // Explore, expanded everywhere else (and on "Full details & edit").
  const [detailsCompact, setDetailsCompact] = useState(false)
  // Close the panel only if it's the compact Explore one - leaving Explore,
  // clicking empty space, opening a digest. An expanded panel stays put.
  const closeCompactDetails = () => {
    if (detailsCompact) setSelectedNode(null)
  }
  // Where a "go to this memory" jump came from (Reflect, Memories, Home), so
  // Explore can offer a way back instead of stranding you in the 3D view.
  const [returnView, setReturnView] = useState(null)
  const [recenterRequest, setRecenterRequest] = useState(0)
  // Saved digests (Reflect page) - also drawn as comets in 3D.
  const [digests, setDigests] = useState([])
  const [openDigest, setOpenDigest] = useState(null)
  const [shownDigest, digestLeaving] = usePresence(openDigest, CARD_EXIT_MS)
  const [showComets, setShowComets] = useState(true)
  const [cometFocusRequest, setCometFocusRequest] = useState(null)
  // Home stays mounted for a moment after leaving so its cards can fade
  // out over the brain instead of vanishing.
  const [homeLeaving, setHomeLeaving] = useState(false)
  const homeLeaveTimer = useRef(null)
  const [focusRequest, setFocusRequest] = useState(null)
  const focusNonceRef = useRef(0)
  // `null` means "no time filter" (the scrubber's playhead sits at the live
  // edge) - same null-means-inactive convention as visibleNodeIds3D below, so
  // the two filters compose the same way.
  const [playheadMs, setPlayheadMs] = useState(null)
  // Categories unchecked in the Nodes tree (Phase D) - a viewing lens like
  // search/the scrubber, not a persisted preference, so it resets on reload
  // like they do rather than silently hiding nodes on a later visit.
  const [hiddenCategories, setHiddenCategories] = useState(() => new Set())

  // --- First Light (the intro) ----------------------------------------------
  const [graphLoaded, setGraphLoaded] = useState(false)
  const [intro, setIntro] = useState(null) // GET /api/intro
  // null, or the intro currently playing: { replay }
  const [introRun, setIntroRun] = useState(null)
  const [introPhase, setIntroPhase] = useState(null)
  // The stars the intro has lit so far - the only ones shown while it plays
  // (so a replay over a full brain still starts in darkness).
  const [introNodeIds, setIntroNodeIds] = useState(() => new Set())
  const [introOrbited, setIntroOrbited] = useState(false)
  const [introStarClicked, setIntroStarClicked] = useState(false)
  const [frameRequest, setFrameRequest] = useState(null)

  useEffect(() => {
    fetch('/api/intro')
      .then(r => r.json())
      .then(setIntro)
      .catch(error => console.error('Failed to load intro state:', error))
  }, [])

  const startIntro = (replay) => {
    setSelectedNode(null)
    setOpenDigest(null)
    clearBrainSearch()
    setPlayheadMs(null)
    setHiddenCategories(new Set())
    setIntroNodeIds(new Set())
    setIntroOrbited(false)
    setIntroStarClicked(false)
    setIntroPhase(null)
    setReturnView(null)
    setView('explore')
    setIntroRun({ replay })
  }

  // A brand-new, empty brain opens with the intro (once).
  useEffect(() => {
    if (graphLoaded && intro && !intro.completed && !introRun && nodes.length === 0) startIntro(false)
  }, [graphLoaded, intro, nodes.length])

  const lightIntroStars = (graph, ids) => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSuggestedDuplicates(graph.suggestedDuplicates || [])
    setIntroNodeIds(prev => {
      const next = new Set([...prev, ...ids])
      setFrameRequest({ ids: next, nonce: Date.now() })
      return next
    })
    try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()) } catch { /* ignore */ }
  }

  const postIntro = async (path, body) => {
    const response = await fetch(`/api/intro/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || data.error)
    return data
  }

  const handleIntroName = async (name) => {
    const data = await postIntro('name', { name })
    setIntro(prev => ({ ...prev, name, identityNodeId: data.identityNodeId }))
    lightIntroStars(data, [data.identityNodeId])
  }

  const handleIntroCurious = async (answer) => {
    const data = await postIntro('curious', { answer })
    lightIntroStars(data, data.newNodeIds)
  }

  const endIntro = () => {
    postIntro('complete').catch(error => console.error('Failed to save intro completion:', error))
    setIntro(prev => ({ ...prev, completed: true }))
    setIntroRun(null)
    setIntroPhase(null)
    setSelectedNode(null)
    setFrameRequest(null)
    setRecenterRequest(n => n + 1)
    setView('home')
  }

  // Load existing graph (and saved digests - free) on mount
  useEffect(() => {
    fetchGraph()
    fetch('/api/stats/digests')
      .then(r => r.json())
      .then(data => setDigests(data.digests || []))
      .catch(error => console.error('Failed to load digests:', error))
  }, [])

  const comets = useMemo(() => digests.map(d => ({
    id: d.id,
    label: `Digest · ${new Date(d.period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    digest: d
  })), [digests])

  // Plain client-side substring match over already-loaded nodes - the graph
  // is small enough that this is cheap on every keystroke, no need for a
  // debounce or a server round-trip. `null` (not an empty Set) means "no
  // search active," so the 3D view knows not to dim anything at all.
  const searchMatchedNodeIds = useMemo(() => {
    if (brainHighlight) return brainHighlight.ids
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    const ids = new Set(nodes.filter(n => nodeMatchesQuery(n, q)).map(n => n.id))
    semanticResults.forEach(r => ids.add(r.node.id))
    return ids
  }, [nodes, searchQuery, semanticResults, brainHighlight])

  // Debounced semantic search - the substring match above is instant, this
  // fills in memories that match by meaning a moment later.
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 3) {
      setSemanticResults([])
      setSemanticLoading(false)
      return
    }
    setSemanticLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '10', minSimilarity: String(SEMANTIC_MIN_SIMILARITY) })
        const response = await fetch(`/api/search?${params}`, { signal: controller.signal })
        const data = await response.json()
        const results = data.results || []
        // Results arrive in hybrid (meaning + keyword) order, so the best
        // similarity isn't necessarily first. Exact keyword matches always
        // stay, however far their embedding is from the query.
        const best = Math.max(0, ...results.map(r => r.similarity ?? 0))
        setSemanticResults(results.filter(r => r.keywordMatch || r.similarity >= best - SEMANTIC_RELATIVE_WINDOW))
      } catch (error) {
        if (error.name !== 'AbortError') console.error('Semantic search failed:', error)
      } finally {
        if (!controller.signal.aborted) setSemanticLoading(false)
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery])

  const handleAsk = async () => {
    const question = searchQuery.trim()
    if (!question) return
    setAskState({ question, status: 'loading' })
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Ask failed')
      setAskState({ question, status: 'done', ...data })
    } catch (error) {
      console.error('Ask failed:', error)
      setAskState({ question, status: 'error' })
    }
  }

  // Light up a set of memories in Explore - from a count or list on any
  // page. Like goToNode, remembers the page so Explore offers a way back.
  const handleViewInBrain = (ids, label) => {
    const from = view
    setBrainHighlight({ ids: new Set(ids), label })
    changeView('explore')
    if (from !== 'explore') setReturnView(from)
  }

  const clearBrainSearch = () => {
    setBrainHighlight(null)
    setSearchQuery('')
  }

  // Time-range scrubber's filter, same null-means-inactive convention.
  const timelineMatchedNodeIds = useMemo(() => {
    if (playheadMs === null) return null
    return new Set(
      nodes.filter(n => n.data.timestamp && new Date(n.data.timestamp).getTime() <= playheadMs).map(n => n.id)
    )
  }, [nodes, playheadMs])

  // Category checkboxes (Phase D) - a node stays visible if ANY of its
  // categories is still checked (not ALL), so unchecking one category
  // doesn't yank a multi-category node out of view entirely just because
  // one of its several tags got hidden.
  const categoryMatchedNodeIds = useMemo(() => {
    if (hiddenCategories.size === 0) return null
    return new Set(
      nodes
        .filter(n => {
          const cats = n.data.categories?.length > 0 ? n.data.categories : [n.data.category].filter(Boolean)
          return cats.some(c => !hiddenCategories.has(c))
        })
        .map(n => n.id)
    )
  }, [nodes, hiddenCategories])

  const toggleCategoryVisibility = (name) => {
    setHiddenCategories(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // The timeline and category toggles decide which stars exist at all (so scrubbing shows the
  // brain actually growing), while search only decides which ones glow.
  const visibleNodeIds3D = useMemo(
    () => intersectMatchSets([timelineMatchedNodeIds, categoryMatchedNodeIds]),
    [timelineMatchedNodeIds, categoryMatchedNodeIds]
  )

  // "Tidy up" suggestions surfaced on Home - each opens the duplicate's
  // details panel, which has the merge / "not now" UI for that pair.
  const tidyItems = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    return suggestedDuplicates
      .filter(d => !dismissedDuplicates.has(duplicatePairKey(d)))
      .map(d => ({ d, node: byId.get(d.duplicateId) }))
      .filter(({ node }) => node)
      .map(({ d, node }) => ({
        key: `dup-${duplicatePairKey(d)}`,
        kind: d.source === 'claude' ? 'Duplicate (Claude)' : 'Possible duplicate',
        label: `${d.duplicateTitle} ≈ ${d.existingTitle}`,
        node
      }))
  }, [nodes, suggestedDuplicates, dismissedDuplicates])

  useEffect(() => {
    fetch('/api/tabs').then(r => r.json())
      .then(d => setEnabledTabs(d.enabled))
      .catch(() => setEnabledTabs([]))
  }, [])

  // Reopened into (or still on) an optional tab that's been switched off.
  useEffect(() => {
    if (enabledTabs && isOptionalTab(view) && !enabledTabs.includes(view)) setView('home')
  }, [enabledTabs, view])

  // Switching a tab on takes you to it; switching off the one you're on
  // goes Home (the effect above).
  const toggleTab = async (id, on) => {
    const r = await fetch(`/api/tabs/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: on })
    })
    if (!r.ok) return
    setEnabledTabs((await r.json()).enabled)
    if (on) changeView(id)
  }

  const changeView = (next) => {
    if (next === view) return
    if (view === 'home') {
      setHomeLeaving(true)
      clearTimeout(homeLeaveTimer.current)
      homeLeaveTimer.current = setTimeout(() => setHomeLeaving(false), 400)
    }
    if (next !== 'explore') {
      closeCompactDetails()
      setOpenDigest(null)
    }
    setReturnView(null)
    setView(next)
  }

  // is-explore: full, interactive. is-backdrop: dimmed behind the other pages.
  const stageMode = view === 'explore' || introRun ? 'is-explore' : 'is-backdrop'

  // On the pages over the brain, clicking the brain itself (empty space
  // between the cards) goes to Explore - or first closes the details panel.
  const handleBackdropClick = (event) => {
    if (stageMode !== 'is-backdrop' || event.defaultPrevented) return
    if (window.getSelection()?.toString()) return
    if (!isBackdropTarget(event.target, event.currentTarget)) return
    if (selectedNode) setSelectedNode(null)
    else changeView('explore')
  }

  const edgesForNode = (nodeId) => edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .map(e => {
      const connectedId = e.source === nodeId ? e.target : e.source
      const node = nodes.find(n => n.id === connectedId)
      return node ? { ...node, strength: e.data.strength, edgeType: e.data.type } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.strength - a.strength)

  // Loaded copies of the semantic hits (fresher than the search response's).
  const semanticNodes = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    return semanticResults.map(r => byId.get(r.node.id)).filter(Boolean)
  }, [nodes, semanticResults])

  // Go to the star itself: Explore, camera flies over, and its compact
  // panel opens - or, `withDetails`, the panel stays expanded on it (the
  // panel's "Show in Explore" button).
  const goToNode = (node, { withDetails = false } = {}) => {
    const from = view
    changeView('explore')
    if (from !== 'explore') setReturnView(from)
    setOpenDigest(null)
    setSelectedNode(node)
    setDetailsCompact(!withDetails)
    focusOnNode(node.id)
  }

  // Picking a memory on a page (Home, Memories, Reflect) opens its full details
  // on the right without leaving the page; the dimmed brain behind still
  // flies to and lights up its star.
  const openDetails = (node) => {
    setSelectedNode(node)
    setDetailsCompact(false)
    focusOnNode(node.id)
  }

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return nodes
      .filter(n => nodeMatchesQuery(n, q))
      .sort((a, b) => a.data.title.localeCompare(b.data.title))
  }, [nodes, searchQuery])

  // Theme is a per-browser viewing preference (same reasoning as cluster/
  // duplicate dismissal) - applied as a data-attribute on <html> so every
  // CSS variable override in index.css cascades from one place.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (!themeExplicit) return
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // ignore storage errors
    }
  }, [theme, themeExplicit])

  // Until the user explicitly picks a theme, keep following the OS/browser's
  // prefers-color-scheme live - e.g. the system switching to dark at sunset
  // should carry the app with it, not just at the moment the tab first
  // loaded.
  useEffect(() => {
    if (themeExplicit) return
    let mql
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const update = (e) => setTheme(e.matches ? 'dark' : 'light')
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [themeExplicit])

  // 'system' (Auto, the default) forgets any explicit pick so the app goes
  // back to following the OS light/dark setting live.
  // Picking the theme the system already uses = back to following the
  // system (there's no separate "Auto" button any more).
  const handleChangeTheme = (next) => {
    if (next === 'system' || next === systemTheme()) {
      try {
        localStorage.removeItem(THEME_KEY)
      } catch {
        // ignore storage errors
      }
      setThemeExplicit(false)
      setTheme(systemTheme())
      return
    }
    setThemeExplicit(true)
    setTheme(next)
  }

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      // ignore storage errors
    }
  }, [view])

  const fetchGraph = async () => {
    try {
      const response = await fetch('/api/graph')
      const data = await response.json()
      const fetchedNodes = data.nodes || []

      // Nodes can appear outside this tab entirely (e.g. Claude storing a
      // memory via the MCP server while this page sits open in the
      // background), so on load, diff against what this browser last saw
      // rather than assuming this tab is the only way nodes get added.
      const lastSeenAt = localStorage.getItem(LAST_SEEN_KEY)
      if (lastSeenAt) {
        const freshIds = fetchedNodes
          .filter(n => n.data.timestamp && n.data.timestamp > lastSeenAt)
          .map(n => n.id)
        if (freshIds.length > 0) {
          setNewNodeIds(new Set(freshIds))
          setNewSinceLastVisit(freshIds.length)
        }
      }
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString())

      setNodes(fetchedNodes)
      setEdges(data.edges || [])
      setSuggestedDuplicates(data.suggestedDuplicates || [])
    } catch (error) {
      console.error('Failed to load graph:', error)
    } finally {
      setGraphLoaded(true)
    }
  }

  // Memories stored from elsewhere while the app is open (Claude over MCP)
  // used to need a reload. Now: poll a tiny signature, and when it changes
  // pull the graph and let the new stars burst in, with a toast.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const introRunRef = useRef(introRun)
  introRunRef.current = introRun
  useEffect(() => {
    if (!graphLoaded) return
    // Seeded from the graph already loaded (same "count|latest" the server
    // sends), so a memory landing between that load and the first check
    // still counts as new.
    const loaded = nodesRef.current
    let lastSignature = `${loaded.length}|${loaded.reduce((max, n) => (n.data.timestamp > max ? n.data.timestamp : max), '')}`
    let stopped = false
    const check = async () => {
      // Paused during the intro (its own stars are added directly); anything
      // Claude sends meanwhile is picked up as new right after it ends.
      if (document.hidden || introRunRef.current) return
      try {
        const { signature } = await (await fetch('/api/graph/signature')).json()
        if (signature !== lastSignature) {
          const data = await (await fetch('/api/graph')).json()
          if (stopped) return
          const known = new Set(nodesRef.current.map(n => n.id))
          const fresh = (data.nodes || []).filter(n => !known.has(n.id))
          const firstReal = fresh.length > 0 && nodesRef.current.every(n => n.data.thread === INTRO_THREAD)
          setNodes(data.nodes || [])
          setEdges(data.edges || [])
          setSuggestedDuplicates(data.suggestedDuplicates || [])
          if (fresh.length > 0) {
            setNewNodeIds(prev => new Set([...prev, ...fresh.map(n => n.id)]))
            setMemoryToast({
              nodes: fresh,
              title: firstReal ? 'Your first memory from Claude ✦' : fresh.length === 1 ? 'New memory from Claude' : `${fresh.length} new memories from Claude`
            })
            try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()) } catch { /* ignore */ }
          }
        }
        lastSignature = signature
      } catch {
        // server briefly down - try again next tick
      }
    }
    check()
    const timer = setInterval(check, GRAPH_POLL_MS)
    // Coming back to the tab checks at once rather than on the next tick.
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [graphLoaded])

  const handleAddConversation = async (conversationText) => {
    setLoading(true)
    try {
      const response = await fetch('/api/process-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation: conversationText })
      })

      const data = await response.json()
      const previousIds = new Set(nodes.map(n => n.id))
      const freshIds = data.nodes.filter(n => !previousIds.has(n.id)).map(n => n.id)
      setNewNodeIds(new Set(freshIds))
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString())

      setNodes(data.nodes)
      setEdges(data.edges)
    } catch (error) {
      console.error('Failed to process conversation:', error)
      alert('Failed to process conversation. Check console for details.')
    } finally {
      setLoading(false)
    }
  }

  const handleRecalculate = async () => {
    setRecalculating(true)
    setRecalcMessage(null)
    try {
      const response = await fetch('/api/graph/recalculate-relationships', { method: 'POST' })
      const data = await response.json()
      setEdges(data.graph.edges)
      setNodes(data.graph.nodes)
      setSuggestedDuplicates(data.graph.suggestedDuplicates || [])
      setRecalcMessage(`Recalculated: ${data.created} new, ${data.updated} refreshed, ${data.skipped} scored too low to link`)
    } catch (error) {
      console.error('Failed to recalculate relationships:', error)
      setRecalcMessage('Recalculate failed - check console for details')
    } finally {
      setRecalculating(false)
    }
  }

  // 3D clicks open the panel compact and fly the camera over. If it's
  // already open it follows the click at whatever size it is.
  const handleNodeClick3D = (node) => {
    if (!selectedNode) setDetailsCompact(true)
    setSelectedNode(node)
    focusOnNode(node.id)
  }

  // Pan/zoom the graph to a node selected from outside it (a search result,
  // a keyword's linked defining node) - clicking a node directly in the
  // graph doesn't need this since it's already on screen. The nonce lets
  // BrainGraph3D tell repeat clicks on the same node apart from a no-op.
  const focusOnNode = (nodeId) => {
    focusNonceRef.current += 1
    setFocusRequest({ id: nodeId, nonce: focusNonceRef.current })
  }

  // "Check with Claude" on the Tidy up card - the one paid step in duplicate
  // detection, so it only ever runs from this button (see COST.md).
  const handleCheckDuplicates = async () => {
    setCheckingDuplicates(true)
    setDuplicateCheckMessage(null)
    try {
      const response = await fetch('/api/graph/duplicates/check', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error)
      setNodes(data.graph.nodes)
      setEdges(data.graph.edges)
      setSuggestedDuplicates(data.graph.suggestedDuplicates || [])
      setDuplicateCheckMessage(
        data.checked === 0
          ? 'Nothing new to check - every similar pair has already been reviewed.'
          : `Checked the ${data.checked === 1 ? 'most similar pair' : `${data.checked} most similar pairs`} not yet reviewed ` +
            `(top ${data.batchSize} by similarity): ${data.found || 'no'} duplicate${data.found === 1 ? '' : 's'} found.` +
            (data.remaining > 0 ? ` ${data.remaining} more to check.` : '')
      )
    } catch (error) {
      console.error('Failed to check duplicates:', error)
      setDuplicateCheckMessage('Check failed - see console for details.')
    } finally {
      setCheckingDuplicates(false)
    }
  }

  // Answering one of the brain's questions (CuriousCard on Home) adds
  // memories like any other conversation - highlight them the same way.
  const [memoryToast, setMemoryToast] = useState(null)
  const handleQuestionAnswered = (graph, newIds) => {
    const fresh = new Set(newIds)
    setMemoryToast({ nodes: graph.nodes.filter(n => fresh.has(n.id)) })
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setSuggestedDuplicates(graph.suggestedDuplicates || [])
    setNewNodeIds(new Set(newIds))
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString())
  }
  const questionsApi = useQuestions(handleQuestionAnswered, nodes)

  const handleResolveDuplicate = async (existingId, duplicateId) => {
    setResolvingDuplicate(true)
    try {
      const response = await fetch('/api/graph/duplicates/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ existingId, duplicateId })
      })
      const data = await response.json()
      setNodes(data.nodes)
      setEdges(data.edges)
      setSuggestedDuplicates(data.suggestedDuplicates || [])
      // Swap the open panel/card for the merged node so its new categories
      // and keywords show at once. The duplicate node no longer exists - if
      // it was open, follow the merge onto whichever node survived.
      const refreshed = prev => {
        if (!prev) return prev
        const id = prev.id === duplicateId ? existingId : prev.id
        return data.nodes.find(n => n.id === id) || null
      }
      setSelectedNode(refreshed)
    } catch (error) {
      console.error('Failed to resolve duplicate:', error)
    } finally {
      setResolvingDuplicate(false)
    }
  }

  // Dismissing a suggestion is a personal "not now" for this browser, not a
  // fact about the data - same reasoning as collapse state, kept client-side
  // only rather than persisted server-side.
  const handleDismissDuplicate = (pairKey) => {
    setDismissedDuplicates(prev => {
      const next = new Set(prev)
      next.add(pairKey)
      try {
        localStorage.setItem(DISMISSED_DUPLICATES_KEY, JSON.stringify([...next]))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  const handleNavigateToNode = async (nodeId) => {
    focusOnNode(nodeId)
    const existing = nodes.find(n => n.id === nodeId)
    if (existing) {
      setSelectedNode(existing)
      return
    }
    try {
      const response = await fetch(`/api/nodes/${nodeId}`)
      if (response.ok) setSelectedNode(await response.json())
    } catch (error) {
      console.error('Failed to load node:', error)
    }
  }

  const handleUpdateNode = async (nodeId, updates) => {
    try {
      const response = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      
      const updatedNode = await response.json()
      setNodes(nodes.map(n => n.id === nodeId ? updatedNode : n))
      setSelectedNode(updatedNode)
    } catch (error) {
      console.error('Failed to update node:', error)
    }
  }

  const handleDeleteNode = async (nodeId) => {
    try {
      await fetch(`/api/nodes/${nodeId}`, { method: 'DELETE' })
      setNodes(nodes.filter(n => n.id !== nodeId))
      setEdges(edges.filter(e => e.source !== nodeId && e.target !== nodeId))
      setSelectedNode(null)
    } catch (error) {
      console.error('Failed to delete node:', error)
    }
  }

  return (
    <div className={`app${introRun ? ' is-intro' : ''}`}>
      <TopNav
        view={view}
        onChangeView={changeView}
        enabledTabs={enabledTabs || []}
        onToggleTab={toggleTab}
        theme={theme}
        onChangeTheme={handleChangeTheme}
        homeBadgeCount={newSinceLastVisit}
        openQuestionCount={questionsApi.questions.length}
        search={view !== 'home' && (
          <GlobalSearch
            value={brainHighlight ? brainHighlight.label : searchQuery}
            onChange={(q) => {
              setBrainHighlight(null)
              setSearchQuery(q)
            }}
            onClear={clearBrainSearch}
            exactResults={searchResults}
            semanticResults={semanticNodes}
            semanticLoading={semanticLoading}
            onPick={goToNode}
            onAsk={() => {
              changeView('home')
              handleAsk()
            }}
          />
        )}
      />

      <div ref={contentRef} className={`app-content${selectedNode ? ' has-details' : ''}`} onClick={handleBackdropClick}>
        {/* One persistent 3D brain: it IS Explore, and on Home it's the dimmed,
            non-interactive living backdrop behind the (opaque) cards. Going
            Home -> Explore fades the cards away rather than swapping pages. */}
        <div className={`brain-stage ${stageMode}`} aria-hidden={view !== 'explore'}>
          <BrainGraph3D
            // Light/dark are different universes (sky, blending, bloom), so
            // switching theme remounts it; star positions are cached, so the
            // map itself doesn't move.
            key={theme === 'light' ? 'galaxyLight' : 'galaxy'}
            look={theme === 'light' ? 'galaxyLight' : 'galaxy'}
            showComets={showComets}
            cometFocusRequest={cometFocusRequest}
            nodes={nodes}
            edges={edges}
            // While the intro plays, only its own stars exist, all labelled.
            visibleNodeIds={introRun ? introNodeIds : visibleNodeIds3D}
            highlightNodeIds={introRun ? (introNodeIds.size > 0 ? introNodeIds : null) : searchMatchedNodeIds}
            newNodeIds={newNodeIds}
            selectedNodeId={selectedNode?.id ?? null}
            focusRequest={focusRequest}
            recenterRequest={recenterRequest}
            frameRequest={frameRequest}
            animateArrivals={graphLoaded}
            revealArrivals={view === 'explore' || !!introRun}
            interactive={introRun ? INTRO_INTERACTIVE_PHASES.has(introPhase) : view === 'explore'}
            onOrbit={() => { if (introRun) setIntroOrbited(true) }}
            holdStill={!!introRun}
            onNodeClick={(node) => {
              if (introRun && introPhase === 'click') setIntroStarClicked(true)
              setOpenDigest(null)
              handleNodeClick3D(node)
            }}
            // Clicking empty space is "deselect everything": the compact
            // panel or digest, and any search / "View in 3D" highlight.
            onBackgroundClick={() => {
              closeCompactDetails()
              setOpenDigest(null)
              if (searchMatchedNodeIds) clearBrainSearch()
            }}
            comets={comets}
            followCometId={view === 'explore' && openDigest ? openDigest.id : null}
            onCometClick={(comet) => {
              closeCompactDetails()
              setOpenDigest(comet.digest)
            }}
          />
          <div className="brain-stage-dim" />
        </div>

        {(view === 'home' || homeLeaving) && (
          <div className={`home-layer ${view !== 'home' ? 'is-leaving' : ''}`}>
            <HomeView
              nodes={nodes}
              searchQuery={searchQuery}
              onSearchQueryChange={(q) => {
                setBrainHighlight(null)
                setSearchQuery(q)
              }}
              searchResults={searchResults}
              semanticResults={semanticResults}
              semanticLoading={semanticLoading}
              askState={askState?.question === searchQuery.trim() ? askState : null}
              onAsk={handleAsk}
              onViewInBrain={handleViewInBrain}
              onSelectNode={openDetails}
              newSinceLastVisit={newSinceLastVisit}
              onDismissNew={() => setNewSinceLastVisit(0)}
            onShowNew={() => handleViewInBrain([...newNodeIds], `${newNodeIds.size} new since your last visit`)}
              recalcMessage={recalcMessage}
              onDismissRecalcMessage={() => setRecalcMessage(null)}
              tidyItems={tidyItems}
              onCheckDuplicates={handleCheckDuplicates}
              checkingDuplicates={checkingDuplicates}
              duplicateCheckMessage={duplicateCheckMessage}
              onSeeAll={() => changeView('memories')}
              onSubmit={handleAddConversation}
              loading={loading}
              onRecalculate={handleRecalculate}
              recalculating={recalculating}
              questionsApi={questionsApi}
              onOpenReflect={() => changeView('reflect')}
              // After the intro (or with only its stars, if it was left
              // halfway): nothing from Claude yet.
              waitingForClaude={graphLoaded && !!intro && (intro.completed || nodes.length > 0) && nodes.every(n => n.data.thread === INTRO_THREAD)}
              onReplayIntro={() => startIntro(true)}
            />
          </div>
        )}

        {view === 'explore' && !introRun && (
          <div className="graph-container explore-layer">
            {returnView && (
              <button type="button" className="explore-return" onClick={() => changeView(returnView)}>
                ← Back to {VIEW_LABELS[returnView] || 'previous page'}
              </button>
            )}
            <ExploreControls
              nodes={nodes}
              hiddenCategories={hiddenCategories}
              onToggleCategory={toggleCategoryVisibility}
              digests={digests}
              showComets={showComets}
              onToggleComets={() => setShowComets(v => !v)}
              onOpenDigest={(d) => {
                closeCompactDetails()
                setOpenDigest(d)
                setShowComets(true)
                setCometFocusRequest({ id: d.id, nonce: Date.now() })
              }}
              onRecenter={() => {
                closeCompactDetails()
                setRecenterRequest(n => n + 1)
              }}
            />
            {shownDigest && (
              <DigestCard3D
                digest={shownDigest}
                leaving={digestLeaving}
                onClose={() => setOpenDigest(null)}
                hasReturn={!!returnView}
                memoryIds={digestMemoryIds(nodes, shownDigest)}
                onViewInBrain={handleViewInBrain}
              />
            )}
            <TimeRangeScrubber nodes={nodes} playheadMs={playheadMs} onChange={setPlayheadMs} />
          </div>
        )}

        {/* The page a "go to this memory" jump came from stays mounted but
            parked while you're in Explore, so "Back to ..." returns you to
            the same filters and scroll position. */}
        {(view === 'memories' || returnView === 'memories') && (
          <AllMemoriesView
            parked={view !== 'memories'}
            nodes={nodes}
            edges={edges}
            onSelectNode={openDetails}
            onViewInBrain={handleViewInBrain}
          />
        )}

        {(view === 'reflect' || returnView === 'reflect') && (
          <ReflectView
            parked={view !== 'reflect'}
            nodes={nodes}
            edges={edges}
            api={questionsApi}
            onSelectNode={openDetails}
            onViewInBrain={handleViewInBrain}
            digests={digests}
            onDigestCreated={(d) => setDigests(prev => [d, ...prev])}
          />
        )}

        {view === 'wishlist' && enabledTabs?.includes('wishlist') && <WishlistView nodes={nodes} onSelectNode={openDetails} />}
        {view === 'axon' && enabledTabs?.includes('axon') && <AxonView />}
        {enabledTabs?.includes('axon') && <Axon view={view} />}

        {view === 'about' && <AboutView nodes={nodes} onViewInBrain={handleViewInBrain} />}

        {detailsNode && (
          <NodeDetailsPanel
            // Keyed by node so edit drafts and "show all" reset when you
            // switch to another memory.
            key={detailsNode.id}
            node={detailsNode}
            swapIn={detailsShownRef.current}
            leaving={detailsLeaving}
            onClose={() => setSelectedNode(null)}
            compact={detailsCompact}
            onExpand={() => setDetailsCompact(false)}
            onCollapse={view === 'explore' ? () => setDetailsCompact(true) : null}
            onShowInExplore={view !== 'explore' ? () => goToNode(detailsNode, { withDetails: true }) : null}
            onUpdate={handleUpdateNode}
            onDelete={handleDeleteNode}
            onNavigateToNode={handleNavigateToNode}
            onViewInBrain={handleViewInBrain}
            duplicateSuggestion={
              suggestedDuplicates.find(d =>
                (d.existingId === detailsNode.id || d.duplicateId === detailsNode.id) &&
                !dismissedDuplicates.has(duplicatePairKey(d))
              ) || null
            }
            onResolveDuplicate={handleResolveDuplicate}
            onDismissDuplicate={handleDismissDuplicate}
            resolvingDuplicate={resolvingDuplicate}
            connectedNodes={edgesForNode(detailsNode.id)}
            // Phase B backlinks: edges where this node is the `target`. In the
            // live add-conversation path (server/routes/conversation.js) an
            // edge's source is always the newer node being added and its
            // target is the existing memory it scored against, so this reads
            // as "which later memories pointed back at this one" - the
            // Obsidian-style "linked from" list, distinct from the
            // strength-sorted, direction-agnostic "Connected Memories" above.
            // (recalculateRelationships can occasionally mint a fresh edge in
            // the opposite direction - a rare exception, not a redefinition.)
            backlinkNodes={edges
              .filter(e => e.target === detailsNode.id)
              .map(e => nodes.find(n => n.id === e.source))
              .filter(Boolean)
              .sort((a, b) => (b.data.timestamp || '').localeCompare(a.data.timestamp || ''))
            }
          />
        )}
      </div>

      {introRun && (
        <FirstLight
          initialName={intro?.name || ''}
          onSubmitName={handleIntroName}
          onSubmitCurious={handleIntroCurious}
          onPhase={setIntroPhase}
          orbited={introOrbited}
          starClicked={introStarClicked}
          onFinish={endIntro}
          onSkip={endIntro}
        />
      )}

      <MemoryToast
        toast={memoryToast}
        onClose={() => setMemoryToast(null)}
        onViewInBrain={handleViewInBrain}
        onSelectNode={goToNode}
      />
    </div>
  )
}

export default App
