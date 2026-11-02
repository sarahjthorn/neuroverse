import { useMemo, useState } from 'react'

const DAY_MS = 24 * 60 * 60 * 1000

const formatHour = (h) => `${String(h).padStart(2, '0')}:00`

// The last 7 days by hour of day: one bar per hour, its height how many
// memories you captured in that hour this week. (Was a radial clock, which
// got squashed when the Home rail ran short of height.)
function computeWeek(nodes) {
  const now = Date.now()
  const byHour = Array(24).fill(0)
  const keywords = new Map()
  let total = 0
  let lastWeek = 0
  nodes.forEach(n => {
    if (!n.data.timestamp) return
    const t = new Date(n.data.timestamp).getTime()
    if (t >= now - 14 * DAY_MS && t < now - 7 * DAY_MS) lastWeek += 1
    if (t < now - 7 * DAY_MS) return
    total += 1
    byHour[new Date(t).getHours()] += 1
    new Set((n.data.keywords || []).map(k => k.trim()).filter(Boolean)).forEach(k => {
      const key = k.toLowerCase()
      if (!keywords.has(key)) keywords.set(key, { keyword: k, ids: [] })
      keywords.get(key).ids.push(n.id)
    })
  })
  const max = Math.max(0, ...byHour)
  return {
    byHour,
    max,
    total,
    lastWeek,
    peakHour: max > 0 ? byHour.indexOf(max) : null,
    topKeywords: [...keywords.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, 3)
  }
}

function WeekClock({ nodes, onViewInBrain }) {
  const week = useMemo(() => computeWeek(nodes), [nodes])
  const [hover, setHover] = useState(null)
  const nowHour = new Date().getHours()
  const diff = week.total - week.lastWeek

  return (
    <div className="home-card home-week">
      <div className="home-week-head">
        <div className="home-card-label">Your week, by hour</div>
        <span className="home-week-total">
          {hover !== null
            ? <><strong>{week.byHour[hover]}</strong> at {formatHour(hover)}</>
            : <><strong>{week.total}</strong> this week</>}
        </span>
      </div>
      <div
        className="home-week-strip"
        role="img"
        aria-label={
          week.total === 0
            ? 'No memories captured in the last 7 days.'
            : `${week.total} memories in the last 7 days, most around ${formatHour(week.peakHour)}.`
        }
        onMouseLeave={() => setHover(null)}
      >
        {week.byHour.map((count, h) => (
          <span
            key={h}
            className={`home-week-col${hover === h ? ' is-hover' : ''}${h === nowHour ? ' is-now' : ''}`}
            onMouseEnter={() => setHover(h)}
          >
            <span
              className="home-week-bar"
              style={{ height: count && week.max ? `${12 + 88 * (count / week.max)}%` : 0 }}
            />
          </span>
        ))}
      </div>
      <div className="home-week-axis" aria-hidden="true">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
      <p className="home-card-body home-week-summary">
        {week.total === 0
          ? 'Nothing captured in the last 7 days.'
          : <>Mostly around <strong>{formatHour(week.peakHour)}</strong> · {diff === 0 ? 'same as last week' : `${diff > 0 ? '↑' : '↓'} ${Math.abs(diff)} vs last week`}</>}
      </p>
      {week.topKeywords.length > 0 && (
        <div className="home-week-keywords">
          {week.topKeywords.map(k => (
            <button
              key={k.keyword}
              type="button"
              className="home-week-chip"
              onClick={() => onViewInBrain(k.ids, `This week: ${k.keyword}`)}
              title={`Show the ${k.ids.length} memories about ${k.keyword} in 3D`}
            >
              {k.keyword}<span>{k.ids.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default WeekClock
