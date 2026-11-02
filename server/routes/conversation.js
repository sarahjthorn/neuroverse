import express from 'express'
import { extractMemories as extractMemoriesWithGPT, generateEmbedding } from '../services/openai.js'
import { extractMemoriesWithClaude, getModelInfo as getClaudeModelInfo } from '../services/anthropic.js'
import { loadGraph, addToGraph, findNearestNodes, getRawNode } from '../services/storage.js'
import { resolveCategoryId, findOrCreateKeyword, setKeywordKind, ENTITY_KINDS } from '../services/taxonomy.js'
import { computeCompositeScore } from '../services/scoring.js'
import { reviewMemory } from '../services/memoryReview.js'
import { config } from '../config.js'

const router = express.Router()

/**
 * Extract memories using the configured model
 */
async function extractMemories(conversationText, threadName) {
  const model = config.extractionModel

  if (model === 'gpt-4o') {
    return await extractMemoriesWithGPT(conversationText, threadName)
  } else {
    // Use Claude for both 'claude-haiku' and 'claude-sonnet' (same model currently)
    const modelInfo = getClaudeModelInfo(model)
    return await extractMemoriesWithClaude(conversationText, threadName, modelInfo.id)
  }
}

/**
 * Memories Claude has already written (MCP store_memory / store_memories),
 * stored exactly as sent - no extraction call, so only embeddings are paid
 * for (COST.md #1). Categories are checked against the fixed list here, and
 * the free checks in memoryReview.js return notes on anything that looks
 * off (two ideas in one, too long, no keywords) for the saving Claude to
 * fix itself. Returns { result (as storeMemories), reviews }.
 */
export async function storeWrittenMemories(memories) {
  const timestamp = new Date().toISOString()
  const dropped = []
  const cleaned = memories.map((memory, i) => {
    const categories = (memory.categories || []).filter(c => typeof c === 'string')
    dropped[i] = categories.filter(c => !resolveCategoryId(c))
    return {
      title: memory.title.trim() || memory.content.trim().split(/\s+/).slice(0, 5).join(' '),
      content: memory.content.trim(),
      categories,
      keywords: (memory.keywords || []).filter(k => typeof k === 'string' && k.trim()),
      entities: (memory.entities || []).filter(e => ENTITY_KINDS.includes(e?.kind)),
      thread: 'General',
      timestamp
    }
  })

  const [result, reviews] = await Promise.all([
    storeMemories(cleaned),
    Promise.all(cleaned.map((memory, i) => reviewMemory(memory, { categoriesDropped: dropped[i] })))
  ])
  return { result, reviews: reviews.filter(r => r.notes.length) }
}

/**
 * Find relationships for a newly-added node against everything already in
 * the DB (including other nodes from this same batch, inserted just before
 * this runs). Uses the vec0 index to narrow to a candidate pool by embedding
 * proximity, then scores each candidate with the Phase 2 composite score
 * (embedding similarity + keyword overlap + category adjacency) rather than
 * raw cosine similarity alone - see server/services/scoring.js.
 */
function detectRelationshipsForNode(node, threshold = 0.6) {
  const candidateIds = findNearestNodes(node.data.embedding, {
    excludeId: node.id,
    candidatePool: 30
  })

  const edges = []
  for (const candidateId of candidateIds) {
    const candidate = getRawNode(candidateId)
    if (!candidate) continue

    const score = computeCompositeScore(
      node.id,
      candidateId,
      node.data.embedding,
      JSON.parse(candidate.embedding)
    )
    if (score.strength > threshold) {
      edges.push({
        id: `e${node.id}-${candidateId}`,
        source: node.id,
        target: candidateId,
        data: {
          strength: score.strength,
          type: score.strength > 0.8 ? 'strong' : 'moderate',
          embeddingSimilarity: score.embeddingSimilarity,
          keywordOverlap: score.keywordOverlap,
          categoryBoost: score.categoryBoost
        }
      })
    }
  }
  return edges
}

/**
 * POST /api/process-conversation
 * Process a conversation and extract memories
 */
router.post('/process-conversation', async (req, res) => {
  try {
    const { conversation, threadName } = req.body

    if (!conversation) {
      return res.status(400).json({ error: 'Conversation text is required' })
    }

    res.json(await ingestConversation(conversation, threadName))
  } catch (error) {
    console.error('Error processing conversation:', error)
    res.status(500).json({
      error: 'Failed to process conversation',
      message: error.message
    })
  }
})

/**
 * POST /api/memories/batch
 * { memories: [{ title, content, categories?, keywords?, entities? }] } (1-100)
 * -> { inputCount, stored: [{ id, title, content, categories, keywords }],
 *      reviews: [{ title, notes, parts? }] }
 * Used by MCP store_memory (one memory) and store_memories. Stored as
 * written, see storeWrittenMemories(). Returns only what was stored, not
 * the whole graph (which is ~1.5MB).
 */
router.post('/memories/batch', async (req, res) => {
  try {
    const { memories } = req.body
    if (!Array.isArray(memories) || memories.length === 0 || memories.length > 100) {
      return res.status(400).json({ error: 'memories must be an array of 1-100 items' })
    }
    const valid = memories.filter(m => typeof m?.title === 'string' && typeof m?.content === 'string' && m.content.trim())
    if (valid.length !== memories.length) {
      return res.status(400).json({ error: 'every memory needs a title and content' })
    }

    const { result, reviews } = await storeWrittenMemories(valid)
    const newIds = new Set(result.newNodeIds)
    const stored = result.nodes
      .filter(n => newIds.has(n.id))
      .map(n => ({ id: n.id, title: n.data.title, content: n.data.content, categories: n.data.categories, keywords: n.data.keywords }))
    res.json({ inputCount: valid.length, stored, reviews })
  } catch (error) {
    console.error('Error storing memory batch:', error)
    res.status(500).json({ error: 'Failed to store memories', message: error.message })
  }
})

