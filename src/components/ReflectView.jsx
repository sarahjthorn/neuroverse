import { useMemo, useState } from 'react'
import { CATEGORY_ORDER, getCategoryColor, nodeCategoryList } from '../utils/categories'
import GrowthChart, { computeGrowth } from './GrowthChart'
import { QuestionItem, AskMePicker } from './CuriousCard'
import './StatsView.css'
import './ReflectView.css'

const DAY_MS = 24 * 60 * 60 * 1000
const SPARK_DAYS = 14
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
// Your mix marks this many of the smallest categories with ✦ - the parts of
// your life the brain knows least about.
const THIN_COUNT = 3
// The wondering card's picker shows this many random keywords.
const PICKER_KEYWORDS = 14
// "What you've told it" shows this many answers, then "Show more".
const HISTORY_PAGE = 3
// Your brain's shape compares all time with this many recent days.
const RECENT_DAYS = 3

// When most memories land, by time of day.
const DAY_PARTS = [
  { key: 'morning', label: 'Morning person', hint: 'most memories land between 5am and noon', test: h => h >= 5 && h < 12 },
  { key: 'afternoon', label: 'Afternoon thinker', hint: 'most memories land between noon and 5pm', test: h => h >= 12 && h < 17 },
  { key: 'evening', label: 'Evening reflector', hint: 'most memories land between 5pm and 9pm', test: h => h >= 17 && h < 21 },
  { key: 'night', label: 'Night owl', hint: 'most memories land after 9pm', test: h => h >= 21 || h < 5 }
]

function dayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatShortDate(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatHour(h) {
  return `${String(h).padStart(2, '0')}:00`
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function listNames(names) {
  if (names.length <= 1) return names
  return names.flatMap((name, i) => [
    i === 0 ? null : i === names.length - 1 ? ' and ' : ', ',
    name
  ]).filter(Boolean)
}

// The memories a digest covered (captured within its period).
export function digestMemoryIds(nodes, digest) {
  const start = new Date(digest.period_start).getTime()
  const end = new Date(digest.period_end).getTime()
  return nodes
    .filter(n => {
      if (!n.data.timestamp) return false
      const t = new Date(n.data.timestamp).getTime()
      return t >= start && t <= end
    })
    .map(n => n.id)
}

// Everything on this page is computed in the browser from the graph that's
// already loaded - no API calls - except the digest button and asking for
// new questions.
function computeStats(nodes, edges) {
  const now = Date.now()
  const today = startOfDay(now).getTime()
  const withTime = nodes.filter(n => n.data.timestamp)
  const times = withTime.map(n => new Date(n.data.timestamp).getTime())

  const thisWeekIds = withTime.filter(n => new Date(n.data.timestamp).getTime() >= now - 7 * DAY_MS).map(n => n.id)
  const thisWeek = thisWeekIds.length
  const lastWeek = times.filter(t => t >= now - 14 * DAY_MS && t < now - 7 * DAY_MS).length

  // Per-day counts (for the streak and sparklines).
  const perDay = new Map()
  withTime.forEach(n => {
    const key = dayKey(n.data.timestamp)
    perDay.set(key, (perDay.get(key) || 0) + 1)
  })

  // Streak: consecutive days with at least one memory, counting back from
  // today (or yesterday, so the streak isn't "broken" before you've had a
  // chance to capture anything today).
  let streak = 0
  let cursor = perDay.has(dayKey(today)) ? today : today - DAY_MS
  while (perDay.has(dayKey(cursor))) {
    streak += 1
    cursor -= DAY_MS
  }
  let longestStreak = 0
  let run = 0
  let prevDay = null
  ;[...perDay.keys()].sort().forEach(key => {
    const [y, m, d] = key.split('-').map(Number)
    const day = new Date(y, m - 1, d)
    // 1.5 days rather than 1 so a DST shift doesn't break the run.
    run = prevDay && day - prevDay <= DAY_MS * 1.5 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    prevDay = day
  })

  // Last SPARK_DAYS days, oldest first: new memories per day.
  const daily = []
  for (let i = SPARK_DAYS - 1; i >= 0; i--) daily.push(perDay.get(dayKey(today - i * DAY_MS)) || 0)

  // Category mix - every category, including empty ones, so the brain's
  // blind spots show up too.
  const categoryCounts = new Map(CATEGORY_ORDER.map(c => [c, 0]))
  const categoryIds = new Map(CATEGORY_ORDER.map(c => [c, []]))
  nodes.forEach(n => nodeCategoryList(n.data).forEach(c => {
    if (!categoryCounts.has(c)) return
    categoryCounts.set(c, categoryCounts.get(c) + 1)
    categoryIds.get(c).push(n.id)
  }))
  const mix = [...categoryCounts]
    .map(([category, count]) => ({ category, count, ids: categoryIds.get(category), share: count / Math.max(1, nodes.length) }))
    .sort((a, b) => b.count - a.count)
  const thin = nodes.length ? mix.slice(-THIN_COUNT).map(c => c.category) : []

  // Your brain's shape: each category's share of all memories, and of the
  // last RECENT_DAYS days' memories - to see where your focus is drifting.
  const recentNodes = withTime.filter(n => new Date(n.data.timestamp).getTime() >= now - RECENT_DAYS * DAY_MS)
  const recentCounts = new Map(CATEGORY_ORDER.map(c => [c, 0]))
  recentNodes.forEach(n => nodeCategoryList(n.data).forEach(c => {
    if (recentCounts.has(c)) recentCounts.set(c, recentCounts.get(c) + 1)
  }))
  const shape = CATEGORY_ORDER.map(c => ({
    category: c,
    all: categoryCounts.get(c) / Math.max(1, nodes.length),
    recent: recentNodes.length ? recentCounts.get(c) / recentNodes.length : null
  }))

  // Trending: keywords used more in the last 7 days than their usual
  // weekly rate before that.
  const firstTime = times.length ? Math.min(...times) : now
  const priorWeeks = Math.max(1, (now - 7 * DAY_MS - firstTime) / (7 * DAY_MS))
  const recentKw = new Map()
  const priorKw = new Map()
  const recentKwIds = new Map() // keyword -> this week's memories carrying it
  withTime.forEach(n => {
    const t = new Date(n.data.timestamp).getTime()
    const recent = t >= now - 7 * DAY_MS
    const target = recent ? recentKw : priorKw
    ;(n.data.keywords || []).forEach(k => {
      const key = k.toLowerCase()
      target.set(key, (target.get(key) || 0) + 1)
      if (recent) {
        if (!recentKwIds.has(key)) recentKwIds.set(key, new Set())
        recentKwIds.get(key).add(n.id)
      }
    })
  })
  const trending = [...recentKw.entries()]
    .filter(([, count]) => count >= 2)
    .map(([keyword, count]) => {
      const usual = (priorKw.get(keyword) || 0) / priorWeeks
      return { keyword, count, ids: [...recentKwIds.get(keyword)], isNew: !priorKw.has(keyword), lift: count - usual }
    })
    .sort((a, b) => b.lift - a.lift || b.count - a.count)
    .slice(0, 8)

  // Top keywords of all time, with the memories behind each (for "View in 3D").
  const keywordMap = new Map()
  nodes.forEach(n => {
    new Set((n.data.keywords || []).map(k => k.trim()).filter(Boolean)).forEach(k => {
      const key = k.toLowerCase()
      if (!keywordMap.has(key)) keywordMap.set(key, { keyword: k, ids: [] })
      keywordMap.get(key).ids.push(n.id)
    })
  })
  const topKeywords = [...keywordMap.values()]
    .filter(k => k.ids.length >= 2)
    .sort((a, b) => b.ids.length - a.ids.length || a.keyword.localeCompare(b.keyword))
    .slice(0, 16)

  // Hubs: the most connected memories. Unlinked: memories with no links.
  const byId = new Map(nodes.map(n => [n.id, n]))
  const degree = new Map()
  const neighbours = new Map()
  edges.forEach(e => {
    if (!byId.has(e.source) || !byId.has(e.target)) return
    ;[[e.source, e.target], [e.target, e.source]].forEach(([from, to]) => {
      degree.set(from, (degree.get(from) || 0) + 1)
      if (!neighbours.has(from)) neighbours.set(from, [])
      neighbours.get(from).push(to)
    })
  })
  const hubs = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, d]) => ({ node: byId.get(id), degree: d, neighbourIds: neighbours.get(id) }))
  const unlinkedIds = nodes.filter(n => !degree.has(n.id)).map(n => n.id)
  const unlinked = unlinkedIds.length

  // Rhythm: weekday (Mon-first) x hour of day, in local time.
  const rhythm = WEEKDAYS.map(() => Array(24).fill(0))
  const rhythmIds = WEEKDAYS.map(() => Array.from({ length: 24 }, () => []))
  const byWeekday = Array(7).fill(0)
  const byHour = Array(24).fill(0)
  withTime.forEach(n => {
    const d = new Date(n.data.timestamp)
    const wd = (d.getDay() + 6) % 7
    rhythm[wd][d.getHours()] += 1
    rhythmIds[wd][d.getHours()].push(n.id)
    byWeekday[wd] += 1
    byHour[d.getHours()] += 1
  })
  const rhythmMax = Math.max(0, ...rhythm.flat())
  const busiestWeekday = times.length ? byWeekday.indexOf(Math.max(...byWeekday)) : null
  const peakHour = times.length ? byHour.indexOf(Math.max(...byHour)) : null
  const dayPart = times.length
    ? DAY_PARTS
      .map(p => ({ ...p, count: byHour.reduce((sum, c, h) => sum + (p.test(h) ? c : 0), 0) }))
      .sort((a, b) => b.count - a.count)[0]
    : null

  const first = withTime.length
    ? withTime.reduce((min, n) => (n.data.timestamp < min.data.timestamp ? n : min))
    : null

  return {
    total: nodes.length,
    links: edges.length,
    avgLinks: nodes.length ? (2 * edges.length) / nodes.length : 0,
    thisWeek,
    thisWeekIds,
    lastWeek,
    streak,
    longestStreak,
    daily,
    activeDays: perDay.size,
    mix,
    thin,
    shape,
    recentCount: recentNodes.length,
    trending,
    topKeywords,
    hubs,
    unlinked,
    unlinkedIds,
    rhythm,
    rhythmIds,
    rhythmMax,
    busiestWeekday,
    peakHour,
    dayPart,
    first
  }
}

