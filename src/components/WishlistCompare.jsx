import { useState } from 'react'
import './WishlistCompare.css'

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } }
const lines = text => text.split('\n').map(l => l.trim()).filter(Boolean)

function OptionEditor({ option, onSave, onRemove, onCancel }) {
  const [draft, setDraft] = useState({
    price: option.price || '',
    link: option.link || '',
    summary: option.summary || '',
    pros: (option.pros || []).join('\n'),
    cons: (option.cons || []).join('\n')
  })
  const set = key => e => setDraft(d => ({ ...d, [key]: e.target.value }))

  return (
    <form
      className="wl-cmp-edit"
      onSubmit={(e) => { e.preventDefault(); onSave({ ...draft, pros: lines(draft.pros), cons: lines(draft.cons) }) }}
    >
      <label>In a line<input value={draft.summary} onChange={set('summary')} placeholder="Neutral daily trainer" /></label>
      <label>Price<input value={draft.price} onChange={set('price')} placeholder="~£120" /></label>
      <label>Shop link<input type="url" value={draft.link} onChange={set('link')} placeholder="https://" /></label>
      <label>Pros, one per line<textarea rows={4} value={draft.pros} onChange={set('pros')} /></label>
      <label>Cons, one per line<textarea rows={3} value={draft.cons} onChange={set('cons')} /></label>
      <div className="wl-cmp-edit-actions">
        <button
          type="button"
          className="wl-text-btn is-danger"
          onClick={() => { if (window.confirm(`Remove "${option.text}" from the comparison?`)) onRemove() }}
        >
          Remove
        </button>
        <span />
        <button type="button" className="wl-text-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="wl-primary">Save</button>
      </div>
    </form>
  )
}

function OptionColumn({ option, onPatch, itemId, onChosen }) {
  const [editing, setEditing] = useState(!option.pros && !option.cons && !option.summary)
  const shop = option.link && hostOf(option.link)
  const update = changes => onPatch(itemId, { optionDetails: [{ text: option.text, ...changes }] })

  return (
    <section className={`wl-cmp-col${option.chosen ? ' is-chosen' : ''}${option.ruledOut ? ' is-out' : ''}`}>
      {option.chosen && <span className="wl-cmp-badge">Your pick</span>}
      <h3>{option.text}</h3>
      {option.summary && !editing && <p className="wl-cmp-summary">{option.summary}</p>}
      {option.price && !editing && <p className="wl-cmp-price">{option.price}</p>}

      {editing ? (
        <OptionEditor
          option={option}
          onSave={async (changes) => { if (!(await update(changes))) setEditing(false) }}
          onRemove={() => onPatch(itemId, { removeOption: option.text })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <ul className="wl-cmp-list is-pros" aria-label="Pros">
            {(option.pros || []).map(p => <li key={p}>{p}</li>)}
            {!option.pros?.length && <li className="is-empty">No pros noted yet</li>}
          </ul>
          <ul className="wl-cmp-list is-cons" aria-label="Cons">
            {(option.cons || []).map(c => <li key={c}>{c}</li>)}
            {!option.cons?.length && <li className="is-empty">No cons noted yet</li>}
          </ul>
          {shop
            ? <a className="wl-shop" href={option.link} target="_blank" rel="noreferrer">View at {shop} ↗</a>
            : <button type="button" className="wl-text-btn wl-cmp-nolink" onClick={() => setEditing(true)}>+ Add shop link</button>}

          <div className="wl-cmp-actions">
            {!option.chosen && !option.ruledOut && (
              <button type="button" className="wl-primary" onClick={async () => { if (!(await onPatch(itemId, { chooseOption: option.text }))) onChosen() }}>
                Choose this one
              </button>
            )}
            {option.ruledOut
              ? <button type="button" className="wl-text-btn" onClick={() => update({ ruledOut: false })}>Bring back</button>
              : !option.chosen && <button type="button" className="wl-text-btn" onClick={() => update({ ruledOut: true })}>Rule out</button>}
            <button type="button" className="wl-text-btn" onClick={() => setEditing(true)}>Edit</button>
          </div>
        </>
      )}
    </section>
  )
}

// The decision view: each specific product being weighed side by side with
// its pros and cons (mostly written by Claude in chat - see optionDetails in
// server/routes/wishlist.js). Ruling options out sinks them to the end;
// choosing one moves the item to Ready to buy with that option's link.
function WishlistCompare({ item, onPatch, onClose }) {
  const [adding, setAdding] = useState('')
  const options = [...item.options].sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0) || (a.ruledOut ? 1 : 0) - (b.ruledOut ? 1 : 0))
  const left = item.options.filter(o => !o.ruledOut).length

  const add = async (e) => {
    e.preventDefault()
    const text = adding.trim()
    if (!text) return
    if (!(await onPatch(item.id, { optionDetails: [{ text }] }))) setAdding('')
  }

  return (
    <div className="wl-cmp" role="region" aria-label={`Compare options for ${item.name}`}>
      <header className="wl-cmp-head">
        <div>
          <h2>{item.name}: which one?</h2>
          <p>{item.options.length} options{left < item.options.length ? `, ${left} still in the running` : ''}{item.why ? ` · ${item.why}` : ''}</p>
        </div>
        <button type="button" className="wl-back" onClick={onClose}>Done</button>
      </header>

      <div className="wl-cmp-grid">
        {options.map(o => <OptionColumn key={o.text} option={o} itemId={item.id} onPatch={onPatch} onChosen={onClose} />)}
        <form className="wl-cmp-col is-add" onSubmit={add}>
          <h3>Add an option</h3>
          <input value={adding} onChange={e => setAdding(e.target.value)} placeholder="Garmin Forerunner 265" aria-label="New option name" />
          <button type="submit" className="wl-primary" disabled={!adding.trim()}>Add</button>
          <p className="wl-cmp-hint">Or compare them with Claude in chat, and the pros and cons land here.</p>
        </form>
      </div>
    </div>
  )
}

export default WishlistCompare
