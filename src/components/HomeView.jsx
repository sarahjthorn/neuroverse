import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import MemoryFeed from './MemoryFeed'
import InputPanel from './InputPanel'
import WeekClock from './WeekClock'
import CuriousCard from './CuriousCard'
import { categoryDotBackground } from '../utils/categories'
import { BrainIcon, SearchIcon } from './icons'
import { PORTFOLIO_URL } from '../config/links'
import { flyFromRect, peekSearchOrigin } from '../utils/motion'
import './HomeView.css'

// The daily-use front door (the old September 2026 Sidebar used to put
// the graph first and bury search/recall in an accordion - Home flips that:
// search + a chronological feed of what's been captured is the thing a
// returning user actually wants, and the graph (Explore) is one tab away).
function ResultList({ nodes, onSelectNode }) {
  return (
    <ul className="search-results-list home-search-results">
      {nodes.map(node => (
        <li key={node.id}>
          <button type="button" className="search-result-item" onClick={() => onSelectNode(node)}>
            <span className="search-result-dot" style={{ background: categoryDotBackground(node.data) }} />
            <span className="search-result-title">{node.data.title}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// Claude's answer cites memories inline as [id] - render those as small
// numbered buttons, with the numbered sources listed underneath.
// Answers take a few seconds (retrieval, then Claude) - show which stage
// it's probably in so it's obvious something is happening.
function AskLoading({ question }) {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => setStage(1), 1800)
    return () => clearTimeout(timer)
  }, [question])

  return (
    <div className="home-ask-card home-ask-loading" role="status" aria-live="polite">
      <span className="home-ask-pulse" aria-hidden="true"><span /><span /><span /></span>
      <span>{stage === 0 ? 'Looking through your memories…' : 'Writing an answer…'}</span>
    </div>
  )
}

// Example questions the empty Ask bar cycles through, so it's obvious
// what kinds of things you can ask.
const ASK_EXAMPLES = [
  'What have I said about my career goals?',
  'What am I curious about lately?',
  'Where have I travelled?',
  'Which projects am I working on?',
  'What tools do I like building with?',
  "What's been on my mind this week?",
]
const ASK_EXAMPLE_MS = 3800

// Drawn over the input instead of using its placeholder, which can't fade.
function RotatingPlaceholder() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex(i => (i + 1) % ASK_EXAMPLES.length), ASK_EXAMPLE_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className="home-search-placeholder" aria-hidden="true">
      Ask your brain anything —{' '}
      <span key={index} className="home-search-example">“{ASK_EXAMPLES[index]}”</span>
    </span>
  )
}

// When the brain can't fully answer, it asks back so Sarah can fill the
// gap - Claude's follow-up question if it wrote one, else her own search.
// `partial` = it sits under a partial answer. Ignoring it (or "Never mind")
// keeps nothing; "Remind me later" parks it with the brain's open
// questions. Saving an answer is one extraction call (COST.md).
function AskBack({ question, partial, api }) {
  const [draft, setDraft] = useState('')
  const [state, setState] = useState('open') // open | saving | saved | reminded | dismissed | error

  const send = async (text) => {
    setState('saving')
    try {
      await api.askBack(question, text)
      setState(text ? 'saved' : 'reminded')
    } catch (error) {
      console.error('Asking back failed:', error)
      setState('error')
    }
  }

  const wrapClass = partial ? 'home-ask-back home-ask-back-partial' : 'home-ask-card home-ask-back'

  if (state === 'dismissed') {
    return partial ? null : <div className={wrapClass}>Nothing in your brain answers that yet.</div>
  }
  if (state === 'saved') {
    return <div className={wrapClass}>Got it - that's in your brain now.</div>
  }
  if (state === 'reminded') {
    return <div className={wrapClass}>I'll ask you again later - it's with your brain's questions on Home.</div>
  }

  const saving = state === 'saving'
  return (
    <div className={wrapClass}>
      <p className="home-ask-answer">
        {partial ? 'Fill in the gap? ' : "I don't know that yet. "}
        <strong>{question}</strong>
      </p>
      <textarea
        className="question-input"
        rows={2}
        placeholder="A sentence or two is plenty"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (draft.trim() && !saving) send(draft.trim())
          }
        }}
        disabled={saving}
      />
      <div className="question-actions">
        <button type="button" className="home-tidy-check" onClick={() => send(draft.trim())} disabled={saving || !draft.trim()}>
          {saving && draft.trim() ? 'Remembering…' : 'Save answer ↵'}
        </button>
        <button type="button" className="question-link" onClick={() => send('')} disabled={saving} title="Keep this with your brain's questions to answer another time">
          Remind me later
        </button>
        <button type="button" className="question-link" onClick={() => setState('dismissed')} disabled={saving}>
          Never mind
        </button>
      </div>
      {state === 'error' && <p className="home-tidy-message">Saving failed - see console for details.</p>}
    </div>
  )
}

