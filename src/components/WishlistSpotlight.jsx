import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditIcon, TrashIcon } from './icons'
import { CATEGORY_ORDER, getCategoryColor, categoryDotBackground } from '../utils/categories'
import WishlistPhoto from './WishlistPhoto'
import WishlistCompare from './WishlistCompare'
import {
  STAGES, STATUS_LABELS, isDone, daysSince, ageLabel, formatDate, needsCheckIn, relatedMemories, showsPhoto
} from './wishlistUtils'

const SWIPE_PX = 70
// Matches the wl-fly-* keyframes in WishlistView.css.
const FLY_MS = 280

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } }

// Fix up what Claude wrote down: name, price, why, shop link and
// categories. Saved in one PATCH; options are edited in WishlistCompare.
function EditForm({ item, onPatch, onDone }) {
  const [draft, setDraft] = useState(() => ({
    name: item.name,
    price: item.price || '',
    why: item.why || '',
    link: item.link || '',
    categories: item.categories
  }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setError(null) }
  const toggleCategory = c => set('categories', draft.categories.includes(c)
    ? draft.categories.filter(x => x !== c)
    : CATEGORY_ORDER.filter(x => x === c || draft.categories.includes(x)))

  const save = async (e) => {
    e.preventDefault()
    if (!draft.name.trim()) return setError('Give it a name')
    setBusy(true)
    const message = await onPatch(item.id, draft)
    setBusy(false)
    if (message) setError(message)
    else onDone()
  }

  return (
    <form className="wl-edit" onSubmit={save}>
      <label>Name<input value={draft.name} onChange={e => set('name', e.target.value)} autoFocus /></label>
      <div className="wl-edit-pair">
        <label>Price<input value={draft.price} onChange={e => set('price', e.target.value)} placeholder="~£50" /></label>
        <label>Shop link<input type="url" value={draft.link} onChange={e => set('link', e.target.value)} placeholder="https://" /></label>
      </div>
      <label>Why you want it<textarea rows={2} value={draft.why} onChange={e => set('why', e.target.value)} /></label>

      <fieldset>
        <legend>Categories</legend>
        <div className="wl-edit-chips">
          {CATEGORY_ORDER.map(c => (
            <button
              key={c}
              type="button"
              className={`wl-chip${draft.categories.includes(c) ? ' is-on' : ''}`}
              aria-pressed={draft.categories.includes(c)}
              onClick={() => toggleCategory(c)}
            >
              <span className="wl-dot" style={{ background: getCategoryColor(c) }} />{c}
            </button>
          ))}
        </div>
      </fieldset>

      {error && <p className="wl-edit-error" role="alert">{error}</p>}
      <div className="wl-edit-actions">
        <button type="button" className="wl-text-btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="wl-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  )
}

// Shown when an item reaches Ready to buy: the shop page for the exact one
// she's decided on becomes its link and the source of its photo. If the shop
// blocks us the link is still kept.
function ReadyLinkPrompt({ item, onAttach, onPatch, onDone }) {
  const [url, setUrl] = useState(item.link || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    const link = url.trim()
    if (!link) return
    setBusy(true)
    setError(null)
    const failed = await onAttach(item.id, { url: link, replaceLink: true })
    if (failed) {
      const notSaved = await onPatch(item.id, { link })
      setError(notSaved || `Link saved, but no photo: ${failed}.`)
    } else {
      onDone()
    }
    setBusy(false)
  }

  return (
    <form className="wl-ready-ask" onSubmit={save}>
      <p><strong>Which exact one did you go for?</strong> Paste its shop link and its photo goes on the card.</p>
      <div className="wl-ready-row">
        <input
          type="url"
          autoFocus
          placeholder="https://shop.com/the-exact-thing"
          value={url}
          onChange={e => { setUrl(e.target.value); setError(null) }}
          aria-label="Shop link for the exact item"
          disabled={busy}
        />
        <button type="submit" className="wl-primary" disabled={busy || !url.trim()}>{busy ? 'Getting photo…' : 'Save'}</button>
      </div>
      {error && <p className="wl-ready-error" role="alert">{error}</p>}
      <button type="button" className="wl-text-btn" onClick={onDone}>{error ? 'Done' : 'Not yet'}</button>
    </form>
  )
}

function Details({ item, nodes, onPatch, onAttach, onCompare, onDelete, onSelectNode }) {
  const [panel, setPanel] = useState(null)
  const [editing, setEditing] = useState(false)
  // Moving to Ready asks for the exact item; a Ready item without a photo
  // keeps asking until it gets one or she says "Not yet".
  const [asking, setAsking] = useState(false)
  const [later, setLater] = useState(false)
  const showAsk = item.status === 'ready' && (asking || (!later && !showsPhoto(item)))
  const related = useMemo(() => relatedMemories(item, nodes), [item, nodes])
  const onList = daysSince(item.first_mentioned)
  const lastSaid = daysSince(item.last_mentioned)
  const shop = item.link && hostOf(item.link)
  const toggle = id => setPanel(p => (p === id ? null : id))
  const chosen = item.options.find(o => o.chosen)

  if (editing) {
    return (
      <div className="wl-details">
        <EditForm item={item} onPatch={onPatch} onDone={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <div className="wl-details">
      <div className="wl-details-top">
        {item.categories.map(c => (
          <span key={c} className="wl-category">
            <span className="wl-dot" style={{ background: getCategoryColor(c) }} />{c}
          </span>
        ))}
        <button
          type="button"
          className="wl-icon-btn wl-edit-btn"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${item.name}`}
          title="Edit"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          className="wl-icon-btn"
          onClick={() => { if (window.confirm(`Remove "${item.name}" from the wishlist completely?`)) onDelete(item.id) }}
          aria-label={`Delete ${item.name}`}
          title="Delete from wishlist"
        >
          <TrashIcon />
        </button>
      </div>

      <h2 className="wl-name">{item.name}</h2>
      {item.price && <p className="wl-price">{item.price}</p>}

      {isDone(item) ? (
        <div className="wl-done-row">
          <span className={`wl-badge is-${item.status}`}>{STATUS_LABELS[item.status]} · {formatDate(item.status_changed_at)}</span>
          <button type="button" className="wl-text-btn" onClick={() => onPatch(item.id, { status: 'idea' })}>Put back on the list</button>
        </div>
      ) : (
        <div className="wl-stepper" role="radiogroup" aria-label="How close you are to buying">
          {STAGES.map((s, i) => {
            const at = STAGES.findIndex(x => x.id === item.status)
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={item.status === s.id}
                className={`${i <= at ? 'is-reached' : ''}${item.status === s.id ? ' is-current' : ''}`}
                onClick={() => {
                  if (s.id === 'ready' && item.status !== 'ready') setAsking(true)
                  onPatch(item.id, { status: s.id })
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      )}

      {showAsk && (
        <ReadyLinkPrompt
          item={item}
          onAttach={onAttach}
          onPatch={onPatch}
          onDone={() => { setAsking(false); setLater(true) }}
        />
      )}

      {item.why && <p className="wl-why">{item.why}</p>}

      {item.options.length > 0 && (
        <div className="wl-section">
          <h3>{chosen ? 'Going for' : 'Considering'}</h3>
          <ul className="wl-options">
            {(chosen ? [chosen] : item.options).map(o => (
              <li key={o.text} className={o.ruledOut ? 'is-out' : ''}>
                <span>{o.text}</span>
                {o.summary && <small>{o.summary}</small>}
              </li>
            ))}
          </ul>
          <button type="button" className="wl-compare-btn" onClick={onCompare}>
            {item.options.length > 1 ? `Compare ${item.options.length} side by side →` : 'Pros and cons →'}
          </button>
        </div>
      )}

      <p className="wl-meta">
        Wanted for {onList < 1 ? 'less than a day' : ageLabel(onList)} · mentioned {item.mention_count}×
        {item.mention_count > 1 && `, last ${lastSaid < 1 ? 'today' : `${ageLabel(lastSaid)} ago`}`}
      </p>

      {shop && (
        <div className="wl-shop-row">
          <a className="wl-shop" href={item.link} target="_blank" rel="noreferrer">View at {shop} ↗</a>
          {item.status === 'ready' && !showAsk && (
            <button type="button" className="wl-text-btn" onClick={() => setAsking(true)}>Change</button>
          )}
        </div>
      )}

      {(related.length > 0 || item.notes.length > 0) && (
        <div className="wl-more">
          {related.length > 0 && (
            <button type="button" className="wl-text-btn" onClick={() => toggle('related')} aria-expanded={panel === 'related'}>
              Why you wanted it ({related.length})
            </button>
          )}
          {item.notes.length > 0 && (
            <button type="button" className="wl-text-btn" onClick={() => toggle('history')} aria-expanded={panel === 'history'}>
              History ({item.notes.length})
            </button>
          )}
        </div>
      )}

      {panel === 'related' && (
        <ul className="wl-related">
          {related.map(n => (
            <li key={n.id}>
              <button type="button" onClick={() => onSelectNode(n)}>
                <span className="wl-dot" style={{ background: categoryDotBackground(n.data) }} />
                <span>{n.data.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {panel === 'history' && (
        <ol className="wl-notes">
          {item.notes.slice().reverse().map(n => (
            <li key={n.at + n.text}><time>{formatDate(n.at)}</time>{n.text}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

// One item at a time, big. The order is fixed when it opens, so moving an
// item's status doesn't shuffle it away; dropping, buying or deleting one
// takes it out and slides the next one in.
function WishlistSpotlight({ items, orderIds, startId, nodes, onClose, onPatch, onDelete, onAttach, onSelectNode }) {
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const [order, setOrder] = useState(() => (orderIds.includes(startId) ? orderIds : [startId, ...orderIds]))
  const [index, setIndex] = useState(() => Math.max(0, order.indexOf(startId)))
  const [dir, setDir] = useState(0)
  const [fly, setFly] = useState(null)
  const [dragX, setDragX] = useState(0)
  const [comparing, setComparing] = useState(false)
  const drag = useRef(null)
  // A drag ending on the backdrop also fires a click - that shouldn't close.
  const dragged = useRef(false)
  const stripRef = useRef(null)

  const live = order.filter(id => byId.has(id))
  const count = live.length
  const at = Math.min(index, count - 1)
  const item = byId.get(live[at])
  const wrap = i => (i + count) % count
  // With only two items the other one would peek from both sides - show it once.
  const next = count > 1 ? byId.get(live[wrap(at + 1)]) : null
  const prev = count > 2 ? byId.get(live[wrap(at - 1)]) : null

  useEffect(() => { if (count === 0) onClose() }, [count, onClose])

  const go = useCallback((step) => {
    if (count < 2 || fly || comparing) return
    setDir(step)
    setIndex(i => wrap(Math.min(i, count - 1) + step))
  }, [count, fly, comparing])

  // Keep the current thumbnail in view.
  useEffect(() => {
    stripRef.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [at, item?.id])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'Escape') { if (comparing) setComparing(false); else onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, comparing])

  // Animate the card off, then apply. Leaving decisions (drop, bought)
  // remove the item from the run so the next one takes its place.
  const decide = (kind) => {
    if (fly || !item) return
    const id = item.id
    setFly(kind)
    setTimeout(async () => {
      if (kind === 'keep') {
        await onPatch(id, { checkedIn: true })
        setDir(1)
        setIndex(i => (count > 1 ? wrap(Math.min(i, count - 1) + 1) : i))
      } else {
        await onPatch(id, { status: kind === 'drop' ? 'dropped' : 'bought' })
        setDir(1)
        setOrder(o => o.filter(x => x !== id))
      }
      setFly(null)
    }, FLY_MS)
  }

  const remove = async (id) => {
    await onDelete(id)
    setOrder(o => o.filter(x => x !== id))
  }

  const onPointerDown = (e) => {
    dragged.current = false
    if (e.button !== 0 || e.target.closest('button, a, input, form, .wl-details')) return
    drag.current = { x: e.clientX, id: e.pointerId }
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    if (Math.abs(dx) > 6 && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId)
    setDragX(dx)
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    dragged.current = Math.abs(dragX) > 6
    if (dragX <= -SWIPE_PX) go(1)
    else if (dragX >= SWIPE_PX) go(-1)
    setDragX(0)
  }

  if (!item) return null
  const stale = needsCheckIn(item)
  // Clicking empty space around the card goes back to the board.
  const onBackdrop = (e) => {
    if (e.target !== e.currentTarget || dragged.current) return
    if (comparing) setComparing(false)
    else onClose()
  }

  return (
    <div className="wl-spotlight" onClick={onBackdrop} role="dialog" aria-modal="true" aria-label={`${item.name}, ${at + 1} of ${count}`}>
      <div className="wl-spot-bar" onClick={onBackdrop}>
        <button type="button" className="wl-back" onClick={onClose}>← All items</button>
        <span className="wl-spot-count">{at + 1} / {count}</span>
      </div>

      {comparing ? (
        <div className="wl-stage is-comparing" onClick={onBackdrop}>
          <WishlistCompare item={item} onPatch={onPatch} onClose={() => setComparing(false)} />
        </div>
      ) : (
      <div
        className="wl-stage"
        onClick={onBackdrop}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {prev && (
          <button type="button" className="wl-peek is-prev" onClick={() => go(-1)} aria-label={`Previous: ${prev.name}`}>
            <WishlistPhoto item={prev} size="peek" />
          </button>
        )}
        {next && (
          <button type="button" className="wl-peek is-next" onClick={() => go(1)} aria-label={`Next: ${next.name}`}>
            <WishlistPhoto item={next} size="peek" />
          </button>
        )}

        <article
          key={item.id}
          className={`wl-card${dir > 0 ? ' from-right' : dir < 0 ? ' from-left' : ''}${fly ? ` fly-${fly}` : ''}${dragX ? ' is-dragging' : ''}`}
          style={dragX ? { transform: `translateX(${dragX}px) rotate(${dragX / 40}deg)` } : undefined}
        >
          <WishlistPhoto item={item} size="hero" />
          <Details
            item={item}
            nodes={nodes}
            onPatch={onPatch}
            onAttach={onAttach}
            onCompare={() => setComparing(true)}
            onDelete={remove}
            onSelectNode={onSelectNode}
          />

          {fly && <span className={`wl-stamp is-${fly}`}>{fly === 'keep' ? 'Still want' : fly === 'drop' ? 'Dropped' : 'Bought!'}</span>}
        </article>

        {count > 1 && (
          <>
            <button type="button" className="wl-arrow is-prev" onClick={() => go(-1)} aria-label="Previous item">‹</button>
            <button type="button" className="wl-arrow is-next" onClick={() => go(1)} aria-label="Next item">›</button>
          </>
        )}
      </div>
      )}

      {!isDone(item) && !comparing && (
        <div className={`wl-decide${stale ? ' is-stale' : ''}`} onClick={onBackdrop}>
          {stale && <p>It's been a while since this came up. Still want it?</p>}
          <div className="wl-decide-row" onClick={onBackdrop}>
            <button type="button" className="wl-decide-btn is-drop" onClick={() => decide('drop')}>
              <span aria-hidden="true">✕</span> Drop it
            </button>
            <button type="button" className="wl-decide-btn is-bought" onClick={() => decide('bought')}>
              <span aria-hidden="true">✓</span> Bought it
            </button>
            <button type="button" className="wl-decide-btn is-keep" onClick={() => decide('keep')}>
              <span aria-hidden="true">♥</span> Still want it
            </button>
          </div>
        </div>
      )}

      {count > 1 && !comparing && (
        <div className="wl-strip" ref={stripRef} onClick={onBackdrop} role="tablist" aria-label="All items">
          {live.map((id, i) => {
            const it = byId.get(id)
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={i === at}
                className={`wl-thumb${i === at ? ' is-current' : ''}`}
                onClick={() => { setDir(i > at ? 1 : -1); setIndex(i) }}
                title={it.name}
              >
                <WishlistPhoto item={it} size="thumb" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default WishlistSpotlight
