import { useCallback, useEffect, useMemo, useState } from 'react'
import AxonStrip from './AxonStrip'
import { getCategoryColor } from '../utils/categories'
import './AxonView.css'

// The Axon page (an optional tab): Axon's daily options
// (server/routes/inbox.js), with the
// creature swimming across the top. Pick one - the rest can wait. Sort by
// what suits your energy; one click opens whatever starts the task; series
// steps ask what you did so the next step can build on it. Below them,
// Axon's ideas: only the ones its critic said "do" (at most 3 a day), each
// answered yes / park / drop. No ideas, no section. Under them, past deep
// thinks (the deep-think ideas she has answered), each with its Doc
// and "Think again", which steers the next night's run back to it. Free:
// no model calls, just the inbox API.

const SORTS = [
  { id: 'impact', label: 'Impact', fn: (a, b) => (b.impact || 0) - (a.impact || 0) || (a.effort || 0) - (b.effort || 0) },
  { id: 'effort', label: 'Least effort', fn: (a, b) => (a.effort || 9) - (b.effort || 9) || (b.impact || 0) - (a.impact || 0) },
  { id: 'time', label: 'Quickest', fn: (a, b) => (a.minutes || 999) - (b.minutes || 999) || (b.impact || 0) - (a.impact || 0) }
]
const SORT_KEY = 'today-sort'

// The local calendar day of a timestamp, to match the server's `today`.
const localDay = iso => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const timeDots = m => (!m ? 0 : m <= 15 ? 1 : m <= 30 ? 2 : 3)

