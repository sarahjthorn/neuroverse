import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './AxonView.css'

// Axon, the creature, on every page while
// the Axon tab is switched on. It's drawn on a see-through layer over the
// whole window (clicks go straight through) and is the highlight: switch
// tabs and it crawls up to the new one and curls around it.
//
// On the Axon page it then highlights what you pick: it curls round the
// open option, or the option, sort or action you last clicked. With nothing
// to highlight it wanders in its strip (AxonStrip). It doesn't follow the
// mouse. A few seconds on the same thing and it settles, still, until
// something changes. Its colour is the category of the option selected on
// the Axon page, and it carries one lit dot per open option (axonLook, set
// by AxonStrip).
//
// The body retraces the exact path the head swam (a trail sampled at a
// fixed spacing), so it can't kink or fold back on itself. The head turns
// at a limited rate and never stops until it settles, so its path is always a smooth curve.
const SEG = 6
const LENGTH = 20
const SPEED = 38
const TURN = 1.2
const VISIT_MS = 2500
const SETTLE_MS = 6000

export const axonLook = { color: '#9a9a9e', dots: [], redraw: null }

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
const within = (r, p, m = 0) => p.x > r.left + m && p.x < r.right - m && p.y > r.top + m && p.y < r.bottom - m
const activeTab = () => document.querySelector('.top-nav-tab.active, .top-nav-about.active') || document.querySelector('.top-nav-brand')

