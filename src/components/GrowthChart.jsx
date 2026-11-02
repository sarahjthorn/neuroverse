import { useEffect, useMemo, useRef, useState } from 'react'
import { getCategoryColor, nodeCategoryList } from '../utils/categories'

// Legacy memories with no category at all.
const UNCATEGORIZED = 'Uncategorized'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MARGIN = { top: 12, right: 12, left: 34 }
// Running total on top, new-memories-per-bucket strip underneath. The strip
// is a separate small chart sharing the x-axis (its own scale, no y-axis) -
// never a second y-axis on the same plot.
const MAIN_H = 160
const STRIP_GAP = 14
const STRIP_H = 36
const AXIS_H = 22
const HEIGHT = MARGIN.top + MAIN_H + STRIP_GAP + STRIP_H + AXIS_H

// Bucket size follows how much history there is, so a young brain still
// gets enough points for a real curve (a few daily points would smooth a
// burst of captures into a misleadingly gentle slope).
function pickUnit(spanMs) {
  if (spanMs < 7 * DAY_MS) return 'hour'
  if (spanMs < 90 * DAY_MS) return 'day'
  return 'week'
}

function floorTo(t, unit) {
  const d = new Date(t)
  if (unit === 'hour') d.setMinutes(0, 0, 0)
  else {
    d.setHours(0, 0, 0, 0)
    if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  }
  return d.getTime()
}

function step(t, unit) {
  const d = new Date(t)
  if (unit === 'hour') d.setHours(d.getHours() + 1)
  else d.setDate(d.getDate() + (unit === 'week' ? 7 : 1))
  return d.getTime()
}

function formatBucket(t, unit) {
  const d = new Date(t)
  if (unit === 'hour') return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return unit === 'week' ? `Week of ${label}` : label
}

function formatAxis(t, unit) {
  const d = new Date(t)
  // Hourly buckets can cover up to a week, so keep the date on them.
  if (unit === 'hour') return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// 3-5 gridlines with a round step, picking whichever puts the top line
// closest above the data (so 61 gets 0/25/50/75, not 0/50/100).
function niceTicks(max) {
  if (max <= 0) return [0, 1]
  let best = null
  for (let mag = 10 ** Math.floor(Math.log10(max / 5)); mag <= max; mag *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const stepSize = m * mag
      if (stepSize < 1) continue
      const count = Math.ceil(max / stepSize)
      if (count < 3 || count > 5) continue
      const top = count * stepSize
      if (!best || top < best.top) best = { top, stepSize, count }
    }
  }
  if (!best) best = { stepSize: Math.max(1, Math.ceil(max / 4)), count: 4 }
  return Array.from({ length: best.count + 1 }, (_, i) => i * best.stepSize)
}

// Monotone cubic (Fritsch-Carlson) through points sorted by x: smooth, but
// never overshoots - a running total must not appear to dip.
function monotoneSegments(pts) {
  const n = pts.length
  if (n < 2) return []
  const dx = [], slope = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0])
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i])
  }
  const m = [slope[0]]
  for (let i = 1; i < n - 1; i++) {
    m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2)
  }
  m.push(slope[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i]
    const h = a * a + b * b
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i] }
  }
  return pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1]
    const d = dx[i] / 3
    return [p, [p[0] + d, p[1] + m[i] * d], [q[0] - d, q[1] - m[i + 1] * d], q]
  })
}

const f1 = (n) => n.toFixed(1)
const curveTo = (seg) => `C${f1(seg[1][0])},${f1(seg[1][1])} ${f1(seg[2][0])},${f1(seg[2][1])} ${f1(seg[3][0])},${f1(seg[3][1])}`

function linePath(pts) {
  const segs = monotoneSegments(pts)
  return `M${f1(pts[0][0])},${f1(pts[0][1])}` + segs.map(curveTo).join('')
}

