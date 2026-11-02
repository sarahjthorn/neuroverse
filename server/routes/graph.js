import express from 'express'
import { loadGraph } from '../services/storage.js'
import { db } from '../services/db.js'
import { recalculateRelationships } from '../services/rescoring.js'
import { detectDuplicates, mergeDuplicate, checkDuplicatesWithClaude } from '../services/duplicates.js'

const router = express.Router()

// The graph plus its near-duplicate suggestions - every mutating route
// below returns this so the client can refresh in one round trip. (Cluster
// and "needs a parent" suggestions were removed 2026-09-30: they mostly
// re-flagged sibling/general-vs-specific pairs and added noise to Tidy up.)
function graphWithSuggestions() {
  return { ...loadGraph(), suggestedDuplicates: detectDuplicates() }
}

/**
 * GET /api/graph/signature
 * A tiny "has anything been added or removed?" check the app polls while
 * it's open, so memories Claude stores over MCP appear (and burst into
 * existence) without a reload. Only fetches the full graph when this changes.
 */
router.get('/graph/signature', (req, res) => {
  try {
    const row = db.prepare('SELECT COUNT(*) AS count, MAX(timestamp) AS latest FROM nodes').get()
    res.json({ signature: `${row.count}|${row.latest || ''}` })
  } catch (error) {
    res.status(500).json({ error: 'Failed to read graph signature' })
  }
})

/**
 * GET /api/graph
 * Returns the entire knowledge graph, plus near-duplicate suggestions
 * (read-only, recomputed on every fetch, cheap at this app's scale).
 */
router.get('/graph', (req, res) => {
  try {
    res.json(graphWithSuggestions())
  } catch (error) {
    res.status(500).json({ error: 'Failed to load graph' })
  }
})

/**
 * POST /api/graph/duplicates/resolve
 * Persists a confirmed near-duplicate suggestion (Phase 6,
 * docs/ARCHITECTURE.md). Body: { existingId, duplicateId }. The
 * duplicate's content is discarded, its tags and edges folded onto the
 * existing node, then the duplicate node is deleted - never automatic, always an
 * explicit user action.
 */
router.post('/graph/duplicates/resolve', (req, res) => {
  try {
    const { existingId, duplicateId } = req.body
    if (!existingId || !duplicateId) {
      return res.status(400).json({ error: 'existingId and duplicateId are required' })
    }
    mergeDuplicate(existingId, duplicateId)
    res.json(graphWithSuggestions())
  } catch (error) {
    if (error.message.endsWith('not found')) {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to resolve duplicate', message: error.message })
  }
})

/**
 * POST /api/graph/duplicates/check
 * "Check with Claude" on the Tidy up card - the one paid step in duplicate
 * detection (see COST.md). Asks Claude about the most similar unreviewed
 * pairs, stores its verdicts, and returns { checked, found, remaining, graph }.
 */
router.post('/graph/duplicates/check', async (req, res) => {
  try {
    const stats = await checkDuplicatesWithClaude()
    res.json({ ...stats, graph: graphWithSuggestions() })
  } catch (error) {
    console.error('Failed to check duplicates with Claude:', error)
    res.status(500).json({ error: 'Failed to check duplicates', message: error.message })
  }
})

/**
 * POST /api/graph/recalculate-relationships
 * On-demand re-scoring pass (docs/ARCHITECTURE.md). Local-only,
 * no API calls - never triggered automatically.
 */
router.post('/graph/recalculate-relationships', (req, res) => {
  try {
    const stats = recalculateRelationships()
    res.json({ ...stats, graph: graphWithSuggestions() })
  } catch (error) {
    console.error('Failed to recalculate relationships:', error)
    res.status(500).json({ error: 'Failed to recalculate relationships', message: error.message })
  }
})

export default router