function Axon({ view }) {
  const canvasRef = useRef(null)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tab = activeTab()?.getBoundingClientRect()
    const head = { x: tab ? tab.left : 40, y: tab ? tab.bottom + 6 : 40, a: 0.2 }
    let target = { x: head.x + 100, y: head.y }
    let seenView = viewRef.current
    let visitUntil = 0
    let dist = 0
    let trail = []
    const straighten = () => {
      dist = 0
      trail = []
      for (let i = LENGTH * SEG + 4; i >= 0; i--) trail.push({ x: head.x - i, y: head.y, d: -i })
    }
    straighten()
    let shown = axonLook.color
    let frame = 0
    let last = performance.now()

    const sample = s => {
      const t = dist - s
      let lo = 0
      for (let i = trail.length - 1; i > 0; i--) if (trail[i - 1].d <= t) { lo = i - 1; break }
      const a = trail[lo]
      const b = trail[Math.min(lo + 1, trail.length - 1)]
      const f = b.d === a.d ? 0 : (t - a.d) / (b.d - a.d)
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
    const mix = (from, to, t) => {
      const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
      const A = p(from), B = p(to)
      return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')
    }
    // New targets in the strip, roughly ahead, so it swings round in arcs
    // instead of doubling back on itself.
    const pickTarget = (r) => {
      for (let k = 0; k < 12; k++) {
        const t = { x: r.left + 30 + Math.random() * (r.width - 60), y: r.top + 12 + Math.random() * (r.height - 24) }
        const off = Math.abs(wrap(Math.atan2(t.y - head.y, t.x - head.x) - head.a))
        if (off < 1.3 && Math.hypot(t.x - head.x, t.y - head.y) > 80) return t
      }
      return { x: head.x < r.left + r.width / 2 ? r.right - 40 : r.left + 40, y: r.top + r.height / 2 }
    }

    // Out in the page it hurries, faster the further it has to go, and
    // turns tighter to match.
    const hurry = () => {
      const speed = SPEED + Math.min(Math.hypot(target.x - head.x, target.y - head.y), 400) * 0.8
      return { speed, turn: Math.max(TURN, speed / 28) }
    }

    // Crawl round the outline of an element, a few px outside it, clockwise:
    // find where it is along the outline and aim a little further on, so it
    // follows the edge and rounds the corners. Works for a small tab or a
    // whole option card.
    const hug = (el) => {
      const r = el.getBoundingClientRect()
      const l = r.left - 10, t = r.top - 10, rt = r.right + 10, b = r.bottom + 10
      const w = rt - l, h = b - t
      let x = Math.max(l, Math.min(rt, head.x)), y = Math.max(t, Math.min(b, head.y))
      if (Math.hypot(head.x - x, head.y - y) > 40) {
        target = { x, y }
        return hurry()
      }
      const edge = Math.min(y - t, rt - x, b - y, x - l)
      const s = edge === y - t ? x - l : edge === rt - x ? w + (y - t) : edge === b - y ? w + h + (rt - x) : 2 * w + h + (b - y)
      const n = (s + 20) % (2 * (w + h))
      target = n < w ? { x: l + n, y: t }
        : n < w + h ? { x: rt, y: t + n - w }
        : n < 2 * w + h ? { x: rt - (n - w - h), y: b }
        : { x: l, y: b - (n - 2 * w - h) }
      return { speed: SPEED * 1.6, turn: (SPEED * 1.6) / 12, at: el }
    }

    // On the Axon page it highlights the last thing you clicked (an option,
    // a sort, an action), or the open option.
    let picked = null
    // Once it has spent SETTLE_MS on the same thing it stops still, curled
    // where it is, and wakes when you switch tabs, select something or
    // scroll.
    let settled = false
    let settleOn = null
    let settleSince = 0
    const wake = () => {
      if (!settled) return
      settled = false
      settleOn = null
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }

    const onPick = e => {
      const el = e.target.closest?.('.axon-view .today-item-main, .axon-view .today-sort button, .axon-view .today-actions button')
      if (el) picked = el.classList.contains('today-item-main') ? el.closest('.today-item') : el
      wake()
    }
    if (!reduced) document.addEventListener('click', onPick, true)
    const onScreen = el => {
      const r = el?.isConnected && el.getBoundingClientRect()
      return r && r.width && r.bottom > 0 && r.top < window.innerHeight ? el : null
    }

    // Where it's heading this frame, and how fast and tightly it moves.
    const steer = (now, dt) => {
      if (viewRef.current !== seenView) {
        seenView = viewRef.current
        visitUntil = now + VISIT_MS
        picked = null
      }
      // Off the Axon page, and for a moment after you switch to it, it
      // curls round the active tab.
      if (viewRef.current !== 'axon' || now < visitUntil) {
        const tab = activeTab()
        return tab ? hug(tab) : { speed: SPEED, turn: TURN }
      }
      const selected = onScreen(picked) || onScreen(document.querySelector('.today-item.is-open'))
      if (selected) return hug(selected)
      // Nothing to highlight: home to its strip and wander there.
      const strip = document.querySelector('.axon-strip')
      if (!strip) return { speed: SPEED, turn: TURN }
      const home = strip.getBoundingClientRect()
      if (!within(home, head, 6)) {
        target = { x: home.left + home.width / 2, y: home.top + home.height / 2 }
        return hurry()
      }
      if (Math.hypot(target.x - head.x, target.y - head.y) < 18 || !within(home, target)) target = pickTarget(home)
      // Steer off the top and bottom edges of the strip.
      if (head.y < home.top + 10) head.a += wrap(Math.PI / 2 - head.a) * dt * 2
      if (head.y > home.bottom - 10) head.a += wrap(-Math.PI / 2 - head.a) * dt * 2
      return { speed: SPEED, turn: TURN, at: strip }
    }

    const draw = (now) => {
      const dt = Math.min(0.04, (now - last) / 1000)
      last = now
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.lineCap = 'round'

      if (reduced) {
        // A still picture, and only in its strip on the Axon page.
        const strip = viewRef.current === 'axon' && document.querySelector('.axon-strip')
        if (!strip) return
        const home = strip.getBoundingClientRect()
        head.x = home.left + 40 + LENGTH * SEG
        head.y = home.top + home.height / 2
        head.a = 0
        straighten()
      } else {
        const { speed, turn, at } = steer(now, dt)
        if (!at || at !== settleOn) {
          settleOn = at
          settleSince = now
        } else if (now - settleSince > SETTLE_MS) settled = true
        const goal = Math.atan2(target.y - head.y, target.x - head.x)
        head.a += Math.max(-turn * dt, Math.min(turn * dt, wrap(goal - head.a)))
        const step = speed * dt
        head.x += Math.cos(head.a) * step
        head.y += Math.sin(head.a) * step
        dist += step
        trail.push({ x: head.x, y: head.y, d: dist })
        while (trail.length > 2 && trail[1].d < dist - LENGTH * SEG - 10) trail.shift()
      }

      const want = axonLook.color
      shown = !reduced && /^#[0-9a-f]{6}$/i.test(shown) && /^#[0-9a-f]{6}$/i.test(want) ? mix(shown, want, Math.min(1, dt * 3)) : want

      const pts = Array.from({ length: LENGTH }, (_, i) => sample(i * SEG))
      const phase = dist * 0.09
      const body = pts.map((p, i) => {
        const q = pts[Math.min(i + 1, LENGTH - 1)]
        const r = pts[Math.max(i - 1, 0)]
        const dx = r.x - q.x, dy = r.y - q.y
        const l = Math.hypot(dx, dy) || 1
        const nx = -dy / l, ny = dx / l
        const off = reduced ? 0 : Math.sin(phase - i * 0.45) * 2.6 * (i / LENGTH)
        return { x: p.x + nx * off, y: p.y + ny * off, nx, ny }
      })
      const line = () => {
        ctx.beginPath()
        body.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
      }

      ctx.strokeStyle = shown
      ctx.globalAlpha = 0.14
      ctx.lineWidth = 9
      line()
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.6
      body.forEach((p, i) => {
        if (!i) return
        const r = 6 * (1 - i / LENGTH) + 1.4
        ctx.beginPath()
        ctx.moveTo(p.x + p.nx * r, p.y + p.ny * r)
        ctx.lineTo(p.x - p.nx * r, p.y - p.ny * r)
        ctx.stroke()
      })
      ctx.globalAlpha = 1
      ctx.lineWidth = 1.4
      line()

      // One lit dot per open option, in that option's colour.
      axonLook.dots.slice(0, 8).forEach((c, k) => {
        const p = body[Math.min(LENGTH - 1, 4 + k * 2)]
        ctx.fillStyle = c
        ctx.globalAlpha = 0.22
        ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, 7); ctx.fill()
        ctx.globalAlpha = 1
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.7, 0, 7); ctx.fill()
      })
      ctx.fillStyle = shown
      ctx.beginPath(); ctx.arc(head.x, head.y, 3.6, 0, 7); ctx.fill()

      if (!reduced && !settled) frame = requestAnimationFrame(draw)
    }
    // With reduced motion it's redrawn when what it shows changes, the
    // view changes (below), the window is resized or the page scrolls.
    // Otherwise those wake it if it has settled.
    const redraw = reduced ? () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw) } : wake
    axonLook.redraw = redraw
    window.addEventListener('resize', redraw)
    window.addEventListener('scroll', redraw, true)
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('click', onPick, true)
      window.removeEventListener('resize', redraw)
      window.removeEventListener('scroll', redraw, true)
      axonLook.redraw = null
    }
  }, [])

  useEffect(() => { axonLook.redraw?.() }, [view])

  // Straight into <body>: a page card's backdrop-filter would otherwise trap
  // a fixed-position layer inside the card.
  return createPortal(<canvas ref={canvasRef} className="axon-crawler" aria-hidden="true" />, document.body)
}

export default Axon