function AskAnswer({ askState, nodesById, onSelectNode, onViewInBrain, questionsApi }) {
  if (askState.status === 'loading') {
    return <AskLoading question={askState.question} />
  }
  if (askState.status === 'error') {
    return <div className="home-ask-card">Couldn't answer that - check the server logs.</div>
  }
  if (!askState.answer) {
    const question = askState.askBack || askState.question
    return <AskBack key={question} question={question} api={questionsApi} />
  }

  const cited = askState.citedIds.filter(id => nodesById.has(id))
  const parts = askState.answer.split(/(\[[^\]]+\])/g)
  const evidenceIds = cited.length > 0 ? cited : askState.retrievedIds

  return (
    <div className="home-ask-card">
      <p className="home-ask-answer">
        {parts.map((part, i) => {
          const match = part.match(/^\[([^\]]+)\]$/)
          if (!match) return <span key={i}>{part}</span>
          const index = cited.indexOf(match[1])
          if (index === -1) return null
          return (
            <button
              key={i}
              type="button"
              className="home-ask-cite"
              title={nodesById.get(match[1]).data.title}
              onClick={() => onSelectNode(nodesById.get(match[1]))}
            >
              {index + 1}
            </button>
          )
        })}
      </p>
      {cited.length > 0 && (
        <ol className="home-ask-sources">
          {cited.map(id => (
            <li key={id}>
              <button type="button" onClick={() => onSelectNode(nodesById.get(id))}>
                {nodesById.get(id).data.title}
              </button>
            </li>
          ))}
        </ol>
      )}
      <button
        type="button"
        className="home-view-3d"
        onClick={() => onViewInBrain(evidenceIds, askState.question)}
      >
        See this in your brain (3D) →
      </button>
      {askState.askBack && (
        <AskBack key={askState.askBack} question={askState.askBack} partial api={questionsApi} />
      )}
    </div>
  )
}

// Home never scrolls: it shows as many recent memories as fit (up to
// this many), and "See all" goes to the Memories page for the rest.
const HOME_FEED_MAX = 4
const FEED_GAP = 10

// Cards stretch to fill the feed area (so the column ends flush with the
// rail), which means offsetHeight is the stretched size - measure what the
// card's contents actually need instead.
function naturalHeight(card) {
  const style = getComputedStyle(card)
  const children = [...card.children]
  const gap = parseFloat(style.rowGap) || 0
  return children.reduce((sum, c) => sum + c.offsetHeight, 0) +
    gap * Math.max(0, children.length - 1) +
    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
}


