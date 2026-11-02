// Shared motion helpers. CSS timings live as tokens in index.css
// (--ease-out-expo, --panel-in-ms...); these mirror them for JS-driven
// (Web Animations API) motion.

export const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// Search bar handoff between Home's big Ask bar and the top-nav search: the
// one leaving tells us where it was, the one arriving flies in from there,
// so it reads as the same bar sliding up into the nav (or back down).
let searchOrigin = null
// How long after the old bar leaves the new one can still fly in from it.
const SEARCH_HANDOFF_MS = 500

export function rememberSearchOrigin(el) {
  searchOrigin = { rect: el.getBoundingClientRect(), at: performance.now() }
}

// Not consumed on read: StrictMode mounts twice, and the second mount needs
// it too. The short window keeps it from replaying on a later visit.
export function peekSearchOrigin() {
  if (!searchOrigin || performance.now() - searchOrigin.at > SEARCH_HANDOFF_MS) return null
  return searchOrigin.rect
}

// FLIP-style: starts `el` at `from`'s position and size and eases it into
// its own. Width/height animate directly (not scale) so the text and icon
// inside never stretch; overflow is clipped while the box is undersized.
export function flyFromRect(el, from, { duration = 520 } = {}) {
  if (!el || !from || prefersReducedMotion()) return null
  const to = el.getBoundingClientRect()
  if (!to.width || !from.width) return null
  el.style.overflow = 'hidden'
  const anim = el.animate([
    {
      transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
      width: `${from.width}px`,
      height: `${from.height}px`
    },
    { transform: 'none', width: `${to.width}px`, height: `${to.height}px` }
  ], { duration, easing: EASE_OUT_EXPO })
  const restore = () => { el.style.overflow = '' }
  anim.onfinish = restore
  anim.oncancel = restore
  return anim
}
