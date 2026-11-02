import express from 'express'
import { getCategories } from '../services/taxonomy.js'

const router = express.Router()

/**
 * GET /api/categories
 * The fixed category list (CANONICAL_CATEGORIES in services/db.js).
 */
router.get('/categories', (req, res) => {
  try {
    res.json(getCategories())
  } catch (error) {
    res.status(500).json({ error: 'Failed to list categories' })
  }
})

export default router