/**
 * The whole extract → embed → tag → link pipeline behind
 * POST /api/process-conversation, shared with answering one of the brain's
 * questions (server/routes/questions.js). Returns the updated graph plus
 * newNodeIds.
 */
export async function ingestConversation(conversation, threadName) {
  console.log(`Processing conversation for thread: ${threadName || 'General'}`)
  console.log(`Using extraction model: ${config.extractionModel}`)

  // Step 1: Extract memories using configured AI model
  const memories = await extractMemories(conversation, threadName)
  console.log(`Extracted ${memories.length} memories`)

  return storeMemories(memories)
}

/**
 * Steps 2-8 of the pipeline: embed → tag → lay out → link already-written
 * memories ({ title, content, categories, keywords, entities?, thread,
 * timestamp }). The First Light intro (server/routes/intro.js) calls this
 * directly for memories it writes itself, skipping the extraction call.
 */
export async function storeMemories(memories) {
  if (memories.length === 0) {
    return { ...loadGraph(), newNodeIds: [] }
  }

  // Step 2: Generate embeddings for each memory
  const memoriesWithEmbeddings = await Promise.all(
    memories.map(async (memory) => {
      const textForEmbedding = `${memory.title}. ${memory.content}. ${memory.keywords.join(', ')}`
      const embedding = await generateEmbedding(textForEmbedding)

      return {
        ...memory,
        id: generateId(),
        embedding
      }
    })
  )

  // Step 3: Resolve categories & keywords against the controlled
  // vocabularies (docs/ARCHITECTURE.md). Sequential per
  // memory - keyword minting can call the embedding API for a genuinely
  // new term, and running that concurrently across memories in the same
  // batch risks two memories racing to insert the same new keyword at
  // once (it's UNIQUE, so the loser would throw instead of just reusing
  // the winner's row).
  for (const memory of memoriesWithEmbeddings) {
    const categoryIds = []
    const categoryNames = []
    for (const name of memory.categories || []) {
      const id = resolveCategoryId(name)
      if (id) {
        categoryIds.push(id)
        categoryNames.push(name)
      } else {
        console.warn(`Model returned unknown category "${name}" - skipped`)
      }
    }
    if (categoryIds.length === 0) {
      // Never leave a memory with zero categories, even if the model
      // returned nothing usable.
      const fallbackId = resolveCategoryId('Personal')
      if (fallbackId) {
        categoryIds.push(fallbackId)
        categoryNames.push('Personal')
      }
    }

    const keywordIds = []
    const keywordTerms = []
    const seenTerms = new Set()
    const keywordByRawTerm = new Map()
    for (const term of memory.keywords || []) {
      const keyword = await findOrCreateKeyword(term)
      if (!keyword) continue
      keywordByRawTerm.set(term.trim().toLowerCase(), keyword)
      const key = keyword.term.toLowerCase()
      if (seenTerms.has(key)) continue
      seenTerms.add(key)
      keywordIds.push(keyword.id)
      keywordTerms.push(keyword.term)
    }

    // Entity kinds go on the keyword the term resolved to (which may be an
    // alias or fuzzy match of what the model wrote). Only ever adds a kind -
    // a keyword the model didn't list this time keeps whatever it had.
    for (const entity of memory.entities || []) {
      const keyword = keywordByRawTerm.get((entity?.name || '').trim().toLowerCase())
      if (keyword && ENTITY_KINDS.includes(entity.kind)) {
        setKeywordKind(keyword.id, entity.kind, 'model')
      }
    }

    memory.categoryIds = categoryIds
    memory.categories = categoryNames
    memory.keywordIds = keywordIds
    memory.keywords = keywordTerms
  }

  // Step 4: Format nodes for storage
  const newNodes = memoriesWithEmbeddings.map(memory => ({
    id: memory.id,
    data: {
      title: memory.title,
      content: memory.content,
      categories: memory.categories,
      categoryIds: memory.categoryIds,
      keywords: memory.keywords,
      keywordIds: memory.keywordIds,
      thread: memory.thread,
      timestamp: memory.timestamp,
      embedding: memory.embedding
    }
  }))

  // Step 5: Persist nodes first so the vector index can find them
  // (including against each other, for relationships within this batch).
  addToGraph(newNodes, [])

  // Step 7: Detect relationships for each new node via the vector index.
  const newEdges = newNodes.flatMap(node => detectRelationshipsForNode(node, 0.6))
  console.log(`Detected ${newEdges.length} relationships`)

  // Step 8: Persist the edges (dedup against reverse-direction happens inside addToGraph).
  const updatedGraph = addToGraph([], newEdges)

  console.log(`Final graph: ${updatedGraph.nodes.length} nodes, ${updatedGraph.edges.length} edges`)

  // newNodeIds lets the MCP store_memory tool report every node one call
  // was split into, not just the input it sent.
  return { ...updatedGraph, newNodeIds: newNodes.map(n => n.id) }
}

/**
 * Generate a unique ID
 */
function generateId() {
  return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export default router