// Upper edge left-to-right, then the lower edge right-to-left along the
// same curve (segments reversed, control points swapped).
function areaPath(upper, lower) {
  const back = monotoneSegments(lower).reverse().map(([a, b, c, d]) => [d, c, b, a])
  const last = lower[lower.length - 1]
  return linePath(upper) + `L${f1(last[0])},${f1(last[1])}` + back.map(curveTo).join('') + 'Z'
}

// Cumulative memories over time, plus what was added in each bucket broken
// down by each memory's primary (first) category (shown on hover).
export function computeGrowth(nodes) {
  const dated = nodes
    .filter(n => n.data.timestamp)
    .map(n => ({ t: new Date(n.data.timestamp).getTime(), cat: nodeCategoryList(n.data)[0] || UNCATEGORIZED }))
  if (dated.length === 0) return null

  const now = Date.now()
  const first = Math.min(...dated.map(d => d.t))
  const unit = pickUnit(now - first)

  const totals = new Map()
  dated.forEach(d => totals.set(d.cat, (totals.get(d.cat) || 0) + 1))
  // Biggest categories first (tooltip order breaks ties this way).
  const series = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)

  // One empty bucket before the first memory so the curve starts at zero.
  const firstStart = floorTo(first, unit)
  const starts = [firstStart - (step(firstStart, unit) - firstStart)]
  for (let t = firstStart; t <= now; t = step(t, unit)) starts.push(t)

  const added = starts.map(() => Object.fromEntries(series.map(s => [s, 0])))
  dated.forEach(d => {
    let i = starts.length - 1
    while (i > 0 && starts[i] > d.t) i--
    added[i][d.cat] += 1
  })

  const running = Object.fromEntries(series.map(s => [s, 0]))
  const buckets = starts.map((t, i) => {
    series.forEach(s => { running[s] += added[i][s] })
    const cumulative = { ...running }
    return {
      t,
      cumulative,
      total: series.reduce((sum, s) => sum + cumulative[s], 0),
      added: series.reduce((sum, s) => sum + added[i][s], 0),
      addedBy: series.filter(s => added[i][s] > 0).sort((a, b) => added[i][b] - added[i][a]).map(s => [s, added[i][s]])
    }
  })

  return { unit, series, buckets }
}

const seriesColor = (s) => (s === UNCATEGORIZED ? 'var(--text-faint)' : getCategoryColor(s))

