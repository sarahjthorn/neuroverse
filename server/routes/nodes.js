import express from 'express'
import { updateNode, deleteNode, getNode } from '../services/storage.js'
import { db } from '../services/db.js'

const router = express.Router()

// The other end of a node's strongest links, using the edge indexes - so
// MCP get_related_memories no longer downloads the whole graph per call.
const strongestNeighbours = db.prepare(`
  SELECT CASE WHEN source = @id THEN target ELSE source END AS id, strength
  FROM edges WHERE source = @id OR target = @id
  ORDER BY strength DESC LIMIT @limit
`)

/**
 * GET /api/nodes/:id/related?limit=5
 * { node: { id, title }, related: [{ node, strength }] }, strongest first
 */
router.get('/nodes/:id/related', (req, res) => {
  try {
    const node = getNode(req.params.id)
    if (!node) {
      return res.status(404).json({ error: 'Node not found' })
    }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 5))
    const related = strongestNeighbours.all({ id: node.id, limit })
      .map(r => ({ node: getNode(r.id), strength: r.strength }))
      .filter(r => r.node)
    res.json({ node: { id: node.id, title: node.data.title }, related })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get related nodes' })
  }
})

/**
 * GET /api/nodes/:id
 * Get a single node by ID
 */
router.get('/nodes/:id', (req, res) => {
  try {
    const node = getNode(req.params.id)
    if (!node) {
      return res.status(404).json({ error: 'Node not found' })
    }
    res.json(node)
  } catch (error) {
    res.status(500).json({ error: 'Failed to get node' })
  }
})

/**
 * PATCH /api/nodes/:id
 * Update a node
 */
router.patch('/nodes/:id', async (req, res) => {
  try {
    const updated = await updateNode(req.params.id, req.body)
    res.json(updated)
  } catch (error) {
    if (error.message === 'Node not found') {
      return res.status(404).json({ error: 'Node not found' })
    }
    res.status(500).json({ error: 'Failed to update node', message: error.message })
  }
})

/**
 * DELETE /api/nodes/:id
 * Delete a node
 */
router.delete('/nodes/:id', (req, res) => {
  try {
    deleteNode(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete node' })
  }
})

export default router
