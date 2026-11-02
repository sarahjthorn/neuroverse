import { useEffect } from 'react'
import { axonLook } from './Axon'

// Axon's home on the Axon page: the creature itself (Axon.jsx) is drawn
// over the whole window and comes back here to wander. Its colour is the
// category of the option you've selected, and it carries one lit dot per
// open option.
function AxonStrip({ color, dots = [], height = 52 }) {
  // Off the Axon page it's plain grey, with no dots that could go stale.
  useEffect(() => {
    axonLook.color = color
    axonLook.dots = dots
    axonLook.redraw?.()
    return () => { axonLook.color = '#9a9a9e'; axonLook.dots = [] }
  }, [color, dots])

  return <div className="axon-strip" style={{ height }} aria-hidden="true" />
}

export default AxonStrip