// Sequential single-hue scale for the rhythm grid: 0 = empty, then 4
// steps of the accent colour, light to strong.
function heatLevel(count, max) {
  if (!count) return 0
  if (max <= 1) return 4
  return Math.min(4, 1 + Math.floor(((count - 1) / (max - 1)) * 3.999))
}

function Sparkline({ values, label }) {
  const w = 96
  const h = 28
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / range) * (h - 6)])
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg className="stats-spark" width={w} height={h} role="img" aria-label={label}>
      <path d={`M${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join('L')}`} />
      <circle cx={lx} cy={ly} r={2.5} />
    </svg>
  )
}

function Delta({ current, previous }) {
  const diff = current - previous
  if (diff === 0) return <span className="stats-delta">same as last week</span>
  return (
    <span className="stats-delta">
      <span aria-hidden="true">{diff > 0 ? '↑' : '↓'}</span> {Math.abs(diff)} vs last week
    </span>
  )
}

// A radar of category shares: all time filled, the last few days as an
// outline. Both use one scale (the largest share of either) so they compare.
function BrainShape({ shape }) {
  const size = 240
  const c = size / 2
  const r = 78
  const max = Math.max(0.01, ...shape.flatMap(s => [s.all, s.recent ?? 0]))
  const point = (i, v) => {
    const angle = -Math.PI / 2 + (i / shape.length) * Math.PI * 2
    return [c + Math.cos(angle) * r * v, c + Math.sin(angle) * r * v]
  }
  // Square-root scale: one big category (Project) would otherwise squash
  // every other spoke into the middle and the shape into a single spike.
  const polygon = key => shape.map((s, i) => point(i, Math.sqrt((s[key] ?? 0) / max)).map(n => n.toFixed(1)).join(',')).join(' ')
  const hasRecent = shape.some(s => s.recent !== null)

  return (
    <svg className="reflect-shape" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share of memories per category, all time and recently">
      {[0.33, 0.66, 1].map(f => (
        <polygon key={f} className="reflect-shape-ring" points={shape.map((_, i) => point(i, f).join(',')).join(' ')} />
      ))}
      {shape.map((s, i) => {
        const [x, y] = point(i, 1)
        return <line key={s.category} className="reflect-shape-spoke" x1={c} y1={c} x2={x} y2={y} />
      })}
      <polygon className="reflect-shape-all" points={polygon('all')} />
      {hasRecent && <polygon className="reflect-shape-recent" points={polygon('recent')} />}
      {shape.map((s, i) => {
        const [x, y] = point(i, 1.22)
        return (
          <g key={s.category}>
            <circle cx={point(i, 1)[0]} cy={point(i, 1)[1]} r="2.5" fill={getCategoryColor(s.category)} />
            <text
              className="reflect-shape-label"
              x={x}
              y={y}
              textAnchor={Math.abs(x - c) < 8 ? 'middle' : x > c ? 'start' : 'end'}
              dominantBaseline="middle"
            >
              {s.category}
              <title>{`${s.category}: ${Math.round(s.all * 100)}% of all memories${s.recent !== null ? `, ${Math.round(s.recent * 100)}% lately` : ''}`}</title>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// "It's wondering": one open question at a time (with a pager), and
// underneath, what to ask about next - Surprise me, a category, a random
// handful of keywords, or anything typed.
function WonderingCard({ api, onSelectNodeId, message, onMessage }) {
  const [index, setIndex] = useState(0)
  const { questions } = api
  const shown = Math.min(index, questions.length - 1)
  const current = questions[shown]

  return (
    <section className={`stats-card stats-span-2 reflect-wondering${current ? "" : " is-caught-up"}`} aria-label="What your brain is wondering">
      <div className="reflect-card-head">
        <h2>It's wondering</h2>
        {questions.length > 1 && (
          <div className="reflect-pager">
            <button type="button" onClick={() => setIndex((shown - 1 + questions.length) % questions.length)} aria-label="Previous question">‹</button>
            <span>{shown + 1} of {questions.length}</span>
            <button type="button" onClick={() => setIndex((shown + 1) % questions.length)} aria-label="Next question">›</button>
          </div>
        )}
      </div>

      {current ? (
        <div className="reflect-question">
          <QuestionItem key={current.id} question={current} api={api} onSelectNodeId={onSelectNodeId} onMessage={onMessage} />
        </div>
      ) : (
        <p className="reflect-caught-up">No open questions. Pick something for it to ask you about.</p>
      )}

      <div className="reflect-picker">
        <AskMePicker
          api={api}
          onMessage={onMessage}
          keywordLimit={PICKER_KEYWORDS}
          title={current ? 'Or ask me about…' : 'What should I ask you about?'}
        />
      </div>
      {message && <p className="home-tidy-message">{message}</p>}
    </section>
  )
}

// Reflect: your brain in numbers and what it's still wondering about.
// Stats and Reflect used to be two pages; merged 2026-10-06.
function ReflectView({ nodes, edges, api, onSelectNode, onViewInBrain, digests, onDigestCreated, parked = false }) {
  const stats = useMemo(() => computeStats(nodes, edges), [nodes, edges])
  const growth = useMemo(() => computeGrowth(nodes), [nodes])
  const nodesById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const selectById = (id) => { if (nodesById.has(id)) onSelectNode(nodesById.get(id)) }
  const [digestStatus, setDigestStatus] = useState(null) // null | 'loading' | 'error' | 'empty'
  const [tooltip, setTooltip] = useState(null) // { grid, text, x, y }
  const [message, setMessage] = useState(null)
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE)

  const answered = api.history.filter(q => q.status === 'answered')
  const skipped = api.history.filter(q => q.status === 'skipped').length
  const dismissed = api.history.filter(q => q.status === 'dismissed').length

  const askAboutCategory = async (category) => {
    setMessage(null)
    setMessage(await api.generate({ kind: 'category', value: category }))
  }

  const requestDigest = async () => {
    setDigestStatus('loading')
    try {
      const response = await fetch('/api/stats/digest', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message)
      if (!data.digest) {
        setDigestStatus('empty')
        return
      }
      onDigestCreated(data.digest)
      setDigestStatus(null)
    } catch (error) {
      console.error('Digest failed:', error)
      setDigestStatus('error')
    }
  }

  const showTip = (grid, text) => (e) => setTooltip({
    grid,
    text,
    x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2,
    y: e.currentTarget.offsetTop
  })

  const [latestDigest, ...pastDigests] = digests

  const digestMemoriesLink = (digest) => {
    const ids = digestMemoryIds(nodes, digest)
    if (ids.length === 0) return <>{digest.memory_count} memories</>
    return (
      <button
        type="button"
        className="explore-link"
        onClick={() => onViewInBrain(ids, `Digest · ${formatDate(digest.period_start)} – ${formatDate(digest.period_end)}`)}
        title="See those memories in 3D"
      >
        {digest.memory_count} memories
      </button>
    )
  }

  const topCategory = stats.mix[0]?.count ? stats.mix[0] : null
  const topTrend = stats.trending[0]
  const kwMax = stats.topKeywords[0]?.ids.length || 1
  const busy = Boolean(api.generating)

  return (
    <div className={`stats-view${parked ? ' is-parked' : ''}`} aria-hidden={parked || undefined}>
      <header className="stats-hero">
        <p className="stats-eyebrow">Reflect</p>
        <h1>
          {topCategory
            ? <>You're <strong>{Math.round(topCategory.share * 100)}% {topCategory.category}</strong>{topTrend && <>, and lately you've been really into <strong>{topTrend.keyword}</strong></>}.</>
            : 'Your brain hasn’t learned anything yet.'}
        </h1>
        {stats.thin.length > 0 && (
          <p className="reflect-hero-sub">It knows least about {listNames(stats.thin)}.</p>
        )}
      </header>

      <section className="stats-card stats-growth" aria-label="Growth over time">
        <div className="stats-growth-head">
          <div>
            <h2>Growth</h2>
            <p className="stats-card-sub">Your running total, with new memories underneath. Hover to see what you added.</p>
          </div>
          <div className="stats-growth-total">
            <span className="stats-tile-value">{stats.total}</span>
            <span className="stats-tile-label">memories{stats.first && <> since {formatDate(stats.first.data.timestamp)}</>}</span>
          </div>
        </div>
        <GrowthChart growth={growth} />
      </section>

      <section className="stats-tiles" aria-label="Headline numbers">
        <div className="stats-tile">
          <span className="stats-tile-label">Added this week</span>
          {stats.thisWeek > 0 ? (
            <button
              type="button"
              className="stats-tile-value stats-tile-link"
              onClick={() => onViewInBrain(stats.thisWeekIds, `${plural(stats.thisWeek, 'memory', 'memories')} this week`)}
              title="See them in Explore"
            >
              {stats.thisWeek}
            </button>
          ) : <span className="stats-tile-value">0</span>}
          <Delta current={stats.thisWeek} previous={stats.lastWeek} />
          <Sparkline values={stats.daily} label={`New memories per day over the last ${SPARK_DAYS} days`} />
        </div>
        <div className="stats-tile">
          <span className="stats-tile-label">Capture streak</span>
          <span className="stats-tile-value">{stats.streak}<small> day{stats.streak === 1 ? '' : 's'}</small></span>
          <span className="stats-delta">longest: {plural(stats.longestStreak, 'day')} · {plural(stats.activeDays, 'active day')}</span>
        </div>
        <div className="stats-tile">
          <span className="stats-tile-label">Connections</span>
          <span className="stats-tile-value">{stats.links}</span>
          <span className="stats-delta">
            {stats.avgLinks.toFixed(1)} per memory · {stats.unlinked > 0 ? (
              <button
                type="button"
                className="explore-link"
                onClick={() => onViewInBrain(stats.unlinkedIds, plural(stats.unlinked, 'unlinked memory', 'unlinked memories'))}
                title="See them in Explore"
              >
                {plural(stats.unlinked, 'unlinked memory', 'unlinked memories')}
              </button>
            ) : '0 unlinked memories'}
          </span>
        </div>
        <div className="stats-tile">
          <span className="stats-tile-label">Questions answered</span>
          <span className="stats-tile-value">{answered.length}</span>
          <span className="stats-delta">{skipped} skipped · {dismissed} not relevant</span>
          <span className="stats-delta">{plural(api.questions.length, 'open question')}</span>
        </div>
      </section>

      <div className="stats-grid">
        <WonderingCard api={api} onSelectNodeId={selectById} message={message} onMessage={setMessage} />

        <section className="stats-card">
          <h2>Your mix</h2>
          <p className="stats-card-sub">Memories per category. Hover one to be asked about it; ✦ marks what it knows least.</p>
          <ul className="stats-bars reflect-mix">
            {stats.mix.map(({ category, count, ids, share }) => (
              <li key={category} className={stats.thin.includes(category) ? 'is-thin' : ''}>
                <span className="stats-bar-label" title={`${category}: ${count} memories (${Math.round(share * 100)}%)`}>
                  <span className="stats-dot" style={{ background: getCategoryColor(category) }} />
                  {count > 0 ? (
                    <button
                      type="button"
                      className="explore-link"
                      onClick={() => onViewInBrain(ids, `Category: ${category}`)}
                      title={`See your ${category} memories in 3D`}
                    >
                      {category}
                    </button>
                  ) : category}
                  {stats.thin.includes(category) && <span className="reflect-thin-mark" title="Your brain knows least about this">✦</span>}
                </span>
                <span className="stats-bar-track">
                  <span className="stats-bar-fill" style={{ width: `${(count / Math.max(1, stats.mix[0].count)) * 100}%`, background: getCategoryColor(category) }} />
                </span>
                <span className="stats-bar-value">{count}</span>
                <button
                  type="button"
                  className="reflect-mix-ask"
                  onClick={() => askAboutCategory(category)}
                  disabled={busy}
                  title={`3 questions about your ${category} (about a cent)`}
                >
                  {api.generating === `category:${category}` ? '…' : 'Ask'}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="stats-card">
          <h2>Top keywords</h2>
          <p className="stats-card-sub">Your most-used keywords of all time. Click one to see it in 3D.</p>
          {stats.topKeywords.length === 0 ? (
            <p className="stats-empty">No keyword appears twice yet.</p>
          ) : (
            <ul className="stats-keywords">
              {stats.topKeywords.map(k => {
                const size = k.ids.length / kwMax
                return (
                  <li key={k.keyword}>
                    <button
                      type="button"
                      className={`stats-keyword stats-keyword-${size > 0.66 ? 3 : size > 0.33 ? 2 : 1}`}
                      onClick={() => onViewInBrain(k.ids, `Keyword: ${k.keyword}`)}
                      title={`${k.keyword}: ${plural(k.ids.length, 'memory', 'memories')}`}
                    >
                      {k.keyword}<span className="stats-keyword-count">{k.ids.length}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="stats-card">
          <h2>Trending lately</h2>
          <p className="stats-card-sub">Topics that came up more in the last 7 days than usual.</p>
          {stats.trending.length === 0 ? (
            <p className="stats-empty">Not enough this week to spot a trend yet.</p>
          ) : (
            <ol className="stats-trending">
              {stats.trending.map(t => (
                <li key={t.keyword}>
                  <button
                    type="button"
                    className="stats-trending-word explore-link"
                    onClick={() => onViewInBrain(t.ids, `Trending: ${t.keyword}`)}
                    title="See this week's in 3D"
                  >
                    {t.keyword}
                  </button>
                  <span className="stats-trending-meta">
                    {t.count}× this week{t.isNew && <span className="stats-new">new</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="stats-card">
          <h2>Your brain's hubs</h2>
          {stats.hubs.length > 0 ? (
            <>
              <p className="stats-card-sub">Your most connected memories.</p>
              <ol className="stats-ranked">
                {stats.hubs.map(({ node, degree, neighbourIds }) => (
                  <li key={node.id}>
                    <button type="button" className="stats-memory" onClick={() => onSelectNode(node)}>{node.data.title}</button>
                    <span className="stats-bar-track">
                      <span className="stats-bar-fill" style={{ width: `${(degree / stats.hubs[0].degree) * 100}%` }} />
                    </span>
                    <button
                      type="button"
                      className="stats-bar-value explore-link"
                      onClick={() => onViewInBrain([node.id, ...neighbourIds], `Hub: ${node.data.title}`)}
                      title={`See its ${plural(degree, 'link')} in 3D`}
                    >
                      {degree}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : <p className="stats-empty">No connections yet.</p>}
        </section>

        <section className="stats-card stats-span-2">
          <h2>Your rhythm</h2>
          <p className="stats-card-sub">When you capture memories, by day of the week and hour (your local time).</p>
          {stats.dayPart ? (
            <>
              <div className="stats-rhythm-callouts">
                <div>
                  <span className="stats-callout-value">{stats.dayPart.label}</span>
                  <span className="stats-tile-label">{stats.dayPart.hint}</span>
                </div>
                <div>
                  <span className="stats-callout-value">{WEEKDAY_NAMES[stats.busiestWeekday]}</span>
                  <span className="stats-tile-label">your busiest day</span>
                </div>
                <div>
                  <span className="stats-callout-value">{formatHour(stats.peakHour)}</span>
                  <span className="stats-tile-label">your peak hour</span>
                </div>
              </div>
              <div className="stats-rhythm-wrap" onMouseLeave={() => setTooltip(null)}>
                <div className="stats-rhythm" role="img" aria-label="Captures by weekday and hour">
                  {stats.rhythm.map((hours, wd) => (
                    <div className="stats-rhythm-row" key={WEEKDAYS[wd]}>
                      <span className="stats-rhythm-day">{WEEKDAYS[wd]}</span>
                      {hours.map((count, h) => (
                        <span
                          key={h}
                          className={`stats-heat stats-rhythm-cell stats-heat-${heatLevel(count, stats.rhythmMax)}${count ? ' is-clickable' : ''}`}
                          onMouseEnter={showTip('rhythm', `${WEEKDAY_NAMES[wd]}, ${formatHour(h)}–${formatHour((h + 1) % 24)}: ${plural(count, 'memory', 'memories')}${count ? ' · click to see in 3D' : ''}`)}
                          onClick={count ? () => onViewInBrain(stats.rhythmIds[wd][h], `${WEEKDAY_NAMES[wd]}, ${formatHour(h)}–${formatHour((h + 1) % 24)}`) : undefined}
                        />
                      ))}
                    </div>
                  ))}
                  <div className="stats-rhythm-row stats-rhythm-hours" aria-hidden="true">
                    <span className="stats-rhythm-day" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span key={h}>{h % 6 === 0 ? formatHour(h) : ''}</span>
                    ))}
                  </div>
                </div>
                {tooltip?.grid === 'rhythm' && (
                  <div className="stats-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>{tooltip.text}</div>
                )}
              </div>
            </>
          ) : <p className="stats-empty">Nothing captured yet.</p>}
        </section>

        <section className="stats-card reflect-shape-card">
          <h2>Your brain's shape</h2>
          <p className="stats-card-sub">
            Share of memories per category.
            <span className="reflect-shape-key reflect-shape-key-all">all time</span>
            {stats.recentCount > 0 && <span className="reflect-shape-key reflect-shape-key-recent">last {RECENT_DAYS} days</span>}
          </p>
          {stats.total > 0 ? <BrainShape shape={stats.shape} /> : <p className="stats-empty">Nothing captured yet.</p>}
        </section>

        <section className="stats-card stats-span-3 reflect-history" aria-label="What you've told it">
          <h2>What you've told it</h2>
          {answered.length === 0 ? (
            <p className="stats-empty">Answers you give show up here, with the memories they became.</p>
          ) : (
            <ul className="reflect-answer-list">
              {answered.slice(0, historyShown).map(q => (
                <li key={q.id}>
                  <div className="reflect-answer-meta">{formatShortDate(q.closed_at)}</div>
                  <p className="reflect-answer-question">{q.question}</p>
                  <p className="reflect-answer-text">{q.answer}</p>
                  {q.answer_node_ids.some(id => nodesById.has(id)) && (
                    <div className="reflect-answer-nodes">
                      {q.answer_node_ids.filter(id => nodesById.has(id)).map(id => (
                        <button key={id} type="button" className="home-week-chip" onClick={() => selectById(id)}>
                          {nodesById.get(id).data.title}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {answered.length > HISTORY_PAGE && (
            <div className="reflect-more">
              {historyShown < answered.length && (
                <button type="button" className="question-link" onClick={() => setHistoryShown(n => n + HISTORY_PAGE)}>
                  Show more ({answered.length - historyShown} older)
                </button>
              )}
              {historyShown > HISTORY_PAGE && (
                <button type="button" className="question-link" onClick={() => setHistoryShown(HISTORY_PAGE)}>
                  Show fewer
                </button>
              )}
            </div>
          )}
        </section>

        <section className="stats-card stats-span-3 stats-digest">
          <div className="stats-digest-head">
            <div>
              <h2>Catch-up digest</h2>
              <p className="stats-card-sub">A short recap of what's new since your last digest (at most the last 7 days), written by Claude. Only runs when you click - about 1–2¢ each (see COST.md).</p>
            </div>
            <button
              type="button"
              className="stats-digest-button"
              onClick={requestDigest}
              disabled={digestStatus === 'loading'}
            >
              Catch me up
            </button>
          </div>
          {digestStatus === 'loading' && (
            <p className="stats-digest-loading" role="status">
              <span className="home-ask-pulse" aria-hidden="true"><span /><span /><span /></span>
              Reading your new memories…
            </p>
          )}
          {digestStatus === 'error' && <p className="stats-empty">Couldn't write the digest - check the server logs.</p>}
          {digestStatus === 'empty' && <p className="stats-empty">Nothing new since your last digest.</p>}
          {latestDigest && (
            <article className="stats-digest-entry">
              <div className="stats-digest-date">
                {formatDate(latestDigest.period_start)} – {formatDate(latestDigest.period_end)} · {digestMemoriesLink(latestDigest)}
              </div>
              <p className="stats-digest-text">{latestDigest.text}</p>
            </article>
          )}
          {pastDigests.length > 0 && (
            <details className="stats-digest-history">
              <summary>Past digests ({pastDigests.length})</summary>
              {pastDigests.map(d => (
                <article key={d.id} className="stats-digest-entry">
                  <div className="stats-digest-date">
                    {formatDate(d.period_start)} – {formatDate(d.period_end)} · {digestMemoriesLink(d)}
                  </div>
                  <p className="stats-digest-text">{d.text}</p>
                </article>
              ))}
            </details>
          )}
        </section>
      </div>
    </div>
  )
}

export default ReflectView
