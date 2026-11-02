import { useEffect, useState } from 'react'

// Keeps the last non-null `value` around for `exitMs` after it goes null, so
// a panel can play its exit animation before unmounting. Returns
// [valueToRender, isLeaving]. Setting a value again mid-exit cancels it.
export function usePresence(value, exitMs) {
  const [shown, setShown] = useState(value)
  // Remembered during render (not in an effect) so the frame where `value`
  // turns null still has something to render - no unmount/remount flash.
  if (value && value !== shown) setShown(value)
  const leaving = !value && !!shown

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setShown(null), exitMs)
    return () => clearTimeout(timer)
  }, [leaving, exitMs])

  return [value || shown, leaving]
}
