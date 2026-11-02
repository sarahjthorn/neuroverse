import { useLayoutEffect, useRef } from 'react'
import { EASE_OUT_EXPO, prefersReducedMotion } from '../utils/motion'

// Animates its height whenever `trigger` changes (e.g. a "Show all" toggle),
// instead of the list popping open or shut. The outer div animates; the
// inner one is measured at its natural height.
function SmoothHeight({ trigger, children, duration = 260 }) {
  const outer = useRef(null)
  const inner = useRef(null)
  const lastHeight = useRef(null)
  const lastTrigger = useRef(trigger)

  useLayoutEffect(() => {
    const height = inner.current.offsetHeight
    const from = lastHeight.current
    lastHeight.current = height
    if (lastTrigger.current === trigger) return
    lastTrigger.current = trigger
    if (from == null || from === height || prefersReducedMotion()) return
    const el = outer.current
    el.style.overflow = 'hidden'
    const anim = el.animate(
      [{ height: `${from}px` }, { height: `${height}px` }],
      { duration, easing: EASE_OUT_EXPO }
    )
    const done = () => { el.style.overflow = '' }
    anim.onfinish = done
    anim.oncancel = done
  })

  return (
    <div ref={outer}>
      <div ref={inner} className="smooth-height-inner">{children}</div>
    </div>
  )
}

export default SmoothHeight
