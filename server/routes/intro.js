import express from 'express'
import { ingestConversation, storeMemories } from './conversation.js'
import { addToGraph, getNode, updateNode } from '../services/storage.js'
import { detectDuplicates } from '../services/duplicates.js'
import { getSetting, setSetting } from '../services/db.js'
import { userName } from '../config.js'

// "First Light" - the game-style intro a brand-new brain opens with.
// The client drives the beats; the server only stores
// the two answers as memories and remembers that the intro was done.

const router = express.Router()

// Memories the intro creates are tagged with this thread, so Home can tell
// "only the intro's stars so far" apart from real memories from Claude.
export const INTRO_THREAD = 'First Light'
const NAME_MAX = 60
const ANSWER_MAX = 500

function identityNodeId() {
  const id = getSetting('identity_node_id')
  return id && getNode(id) ? id : null
}

function withDuplicates(graph) {
  return { ...graph, suggestedDuplicates: detectDuplicates() }
}

/**
 * GET /api/intro
 * Whether the intro has been done, and the owner's name / star if known.
 */
router.get('/intro', (req, res) => {
  res.json({
    completed: Boolean(getSetting('intro_completed_at')),
    name: userName() || null,
    identityNodeId: identityNodeId()
  })
})

/**
 * POST /api/intro/name  { name }
 * Saves the name (the DB copy beats USER_NAME in .env) and lights the
 * owner's own star. Replaying the intro reuses that star - renaming it if
 * the name changed - rather than adding a second one. Cost: one embedding.
 */
router.post('/intro/name', async (req, res) => {
  try {
    const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
    if (!name) return res.status(400).json({ error: 'A name is required' })
    setSetting('owner_name', name)

    const memory = {
      title: name,
      content: `${name} is the owner of this brain.`,
      categories: ['Personal'],
      keywords: [name],
      entities: [{ name, kind: 'person' }],
      thread: INTRO_THREAD,
      timestamp: new Date().toISOString()
    }

    const existingId = identityNodeId()
    if (existingId) {
      const node = getNode(existingId)
      if (node.data.title !== name) {
        await updateNode(existingId, { data: { title: memory.title, content: memory.content } })
      }
      const graph = withDuplicates(addToGraph([], []))
      return res.json({ ...graph, identityNodeId: existingId, newNodeIds: [] })
    }

    const graph = await storeMemories([memory])
    const id = graph.newNodeIds[0]
    setSetting('identity_node_id', id)
    res.json({ ...withDuplicates(graph), identityNodeId: id })
  } catch (error) {
    console.error('Intro name failed:', error)
    res.status(500).json({ error: 'Failed to save name', message: error.message })
  }
})

/**
 * POST /api/intro/curious  { answer }
 * "What's something you've been curious about lately?" - runs through the
 * normal extraction (one Haiku call + embeddings), then links every new
 * memory to the owner's star with a `manual` edge, which re-scoring never
 * touches. That line is the intro's first lesson in what a link is.
 */
router.post('/intro/curious', async (req, res) => {
  try {
    const answer = String(req.body?.answer || '').trim().slice(0, ANSWER_MAX)
    if (!answer) return res.status(400).json({ error: 'An answer is required' })
    const owner = userName() || 'The user'

    let graph = await ingestConversation(
      `${owner}'s brain asked them: What's something you've been curious about lately?\n\n${owner} answered: ${answer}`,
      INTRO_THREAD
    )
    // Extraction found nothing worth keeping (a one-word answer, say) -
    // the intro still needs its second star, so store the answer as-is.
    if (graph.newNodeIds.length === 0) {
      graph = await storeMemories([{
        title: answer.length > 40 ? `${answer.slice(0, 39)}…` : answer,
        content: `${owner} has been curious about ${answer} lately.`,
        categories: ['Interests'],
        keywords: [],
        thread: INTRO_THREAD,
        timestamp: new Date().toISOString()
      }])
    }

    const { newNodeIds } = graph
    const anchorId = identityNodeId()
    if (anchorId) {
      graph = addToGraph([], newNodeIds.map(id => ({
        id: `e${id}-${anchorId}`,
        source: id,
        target: anchorId,
        data: { strength: 0.8, type: 'manual' }
      })))
    }

    res.json({ ...withDuplicates(graph), newNodeIds })
  } catch (error) {
    console.error('Intro answer failed:', error)
    res.status(500).json({ error: 'Failed to save answer', message: error.message })
  }
})

/**
 * POST /api/intro/complete
 * Finished or skipped - either way, don't open with the intro again.
 */
router.post('/intro/complete', (req, res) => {
  setSetting('intro_completed_at', new Date().toISOString())
  res.json({ completed: true })
})

export default router