function HomeView({
  nodes, searchQuery, onSearchQueryChange, searchResults, onSelectNode,
  semanticResults, semanticLoading, askState, onAsk, onViewInBrain,
  newSinceLastVisit, onDismissNew, onShowNew,
  recalcMessage, onDismissRecalcMessage,
  tidyItems, onCheckDuplicates, checkingDuplicates, duplicateCheckMessage, onSeeAll,
  onSubmit, loading, onRecalculate, recalculating,
  questionsApi, onOpenReflect,
  waitingForClaude = false, onReplayIntro
}) {
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [tidyIndex, setTidyIndex] = useState(0)
  // Merging or dismissing one shortens the list; stay in range.
  const currentTidyIndex = Math.min(tidyIndex, Math.max(0, tidyItems.length - 1))
  const currentTidy = tidyItems[currentTidyIndex]
  const [feedFit, setFeedFit] = useState(HOME_FEED_MAX)
  const feedAreaRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchRowRef = useRef(null)
  const trimmedQuery = searchQuery.trim()

  // Coming back from another page, the Ask bar flies down out of the nav
  // search box it replaces (see GlobalSearch for the trip up).
  useLayoutEffect(() => {
    const fly = flyFromRect(searchRowRef.current, peekSearchOrigin())
    return () => fly?.cancel()
  }, [])

  // ⌘K focuses the Ask bar, same as the header search on every other page
  // (that one isn't rendered on Home).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Fit the feed to the space left (banners come and go) instead of
  // letting the page scroll: measure one card, divide the area by it.
  useLayoutEffect(() => {
    const area = feedAreaRef.current
    if (!area) return
    const measure = () => {
      // Narrow layout: the page scrolls and the feed isn't height-bound.
      if (getComputedStyle(area).flexGrow === '0') {
        setFeedFit(HOME_FEED_MAX)
        return
      }
      const card = area.querySelector('.memory-card')
      if (!card) return
      const fit = Math.floor((area.clientHeight + FEED_GAP) / (naturalHeight(card) + FEED_GAP))
      setFeedFit(Math.max(1, Math.min(HOME_FEED_MAX, fit)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [trimmedQuery, showAddPanel, nodes.length])
  const nodesById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  // "Related by meaning" only lists what the exact match didn't already
  // find, and uses the loaded node (fresher than the search response's copy).
  const relatedResults = useMemo(() => {
    const exact = new Set(searchResults.map(n => n.id))
    return semanticResults
      .map(r => nodesById.get(r.node.id))
      .filter(n => n && !exact.has(n.id))
  }, [semanticResults, searchResults, nodesById])

  const allResultIds = [...searchResults, ...relatedResults].map(n => n.id)

  const todayIds = useMemo(() => {
    const cutoff = new Date()
    cutoff.setHours(0, 0, 0, 0)
    const cutoffMs = cutoff.getTime()
    return nodes.filter(n => n.data.timestamp && new Date(n.data.timestamp).getTime() >= cutoffMs).map(n => n.id)
  }, [nodes])

  return (
    <div className="home-view">
      {/* One shared-width frame: the Ask bar spans both columns below it, so
          every edge on the page lines up. */}
      <div className="home-frame">
      {/* The Ask bar is Home's centrepiece; the stats that used to be a
          card, and the "new since last visit" banner, are one line under it. */}
      <div className="home-hero">
        <div ref={searchRowRef} className={`home-search-row ${semanticLoading || askState?.status === 'loading' ? 'is-searching' : ''}`}>
          <span className="home-search-icon"><SearchIcon /></span>
          <div className="home-search-field">
            <input
              ref={searchInputRef}
              type="text"
              className="home-search-input"
              aria-label="Ask your brain anything"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && trimmedQuery) onAsk() }}
            />
            {!searchQuery && <RotatingPlaceholder />}
          </div>
          {trimmedQuery ? (
            <button
              type="button"
              className="home-search-clear"
              onClick={() => { onSearchQueryChange(''); searchInputRef.current?.focus() }}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : <kbd className="home-search-kbd">⌘K</kbd>}
        </div>

        {/* After the intro, until Claude sends a real memory: the brain is
            listening (App polls for it and celebrates when it lands). */}
        {waitingForClaude && (
          <div className="home-waiting" role="status">
            <span className="home-waiting-pulse" aria-hidden="true" />
            Waiting for your first memory from Claude…
          </div>
        )}

        <div className="home-meta">
          <span>{nodes.length} memor{nodes.length === 1 ? 'y' : 'ies'}</span>
          <span aria-hidden="true">·</span>
          {todayIds.length > 0 ? (
            <button
              type="button"
              className="explore-link"
              onClick={() => onViewInBrain(todayIds, `${todayIds.length} from today`)}
              title="Show them in the 3D view"
            >
              {todayIds.length} today
            </button>
          ) : <span>0 today</span>}
          {newSinceLastVisit > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="home-meta-new" onClick={onShowNew} title="Show them in the 3D view">
                {newSinceLastVisit} new since your last visit →
              </button>
              <button type="button" className="home-meta-dismiss" onClick={onDismissNew} aria-label="Dismiss">×</button>
            </>
          )}
        </div>

        {recalcMessage && (
          <div className="home-banner">
            <span>{recalcMessage}</span>
            <button type="button" onClick={onDismissRecalcMessage} aria-label="Dismiss">×</button>
          </div>
        )}
      </div>

      <div className="home-columns">
        <div className="home-main">
          {trimmedQuery ? (
            <div className="home-search-body home-scroll-area">
              {askState && (
                <AskAnswer
                  askState={askState}
                  nodesById={nodesById}
                  onSelectNode={onSelectNode}
                  onViewInBrain={onViewInBrain}
                  questionsApi={questionsApi}
                />
              )}

              {allResultIds.length > 0 && (
                <div className="home-section-header">
                  <span>{allResultIds.length} matching memor{allResultIds.length === 1 ? 'y' : 'ies'}</span>
                  <button
                    type="button"
                    className="home-add-link"
                    onClick={() => onViewInBrain(allResultIds, trimmedQuery)}
                  >
                    View in 3D →
                  </button>
                </div>
              )}

              {searchResults.length > 0 && (
                <>
                  <div className="home-subsection-label">Exact matches</div>
                  <ResultList nodes={searchResults} onSelectNode={onSelectNode} />
                </>
              )}

              {(relatedResults.length > 0 || semanticLoading) && (
                <>
                  <div className="home-subsection-label">
                    Related by meaning{semanticLoading && <span className="home-searching"> · searching…</span>}
                  </div>
                  <ResultList nodes={relatedResults} onSelectNode={onSelectNode} />
                </>
              )}

              {allResultIds.length === 0 && !semanticLoading && (
                <p className="home-search-empty">No memories match "{trimmedQuery}" - press Enter to ask anyway.</p>
              )}
            </div>
          ) : (
            <>
              <div className="home-section-header">
                <span>{showAddPanel ? 'Add a conversation' : 'Recent memories'}</span>
              </div>

              {showAddPanel ? (
                <div className="home-add-panel home-scroll-area">
                  <InputPanel
                    onSubmit={onSubmit}
                    loading={loading}
                    onRecalculate={onRecalculate}
                    recalculating={recalculating}
                  />
                </div>
              ) : (
                <div className="home-feed-area" ref={feedAreaRef}>
                  <MemoryFeed nodes={nodes} onSelectNode={onSelectNode} limit={feedFit} />
                </div>
              )}
              <div className="home-feed-footer">
                <button type="button" className="home-see-all" onClick={onSeeAll}>
                  See all {nodes.length} memories →
                </button>
                {onReplayIntro && (
                  <button type="button" className="home-replay-intro" onClick={onReplayIntro}>
                    Replay intro
                  </button>
                )}
                {PORTFOLIO_URL && (
                  <a
                    className="home-portfolio"
                    href={PORTFOLIO_URL}
                    target="_blank"
                    rel="noreferrer"
                    title="My portfolio - a redacted snapshot of this brain drifts behind it. Re-export with npm run export:portfolio"
                  >
                    <span className="home-portfolio-logo"><BrainIcon /></span>
                    <span>More about me &amp; my projects</span>
                    <span className="home-portfolio-arrow" aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            </>
          )}
        </div>

        <div className="home-rail">
          {/* Same header row as "Recent memories", so both columns' first
              cards start at the same height. */}
          <div className="home-section-header">
            <span>At a glance</span>
            <button
              type="button"
              className="home-add-link"
              onClick={() => { onSearchQueryChange(''); setShowAddPanel(v => !v) }}
            >
              {showAddPanel ? 'Close' : <>+ Add a conversation<span className="home-add-extra"> manually</span></>}
            </button>
          </div>

          {nodes.length > 1 && (
            <div className="home-card home-tidy">
              {/* One duplicate at a time, paged like the questions card. */}
              <div className="home-curious-head">
                <div className="home-card-label">Duplicates</div>
                {tidyItems.length > 1 && (
                  <div className="home-curious-pager">
                    <button type="button" onClick={() => setTidyIndex(i => (i - 1 + tidyItems.length) % tidyItems.length)} aria-label="Previous duplicate">‹</button>
                    <span>{currentTidyIndex + 1} of {tidyItems.length}</span>
                    <button type="button" onClick={() => setTidyIndex(i => (i + 1) % tidyItems.length)} aria-label="Next duplicate">›</button>
                  </div>
                )}
              </div>
              {currentTidy && (
                <>
                  <p className="home-card-body">
                    {`${tidyItems.length} possible duplicate${tidyItems.length === 1 ? '' : 's'}. Open one to merge or dismiss it.`}
                  </p>
                  <button type="button" className="home-tidy-item" onClick={() => onSelectNode(currentTidy.node)}>
                    <span className="home-tidy-kind">{currentTidy.kind}</span>
                    <span className="home-tidy-label">{currentTidy.label}</span>
                  </button>
                </>
              )}
              <button
                type="button"
                className="home-tidy-check"
                onClick={onCheckDuplicates}
                disabled={checkingDuplicates}
                title="Asks Claude whether your most similar memories are really the same idea (a fraction of a cent per click)"
              >
                {checkingDuplicates ? 'Checking…' : 'Check with Claude'}
              </button>
              {duplicateCheckMessage && <p className="home-tidy-message">{duplicateCheckMessage}</p>}
            </div>
          )}

          <CuriousCard
            api={questionsApi}
            onSelectNodeId={(id) => { if (nodesById.has(id)) onSelectNode(nodesById.get(id)) }}
            onOpenReflect={onOpenReflect}
          />

          <WeekClock nodes={nodes} onViewInBrain={onViewInBrain} />

        </div>
      </div>
      </div>

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Extracting memories and calculating relationships...</p>
        </div>
      )}
    </div>
  )
}

export default HomeView