function GrowthChart({ growth }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [Boolean(growth)]) // the plot only mounts once there's data

  const geom = useMemo(() => {
    if (!growth || width === 0) return null
    const { buckets } = growth
    const innerW = Math.max(10, width - MARGIN.left - MARGIN.right)
    const ticks = niceTicks(Math.max(...buckets.map(b => b.total)))
    const yMax = ticks[ticks.length - 1] || 1
    const x = (i) => MARGIN.left + (buckets.length === 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW)
    const y = (v) => MARGIN.top + MAIN_H - (v / yMax) * MAIN_H
    const baseline = MARGIN.top + MAIN_H

    const pts = buckets.map((b, i) => [x(i), y(b.total)])
    const line = linePath(pts)
    const area = areaPath(pts, pts.map(([px]) => [px, baseline]))

    const stripTop = baseline + STRIP_GAP
    const stripBase = stripTop + STRIP_H
    const addedMax = Math.max(1, ...buckets.map(b => b.added))
    const slot = innerW / Math.max(1, buckets.length - 1)
    const barW = Math.max(1.5, Math.min(14, slot - 2))
    const bars = buckets.map((b, i) => ({
      i,
      x: x(i) - barW / 2,
      h: b.added ? Math.max(2, (b.added / addedMax) * STRIP_H) : 0
    }))

    const labelIdx = buckets.length <= 2 ? [buckets.length - 1] : [1, Math.round(buckets.length / 2), buckets.length - 1]
    return { x, y, ticks, line, area, bars, barW, stripTop, stripBase, addedMax, innerW, labelIdx: [...new Set(labelIdx)] }
  }, [growth, width])

  if (!growth) return <p className="stats-empty">Nothing captured yet.</p>

  const { buckets, unit } = growth
  const handleMove = (e) => {
    if (!geom) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left - MARGIN.left
    const i = buckets.length === 1 ? 0 : Math.round((px / geom.innerW) * (buckets.length - 1))
    setHover(Math.max(0, Math.min(buckets.length - 1, i)))
  }

  const hovered = hover !== null ? buckets[hover] : null
  const lastIdx = buckets.length - 1
  const last = buckets[lastIdx]
  const pointIdx = hover ?? lastIdx

  return (
    <div className="growth">
      <div className="growth-plot" ref={wrapRef} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        {geom && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Memories over time: ${last.total} in total.`}
          >
            <defs>
              <linearGradient id="growth-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {geom.ticks.map(v => (
              <g key={v}>
                <line className="growth-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={geom.y(v)} y2={geom.y(v)} />
                <text className="growth-axis" x={MARGIN.left - 8} y={geom.y(v)} textAnchor="end" dominantBaseline="middle">{v}</text>
              </g>
            ))}
            <path d={geom.area} fill="url(#growth-fill)" />
            <path d={geom.line} className="growth-line" />

            <text className="growth-axis" x={MARGIN.left - 8} y={geom.stripBase - STRIP_H / 2} textAnchor="end" dominantBaseline="middle">new</text>
            <line className="growth-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={geom.stripBase} y2={geom.stripBase} />
            {geom.bars.map(b => b.h > 0 && (
              <path
                key={b.i}
                className={`growth-bar${hover === b.i ? ' is-active' : ''}`}
                d={topRoundedBar(b.x, geom.stripBase, geom.barW, b.h)}
              />
            ))}

            {geom.labelIdx.map(i => (
              <text
                key={i}
                className="growth-axis"
                x={geom.x(i)}
                y={HEIGHT - 6}
                textAnchor={i === lastIdx ? 'end' : 'middle'}
              >
                {formatAxis(buckets[i].t, unit)}
              </text>
            ))}
            {hovered && (
              <line className="growth-crosshair" x1={geom.x(hover)} x2={geom.x(hover)} y1={MARGIN.top} y2={geom.stripBase} />
            )}
            <circle className="growth-point" cx={geom.x(pointIdx)} cy={geom.y(buckets[pointIdx].total)} r={4.5} />
          </svg>
        )}
        {geom && hovered && (
          <div
            className={`growth-tooltip ${geom.x(hover) > width * 0.6 ? 'is-left' : ''}`}
            style={{ left: geom.x(hover), top: MARGIN.top }}
          >
            <div className="growth-tooltip-date">{formatBucket(hovered.t, unit)}</div>
            <div className="growth-tooltip-total">
              <strong>{hovered.total}</strong> memories
            </div>
            {hovered.added > 0 ? (
              <>
                <div className="growth-tooltip-sub">+{hovered.added} added</div>
                <ul>
                  {hovered.addedBy.slice(0, 4).map(([s, n]) => (
                    <li key={s}>
                      <span className="stats-dot" style={{ background: seriesColor(s) }} />
                      <span>{s}</span>
                      <span className="growth-tooltip-value">{n}</span>
                    </li>
                  ))}
                  {hovered.addedBy.length > 4 && (
                    <li className="growth-tooltip-more">
                      <span />
                      <span>{hovered.addedBy.length - 4} more</span>
                      <span className="growth-tooltip-value">{hovered.addedBy.slice(4).reduce((sum, [, n]) => sum + n, 0)}</span>
                    </li>
                  )}
                </ul>
              </>
            ) : <div className="growth-tooltip-sub">nothing new</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// Bar with 2px-rounded top corners and a square base sitting on the baseline.
function topRoundedBar(x, base, w, h) {
  const r = Math.min(2, w / 2, h)
  const top = base - h
  return `M${f1(x)},${f1(base)}V${f1(top + r)}Q${f1(x)},${f1(top)} ${f1(x + r)},${f1(top)}` +
    `H${f1(x + w - r)}Q${f1(x + w)},${f1(top)} ${f1(x + w)},${f1(top + r)}V${f1(base)}Z`
}

export default GrowthChart
