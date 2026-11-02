import { useEffect, useMemo, useRef, useState } from 'react'
import { prefersReducedMotion } from '../utils/motion'
import './FirstLight.css'

// "First Light" - the game-style intro a brand-new brain opens with.
// Monument Valley-ish: one line of text at a time over
// the real 3D space, and the user's first two answers become its first two
// stars. This component only runs the script and draws the text; the stars
// are real memories, created by App through the callbacks below and drawn
// by BrainGraph3D like any other.
//
// Beats: darkness -> name (first star) -> curious (second star + link) ->
// the concept (ghost stars) -> orbit -> click a star -> hand-off.

const FADE_MS = 1200
const HOLD_MS = 1700
const GHOST_COUNT = 16

class Cancelled extends Error {}

function FirstLight({
  initialName = '',
  onSubmitName, // async (name) => void - lights the first star
  onSubmitCurious, // async (answer) => void - lights the second star + link
  onPhase, // (phase) => void - App unlocks orbiting from 'orbit' on
  orbited, // true once the user has dragged the view round
  starClicked, // true once the user has clicked a star
  onFinish, // the hand-off is done
  onSkip
}) {
  const reduceMotion = useMemo(() => prefersReducedMotion(), [])
  const fade = reduceMotion ? 150 : FADE_MS
  const hold = reduceMotion ? 1400 : HOLD_MS

  // The one line on screen: { key, text, prompt?, shown }
  const [line, setLine] = useState(null)
  const [ghosts, setGhosts] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const answerRef = useRef(null) // resolves the prompt currently waiting
  const waitersRef = useRef({}) // resolves 'orbited' / 'starClicked' waits
  const aliveRef = useRef(true)
  const timersRef = useRef(new Set())

  const latest = useRef({})
  latest.current = { onSubmitName, onSubmitCurious, onPhase, onFinish }

  const wait = (ms) => new Promise((resolve, reject) => {
    if (!aliveRef.current) return reject(new Cancelled())
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      aliveRef.current ? resolve() : reject(new Cancelled())
    }, ms)
    timersRef.current.add(id)
  })

  // Fade a line in, hold it, fade it out.
  const say = async (text, holdMs = hold) => {
    setLine({ key: text, text, shown: false })
    await wait(30)
    setLine({ key: text, text, shown: true })
    await wait(fade + holdMs)
    setLine(l => l && { ...l, shown: false })
    await wait(fade)
  }

  // Ask a question and resolve with whatever `submit` did with the answer.
  // The line stays up (with the input) until the submit succeeds.
  const ask = async (text, submit, prefill = '') => {
    setDraft(prefill)
    setError(null)
    setLine({ key: text, text, prompt: true, shown: false })
    await wait(30)
    setLine({ key: text, text, prompt: true, shown: true })
    for (;;) {
      const answer = await new Promise(resolve => { answerRef.current = resolve })
      if (!aliveRef.current) throw new Cancelled()
      setBusy(true)
      try {
        await submit(answer)
        break
      } catch (err) {
        console.error('First Light step failed:', err)
        setError('That didn’t work - is the server running with both API keys set? Try again.')
      } finally {
        setBusy(false)
      }
    }
    answerRef.current = null
    setLine(l => l && { ...l, shown: false })
    await wait(fade)
  }

  const until = (name) => new Promise(resolve => { waitersRef.current[name] = resolve })

  useEffect(() => { if (orbited) waitersRef.current.orbited?.() }, [orbited])
  useEffect(() => { if (starClicked) waitersRef.current.starClicked?.() }, [starClicked])

  useEffect(() => {
    if (line?.prompt && line.shown) inputRef.current?.focus()
  }, [line])

  // The script.
  useEffect(() => {
    aliveRef.current = true
    const phase = (p) => latest.current.onPhase?.(p)
    let name = initialName

    const run = async () => {
      // Beat 1 - darkness.
      phase('darkness')
      await wait(reduceMotion ? 300 : 1400)
      await say('This is your mind.')
      await say('…it’s quiet in here.')

      // Beat 2 - the first star: you.
      phase('name')
      await ask('What should I call you?', async (answer) => {
        name = answer
        await latest.current.onSubmitName(answer)
      }, initialName)
      await wait(reduceMotion ? 200 : 900)
      await say(`Hello, ${name}.`, hold * 0.8)

      // Beat 3 - a connection.
      phase('curious')
      await ask('What’s something you’ve been curious about lately?', (answer) => latest.current.onSubmitCurious(answer))
      await wait(reduceMotion ? 200 : 1600)
      await say('Two thoughts, and already a connection.')

      // Beat 4 - the concept.
      phase('concept')
      setGhosts(true)
      await say('Every time you talk to Claude, it notices the things that matter to you.', hold * 1.2)
      await say('Each one becomes a star.')
      await say('Ideas that are alike drift closer together.')
      setGhosts(false)

      // Beat 5 - learn by doing.
      phase('orbit')
      setLine({ key: 'orbit', text: 'Drag to look around.', shown: true })
      await until('orbited')
      setLine(l => l && { ...l, shown: false })
      await wait(fade)
      phase('click')
      setLine({ key: 'click', text: 'Click a star.', shown: true })
      await until('starClicked')
      setLine(l => l && { ...l, shown: false })
      await wait(fade + 1200)

      // Beat 6 - hand-off.
      phase('handoff')
      await say('Now go talk to Claude.')
      await say('Your brain will grow on its own.')
      latest.current.onFinish()
    }

    run().catch(err => {
      if (!(err instanceof Cancelled)) console.error('First Light failed:', err)
    })

    const timers = timersRef.current
    return () => {
      aliveRef.current = false
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  const submit = (event) => {
    event.preventDefault()
    const value = draft.trim()
    if (!value || busy) return
    answerRef.current?.(value)
  }

  return (
    <div className={`first-light${reduceMotion ? ' is-reduced' : ''}`} style={{ '--fl-fade': `${fade}ms` }}>
      {ghosts && <GhostStars />}

      <div className="first-light-stage" aria-live="polite">
        {line && (
          <div key={line.key} className={`first-light-line${line.shown ? ' is-shown' : ''}`}>
            <p className="first-light-text">{line.text}</p>
            {line.prompt && (
              <form className="first-light-form" onSubmit={submit}>
                <input
                  ref={inputRef}
                  className="first-light-input"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  disabled={busy}
                  maxLength={line.key.startsWith('What should') ? 60 : 300}
                  aria-label={line.text}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="first-light-note">
                  {busy ? <span className="first-light-thinking">listening</span> : error || 'press Enter'}
                </p>
              </form>
            )}
          </div>
        )}
      </div>

      <button type="button" className="first-light-skip" onClick={onSkip}>skip</button>
    </div>
  )
}

// Faint stars drifting in from the edges, flickering and fading - a glimpse
// of the brain to come. Plain DOM over the canvas, not real nodes.
function GhostStars() {
  const ghosts = useMemo(() => Array.from({ length: GHOST_COUNT }, (_, i) => {
    const angle = Math.random() * Math.PI * 2
    const from = 48 + Math.random() * 10 // % from centre, at the edge
    const to = from * (0.45 + Math.random() * 0.2)
    return {
      id: i,
      x0: 50 + Math.cos(angle) * from, y0: 50 + Math.sin(angle) * from,
      x1: 50 + Math.cos(angle) * to, y1: 50 + Math.sin(angle) * to,
      delay: Math.random() * 5,
      duration: 6 + Math.random() * 4,
      size: 2 + Math.random() * 3
    }
  }), [])
  return (
    <div className="first-light-ghosts" aria-hidden="true">
      {ghosts.map(g => (
        <span
          key={g.id}
          className="first-light-ghost"
          style={{
            '--x0': `${g.x0}vw`, '--y0': `${g.y0}vh`, '--x1': `${g.x1}vw`, '--y1': `${g.y1}vh`,
            '--size': `${g.size}px`,
            animationDelay: `${g.delay}s`,
            animationDuration: `${g.duration}s`
          }}
        />
      ))}
    </div>
  )
}

export default FirstLight