// A deep-think steer note, e.g. "next (28 Oct 16:40): keep going". The time
// makes each one unique, since the recipe uses every steer only once.
const steerNote = () => {
  const d = new Date()
  const when = `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `next (${when}): keep going`
}

function Dots({ n, color, label }) {
  return (
    <span className="today-dots" title={`${label}: ${n || '?'} of 3`}>
      {[1, 2, 3].map(i => (
        <span key={i} style={i <= n ? { background: color } : undefined} />
      ))}
    </span>
  )
}

function readSort() {
  try { return localStorage.getItem(SORT_KEY) || 'impact' } catch { return 'impact' }
}

// Category XP bars: the categories she's earned in, biggest first.
function CategoryBars({ byCategory }) {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
  const max = entries[0][1]
  return (
    <div className="axon-cats">
      {entries.map(([cat, xp]) => (
        <div key={cat} className="axon-cat">
          <span>{cat}</span>
          <span className="axon-cat-bar"><span style={{ width: `${Math.round((xp / max) * 100)}%`, background: getCategoryColor(cat) }} /></span>
          <span>{xp} XP</span>
        </div>
      ))}
    </div>
  )
}

function AxonView() {
  const [data, setData] = useState(null)
  const [past, setPast] = useState([])
  const [sort, setSort] = useState(readSort)
  const [selected, setSelected] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [errorFor, setErrorFor] = useState(null)

  const load = useCallback(() => {
    fetch('/api/inbox')
      .then(r => r.json())
      .then(setData)
      .catch(e => console.error('Failed to load the inbox:', e))
    fetch('/api/inbox?status=all')
      .then(r => r.json())
      .then(d => setPast((d.items || []).filter(i =>
        i.kind === 'idea' && i.source === 'axon-deep-think' && ['done', 'rejected'].includes(i.status))))
      .catch(e => console.error('Failed to load past deep thinks:', e))
  }, [])

  // Axon adds options in the background, so refresh when you come back
  // to the tab, and every few minutes while it's open.
  useEffect(() => {
    load()
    const timer = setInterval(load, 5 * 60 * 1000)
    window.addEventListener('focus', load)
    return () => { clearInterval(timer); window.removeEventListener('focus', load) }
  }, [load])

  const chooseSort = (id) => {
    setSort(id)
    try { localStorage.setItem(SORT_KEY, id) } catch { /* per-viewer nicety only */ }
  }

  const all = data?.items || []
  const items = all.filter(i => i.kind !== 'idea')
  // New ideas first, then parked ones (dimmed, like "not today" options).
  const ideas = [...all.filter(i => i.kind === 'idea' && i.status === 'new'), ...all.filter(i => i.kind === 'idea' && i.status === 'later')]
  const options = useMemo(() => {
    const fn = SORTS.find(s => s.id === sort)?.fn || SORTS[0].fn
    const open = items.filter(i => i.status === 'new').sort(fn)
    const later = items.filter(i => i.status === 'later').sort(fn)
    return [...open, ...later]
  }, [items, sort])
  const doneToday = items.filter(i => i.status === 'done' && localDay(i.status_changed_at) === data?.today)
  const current = options.find(o => o.id === selected) || options[0]

  const patch = async (item, body) => {
    setError('')
    const response = await fetch(`/api/inbox/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result
  }

  const act = async (item, status, extra = {}) => {
    try {
      await patch(item, { status, ...extra })
      setNoteFor(null)
      setNote('')
      setSelected(null)
      load()
    } catch (e) {
      setError(e.message)
      setErrorFor(item.id)
    }
  }

  // A note replaces any earlier one, so ask before dropping it. Parking it
  // brings it back under Ideas, where the rerun's answers are read.
  const thinkAgain = async (item) => {
    if (item.outcome_note && !window.confirm(`This replaces the note "${item.outcome_note}". Replace it?`)) return
    try {
      await patch(item, { note: steerNote(), status: 'later' })
      load()
    } catch (e) {
      setError(e.message)
      setErrorFor(item.id)
    }
  }

  const start = (item) => {
    window.open(item.start_url, '_blank', 'noopener,noreferrer')
    if (!item.started_at) patch(item, { started: true }).then(load).catch(() => {})
  }

  const done = (item) => {
    if (item.needs_note) {
      setNoteFor(item.id)
      setNote('')
      return
    }
    act(item, 'done')
  }

  const stats = data?.stats
  const color = current?.category ? getCategoryColor(current.category) : '#9a9a9e'

  return (
    <div className="axon-view">
     <div className="axon-scroll">
      <div className="axon-page">
      <header className="axon-head">
        <div>
          <h1>Today</h1>
          <p>{options.length ? 'Pick one. The rest can wait.' : 'Axon\'s options for your day.'}</p>
        </div>
        {stats && (
          <div className="today-stats" title={`${stats.xp} XP · next level at ${stats.next_at}`}>
            <span>Level {stats.level}</span>
            <span className="today-level-bar"><span style={{ width: `${Math.round(stats.progress * 100)}%` }} /></span>
            <span className="today-discipline" title="Days with at least one thing done, out of the last 14">
              {stats.discipline.days.map(d => <span key={d.date} className={d.done ? 'is-done' : ''} />)}
            </span>
            <span>{stats.discipline.count}/{stats.discipline.window} days</span>
          </div>
        )}
      </header>

      <AxonStrip height={110} color={color} dots={options.filter(o => o.status === 'new').map(o => getCategoryColor(o.category))} />

      {options.length > 0 && (
        <div className="today-sort" role="group" aria-label="Sort options by">
          {SORTS.map(s => (
            <button key={s.id} type="button" className={sort === s.id ? 'is-active' : ''} onClick={() => chooseSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {data && options.length === 0 && (
        <p className="axon-empty">
          {doneToday.length
            ? `All done for today - ${doneToday.length} thing${doneToday.length === 1 ? '' : 's'} ticked off.`
            : 'Nothing open right now. Axon\'s morning plan adds a few options each weekday around 7:30, or ask Claude to put something on your list.'}
        </p>
      )}

      <ul className="today-list">
        {options.map(item => {
          const c = getCategoryColor(item.category)
          const open = current?.id === item.id
          return (
            <li key={item.id} className={`today-item ${open ? 'is-open' : ''} ${item.status === 'later' ? 'is-later' : ''}`} style={open ? { borderColor: c } : undefined}>
              <button type="button" className="today-item-main" onClick={() => setSelected(item.id)} aria-expanded={open}>
                <span className="today-item-dot" style={{ background: c }} />
                <span className="today-item-text">
                  <span className="today-item-title">{item.title}</span>
                  {open && item.why && <span className="today-item-why">{item.why}</span>}
                  <span className="today-item-meta">
                    impact <Dots n={item.impact} color={c} label="Impact" />
                    effort <Dots n={item.effort} color="var(--text-muted)" label="Effort" />
                    time <Dots n={timeDots(item.minutes)} color="var(--text-muted)" label="Time" />
                    {item.minutes ? `${item.minutes} min` : ''}
                    {item.series ? ` · ${item.series}${item.series_step ? `, ${item.series_step}` : ''}` : ''}
                    {item.status === 'later' ? ' · not today' : ''}
                  </span>
                </span>
              </button>
              {open && noteFor !== item.id && (
                <div className="today-actions">
                  {item.start_url && (
                    <button type="button" className="today-start" style={{ borderColor: c }} onClick={() => start(item)}>
                      {item.start_label || 'Start'} ↗
                    </button>
                  )}
                  <button type="button" onClick={() => done(item)}>Done</button>
                  {item.status !== 'later' && <button type="button" onClick={() => act(item, 'later')}>Not today</button>}
                  <button type="button" onClick={() => act(item, 'rejected')}>Not for me</button>
                </div>
              )}
              {open && noteFor === item.id && (
                <div className="today-note">
                  <label htmlFor={`note-${item.id}`}>
                    {item.series ? 'What did you do? Paste your draft, or say where you got to.' : 'What did you do?'}
                  </label>
                  <textarea
                    id={`note-${item.id}`}
                    className="question-input"
                    rows={3}
                    value={note}
                    autoFocus
                    onChange={e => { setNote(e.target.value); setError('') }}
                  />
                  <div className="today-actions">
                    <button
                      type="button"
                      style={{ borderColor: c }}
                      onClick={() => (note.trim() ? act(item, 'done', { note: note.trim() }) : setError('Add a few words first, so the next step can build on it'))}
                    >
                      Save and mark done
                    </button>
                    <button type="button" onClick={() => { setNoteFor(null); setError('') }}>Cancel</button>
                  </div>
                </div>
              )}
              {open && error && !ideas.some(i => i.id === errorFor) && <p className="today-error">{error}</p>}
            </li>
          )
        })}
      </ul>

      {options.length > 0 && doneToday.length > 0 && (
        <p className="today-done-line">Done today: {doneToday.map(i => i.title).join(' · ')}</p>
      )}

      {ideas.length > 0 && (
        <section className="axon-ideas" aria-label="Axon's ideas">
          <h2>Ideas</h2>
          <ul className="today-list">
            {ideas.map(item => {
              const c = getCategoryColor(item.category)
              return (
                <li key={item.id} className={`today-item ${item.status === 'later' ? 'is-later' : ''}`}>
                  <div className="today-item-main">
                    <span className="today-item-dot" style={{ background: c }} />
                    <span className="today-item-text">
                      <span className="today-item-title">{item.title}</span>
                      {item.why && <span className="today-item-why">{item.why}</span>}
                    </span>
                  </div>
                  <div className="today-actions">
                    <button type="button" style={{ borderColor: c }} onClick={() => act(item, 'done')}>Yes, do it</button>
                    {item.status !== 'later' && <button type="button" onClick={() => act(item, 'later')}>Park</button>}
                    <button type="button" onClick={() => act(item, 'rejected')}>Drop</button>
                  </div>
                  {error && errorFor === item.id && <p className="today-error">{error}</p>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <details className="axon-ideas axon-past">
          <summary>Past deep thinks ({past.length})</summary>
          <ul className="today-list">
            {past.map(item => {
              const c = getCategoryColor(item.category)
              const queued = item.outcome_note?.startsWith('next (')
              return (
                <li key={item.id} className="today-item">
                  <div className="today-item-main">
                    <span className="today-item-dot" style={{ background: c }} />
                    <span className="today-item-text">
                      <span className="today-item-title">{item.title}</span>
                      {item.why && <span className="today-item-why">{item.why}</span>}
                      {queued && <span className="today-item-meta">Your last pick: {item.outcome_note}</span>}
                    </span>
                  </div>
                  <div className="today-actions">
                    {item.start_url && (
                      <button type="button" className="today-start" style={{ borderColor: c }} onClick={() => start(item)}>
                        {item.start_label || 'Open the doc'} ↗
                      </button>
                    )}
                    <button type="button" onClick={() => thinkAgain(item)}>Think again</button>
                  </div>
                  {error && errorFor === item.id && <p className="today-error">{error}</p>}
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {stats && <CategoryBars byCategory={stats.by_category} />}
      </div>
     </div>
    </div>
  )
}

export default AxonView
