import { useMemo, useState } from 'react'
import { CATEGORY_ORDER, getCategoryColor } from '../utils/categories'

// Unsent answers survive switching pages (and reloads): each question's
// draft is kept in this browser until it's saved, skipped or cancelled, and
// the answer box reopens with it. Same store for Home and Reflect, so a
// draft started on one shows up on the other.
const DRAFT_KEY = id => `neuroverse:answer-draft:${id}`

function readDraft(id) {
  try { return localStorage.getItem(DRAFT_KEY(id)) || '' } catch { return '' }
}

function writeDraft(id, text) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY(id), text)
    else localStorage.removeItem(DRAFT_KEY(id))
  } catch { /* storage blocked - the draft just won't outlive the page */ }
}

// One of the brain's questions with its Answer / Skip / Not relevant
// controls - used one at a time on the Home card and as a list on Reflect.
// Enter saves the answer; Shift+Enter adds a new line; Escape closes the
// box but keeps the draft; Cancel throws it away.
export function QuestionItem({ question, api, onSelectNodeId, onMessage }) {
  const [draft, setDraftState] = useState(() => readDraft(question.id))
  const [answering, setAnswering] = useState(() => Boolean(draft))
  const [saving, setSaving] = useState(false)
  const setDraft = (text) => {
    setDraftState(text)
    writeDraft(question.id, text)
  }
  const cancel = () => {
    setAnswering(false)
    setDraft('')
  }

  const save = async () => {
    if (!draft.trim() || saving) return
    setSaving(true)
    onMessage(null)
    try {
      onMessage(await api.answer(question.id, draft))
      setAnswering(false)
      setDraft('')
    } catch (error) {
      console.error('Failed to answer question:', error)
      onMessage('Saving failed - see console for details.')
    } finally {
      setSaving(false)
    }
  }

  const close = async (status) => {
    onMessage(null)
    try {
      onMessage(await api.close(question.id, status))
      writeDraft(question.id, '')
    } catch (error) {
      console.error('Failed to close question:', error)
    }
  }

  return (
    <div className="question-item">
      <p className="question-text">{question.question}</p>
      <p className="question-why">
        {question.why}
        {question.source_ids.length > 0 && (
          <>
            {' '}
            <button type="button" className="question-source" onClick={() => onSelectNodeId(question.source_ids[0])}>
              See memory
            </button>
          </>
        )}
      </p>

      {answering ? (
        <>
          <textarea
            className="question-input"
            rows={3}
            autoFocus
            onFocus={(e) => { const end = e.target.value.length; e.target.setSelectionRange(end, end) }}
            placeholder="A sentence or two is plenty"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                save()
              } else if (e.key === 'Escape') {
                setAnswering(false)
              }
            }}
            disabled={saving}
          />
          <div className="question-actions">
            <button type="button" className="home-tidy-check" onClick={save} disabled={saving || !draft.trim()}>
              {saving ? 'Remembering…' : 'Save answer ↵'}
            </button>
            <button type="button" className="question-link" onClick={cancel} disabled={saving}>
              Cancel
            </button>
            <span className="question-hint" title="Shift+Enter for a new line">⇧↵ new line</span>
          </div>
        </>
      ) : (
        <div className="question-actions">
          <button type="button" className="home-tidy-check" onClick={() => setAnswering(true)}>Answer</button>
          <button type="button" className="question-link" onClick={() => close('skipped')} title="Not now - this one won't come back">Skip</button>
          <button type="button" className="question-link" onClick={() => close('dismissed')} title="Steer future questions away from this topic">Not relevant</button>
        </div>
      )}
    </div>
  )
}

// "What should I ask you about?" - Surprise me first, then the categories
// (each in its own colour), a random handful of your keywords, and last
// anything typed behind "Something else…". Each click is one Claude call for
// 3 questions (about a cent - see COST.md). `api.generating` holds the key
// of the topic being asked about. The keywords are a fresh random pick from
// the picker's pool (keywords used 3+ times) each time the picker appears,
// after every new batch of questions, or on ↻ - so different corners of
// your brain get a turn, not just the biggest topics.
const KEYWORDS_COMPACT = 8

function sample(list, n) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

