import { useEffect, useMemo, useRef, useState } from 'react'
import './TimeRangeScrubber.css'

// The slider's own domain is always 0-1000 regardless of the data's actual
// timestamp span - large ms-since-epoch values as a native <input type=range>
// value work fine, but normalizing keeps the play/animation step size (below)
// independent of how wide the real date range is.
const SLIDER_MAX = 1000
// Replay follows real time, but no quiet stretch between two memories ever
// takes longer than MAX_PAUSE_MS on screen - empty hours and days whizz by
// instead of a second or more of nothing (Sarah, 2026-10-06). The time scale
// is picked so the whole replay still takes about PLAY_DURATION_MS (less if
// the brain is small enough that every pause is capped).
const PLAY_DURATION_MS = 12000
const MAX_PAUSE_MS = 250

// Replay schedule: for each distinct memory time, the moment (ms into the
// replay) the playhead reaches it. Finds the time scale (screen ms per real
// ms) by bisection so the capped pauses add up to PLAY_DURATION_MS.
function buildSchedule(times) {
  const real = [...new Set(times)].sort((a, b) => a - b)
  const gaps = real.slice(1).map((t, i) => t - real[i])
  const total = rate => gaps.reduce((sum, g) => sum + Math.min(g * rate, MAX_PAUSE_MS), 0)
  let lo = 0
  let hi = 1
  while (total(hi) < PLAY_DURATION_MS && hi < 1e12) hi *= 2
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (total(mid) < PLAY_DURATION_MS) lo = mid
    else hi = mid
  }
  const at = [0]
  gaps.forEach(g => at.push(at[at.length - 1] + Math.min(g * hi, MAX_PAUSE_MS)))
  return { real, at }
}

// Where the playhead is (real ms) `elapsed` ms into the replay; it moves
// steadily through each gap, so a capped gap is swept quickly, not skipped.
function realAt({ real, at }, elapsed) {
  if (elapsed <= 0) return real[0]
  let i = at.findIndex(a => a > elapsed)
  if (i < 0) return real[real.length - 1]
  const f = (elapsed - at[i - 1]) / (at[i] - at[i - 1])
  return real[i - 1] + f * (real[i] - real[i - 1])
}

// The inverse: how far into the replay a given real time is.
function elapsedAt({ real, at }, ms) {
  let i = real.findIndex(r => r > ms)
  if (i <= 0) return i === 0 ? 0 : at[at.length - 1]
  const f = (ms - real[i - 1]) / (real[i] - real[i - 1])
  return at[i - 1] + f * (at[i] - at[i - 1])
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Playhead-style "as of" scrubber rather than a two-handle range: for a
// memory timeline, "show me everything up to this point" is the more useful
// question than "show me a slice between two arbitrary dates," and it's what
// naturally supports the replay stretch goal (auto-advancing this same
// playhead from the start).
function TimeRangeScrubber({ nodes, playheadMs, onChange }) {
  const [playing, setPlaying] = useState(false)
  const playRef = useRef(null)

  const [minMs, maxMs, schedule] = useMemo(() => {
    const times = nodes.map(n => n.data.timestamp && new Date(n.data.timestamp).getTime()).filter(Boolean)
    if (times.length === 0) return [null, null, null]
    return [Math.min(...times), Math.max(...times), buildSchedule(times)]
  }, [nodes])

  const isLive = playheadMs === null
  const effectiveMs = isLive ? maxMs : playheadMs
  const sliderValue = minMs == null || maxMs === minMs
    ? SLIDER_MAX
    : Math.round(((effectiveMs - minMs) / (maxMs - minMs)) * SLIDER_MAX)

  const stopPlaying = () => {
    setPlaying(false)
    if (playRef.current) {
      cancelAnimationFrame(playRef.current.raf)
      playRef.current = null
    }
  }

  const handleSliderChange = (e) => {
    stopPlaying()
    const t = Number(e.target.value)
    const ms = minMs + (t / SLIDER_MAX) * (maxMs - minMs)
    onChange(t >= SLIDER_MAX ? null : ms)
  }

  const handlePlayToggle = () => {
    if (playing) {
      stopPlaying()
      return
    }
    if (minMs == null) return
    const startMs = isLive || playheadMs >= maxMs ? minMs : playheadMs
    setPlaying(true)
    const end = schedule.at[schedule.at.length - 1]
    const startedAt = performance.now() - elapsedAt(schedule, startMs)
    const step = (now) => {
      const elapsed = now - startedAt
      const done = elapsed >= end
      onChange(done ? null : realAt(schedule, elapsed))
      if (!done) {
        playRef.current = { raf: requestAnimationFrame(step) }
      } else {
        setPlaying(false)
        playRef.current = null
      }
    }
    playRef.current = { raf: requestAnimationFrame(step) }
  }

  useEffect(() => () => {
    if (playRef.current) cancelAnimationFrame(playRef.current.raf)
  }, [])

  if (minMs == null) return null

  return (
    // Collapsed to just the play button until you hover it (or tab into
    // it); stays open while replaying or scrubbed back in time, so the
    // "as of" date is never hidden while it's in effect.
    <div className={`time-scrubber ${playing || !isLive ? 'is-open' : ''}`}>
      <button
        type="button"
        className="time-scrubber-play"
        onClick={handlePlayToggle}
        aria-label={playing ? 'Pause replay' : 'Replay from start'}
        title={playing ? 'Pause replay' : 'Replay from start'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><rect x="3" y="2.5" width="3.5" height="11" /><rect x="9.5" y="2.5" width="3.5" height="11" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M4 2.5v11l9-5.5-9-5.5z" /></svg>
        )}
      </button>

      <div className="time-scrubber-rest">
      <span className="time-scrubber-label">{shortDate(minMs)}</span>

      <input
        type="range"
        className="time-scrubber-range"
        min={0}
        max={SLIDER_MAX}
        value={sliderValue}
        onChange={handleSliderChange}
      />

      <span className="time-scrubber-label">{shortDate(maxMs)}</span>

      <span className="time-scrubber-status">
        {isLive ? 'All time' : `As of ${shortDate(effectiveMs)}`}
      </span>
      </div>
    </div>
  )
}

export default TimeRangeScrubber
