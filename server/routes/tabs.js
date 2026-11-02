import express from 'express'
import { db, getSetting, setSetting } from '../services/db.js'

const router = express.Router()

// Optional tabs that exist and can be switched on. Keep in sync with the
// `ready` entries of OPTIONAL_TABS in src/tabs.js - "coming soon" tabs
// aren't listed here, so they can't be switched on before they're built.
const AVAILABLE = ['wishlist', 'axon']
const KEY = 'enabled_tabs'

// Before anyone has chosen, a brain that already has wishlist items keeps
// the Wishlist tab (it was always visible before tabs became optional);
// a fresh brain starts with just the core tabs.
function enabledTabs() {
  const stored = getSetting(KEY)
  if (stored !== null) {
    try {
      return JSON.parse(stored).filter(id => AVAILABLE.includes(id))
    } catch {
      return []
    }
  }
  const hasWishlist = db.prepare('SELECT 1 FROM wishlist_items LIMIT 1').get()
  return hasWishlist ? ['wishlist'] : []
}

/**
 * GET /api/tabs
 * { enabled: ['wishlist', ...] } - the optional tabs switched on.
 */
router.get('/tabs', (req, res) => {
  res.json({ enabled: enabledTabs() })
})

/**
 * PUT /api/tabs/:id  { enabled: boolean }
 * Switches one optional tab on or off. Turning a tab off only hides it -
 * its data (e.g. wishlist items) is kept and Claude can still add to it.
 */
router.put('/tabs/:id', (req, res) => {
  const { id } = req.params
  if (!AVAILABLE.includes(id)) return res.status(400).json({ error: `"${id}" isn't an optional tab that can be switched on yet` })
  const current = enabledTabs().filter(t => t !== id)
  const next = req.body.enabled ? AVAILABLE.filter(t => t === id || current.includes(t)) : current
  setSetting(KEY, JSON.stringify(next))
  res.json({ enabled: next })
})

export default router