export function AskMePicker({ api, onMessage, keywordLimit = KEYWORDS_COMPACT, title = 'What should I ask you about?' }) {
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [shuffle, setShuffle] = useState(0)
  const { categories } = api.topics
  const keywords = useMemo(
    () => sample(api.topics.keywords, keywordLimit),
    [api.topics.keywords, keywordLimit, shuffle]
  )
  const busy = Boolean(api.generating)

  const ask = async (topic) => {
    onMessage(null)
    onMessage(await api.generate(topic))
    if (topic?.kind === 'text') {
      setText('')
      setTyping(false)
    }
  }
  const chip = (kind, value, { label = value, title, color } = {}) => {
    const key = `${kind}:${value}`
    return (
      <button
        key={key}
        type="button"
        className={`ask-chip ask-chip-${kind}${api.generating === key ? ' is-loading' : ''}`}
        style={color ? { '--chip-color': color } : undefined}
        onClick={() => ask({ kind, value })}
        disabled={busy}
        title={title}
      >
        {color && <span className="ask-chip-dot" aria-hidden="true" />}
        {api.generating === key ? 'Thinking…' : label}
      </button>
    )
  }

  return (
    <div className={`ask-picker${busy ? ' is-busy' : ''}`}>
      <div className="ask-picker-head">
        <p className="ask-picker-title">{title}</p>
        {api.topics.keywords.length > keywordLimit && (
          <button type="button" className="ask-shuffle" onClick={() => setShuffle(n => n + 1)} disabled={busy} title="Show other keywords" aria-label="Show other keywords">↻</button>
        )}
      </div>
      <div className="ask-chips">
        <button type="button" className="ask-surprise" onClick={() => ask(null)} disabled={busy} title="3 questions from a few random parts of your life">
          {api.generating === 'surprise' ? 'Thinking…' : '✦ Surprise me'}
        </button>
        {CATEGORY_ORDER.map(name => categories.find(c => c.name === name)).filter(Boolean).map(c =>
          chip('category', c.name, { title: `${c.count} memor${c.count === 1 ? 'y' : 'ies'}`, color: getCategoryColor(c.name) }))}
        {keywords.map(k => chip('keyword', k.term, { title: `${k.count} memories tagged ${k.term}` }))}
        {typing ? (
          <form className="ask-text" data-keep onSubmit={(e) => { e.preventDefault(); if (text.trim()) ask({ kind: 'text', value: text.trim() }) }}>
            <input
              type="text"
              autoFocus
              placeholder="Any topic, then ↵"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setTyping(false) }}
              onBlur={() => { if (!text.trim()) setTyping(false) }}
              disabled={busy}
              maxLength={100}
            />
          </form>
        ) : (
          <button type="button" className="ask-chip ask-chip-other" data-keep onClick={() => setTyping(true)} disabled={busy}>
            {api.generating?.startsWith('text:') ? 'Thinking…' : 'Something else…'}
          </button>
        )}
      </div>
    </div>
  )
}

// "Your brain is curious" on Home - a shortcut to the Reflect page.
function CuriousCard({ api, onSelectNodeId, onOpenReflect }) {
  const [index, setIndex] = useState(0)
  const [message, setMessage] = useState(null)
  const { questions } = api
  const current = questions[Math.min(index, questions.length - 1)]

  return (
    <div className="home-card home-curious">
      <div className="home-curious-head">
        <div className="home-card-label">Your brain is curious</div>
        {questions.length > 1 && (
          <div className="home-curious-pager">
            <button type="button" onClick={() => setIndex(i => (i - 1 + questions.length) % questions.length)} aria-label="Previous question">‹</button>
            <span>{Math.min(index, questions.length - 1) + 1} of {questions.length}</span>
            <button type="button" onClick={() => setIndex(i => (i + 1) % questions.length)} aria-label="Next question">›</button>
          </div>
        )}
      </div>

      {current ? (
        <QuestionItem key={current.id} question={current} api={api} onSelectNodeId={onSelectNodeId} onMessage={setMessage} />
      ) : (
        <>
          <AskMePicker api={api} onMessage={setMessage} />
          <div className="question-actions">
            <button type="button" className="question-link" onClick={onOpenReflect}>Past answers →</button>
          </div>
        </>
      )}

      {message && <p className="home-tidy-message">{message}</p>}
    </div>
  )
}

export default CuriousCard
