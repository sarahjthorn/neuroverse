import express from 'express'
import { generateEmbedding, cosineSimilarity } from '../services/openai.js'
import { findNearestNodes, keywordSearchNodes, getRawNode, getNode } from '../services/storage.js'
import { answerFromMemories } from '../services/anthropic.js'

const router = express.Router()

// The vector index always returns *something*, however unrelated - below
// this cosine similarity a hit is noise rather than a match, so it's dropped
// instead of being shown (or fed to the answer model) as if it were relevant.
const MIN_SIMILARITY = 0.2

// Reciprocal rank fusion constant - the standard value from the original RRF
// paper. It damps the gap between rank 1 and rank 2 so neither search's top
// hit automatically wins; a memory found by both searches rises to the top.
const RRF_K = 60

/**
 * Hybrid search: embedding similarity (finds memories by meaning) plus BM25
 * keyword search (finds exact words like names), merged by reciprocal rank
 * fusion. Every result keeps its cosine `similarity` so callers can still
 * show or threshold it, and `keywordMatch` says whether BM25 found it too.
 *
 * `minSimilarity` drops weak meaning-only matches, but never a keyword match:
 * a memory that literally contains the searched word is relevant even when
 * its embedding is a long way off. If embedding fails (e.g. no OpenAI key),
 * search falls back to keyword matches only, with `similarity: null`.
 */
async function hybridSearch(q, { limit, category, minSimilarity = 0 }) {
  const pool = Math.max(limit * 5, 20)

  let queryEmbedding = null
  try {
    queryEmbedding = await generateEmbedding(q)
  } catch (error) {
    console.warn('Embedding failed, falling back to keyword-only search:', error.message)
  }

  const semanticIds = queryEmbedding ? findNearestNodes(queryEmbedding, { candidatePool: pool }) : []
  const keywordIds = keywordSearchNodes(q, { limit: pool })
  const keywordSet = new Set(keywordIds)

  const fused = new Map()
  const addRanks = ids => ids.forEach((id, rank) => {
    fused.set(id, (fused.get(id) || 0) + 1 / (RRF_K + rank + 1))
  })
  addRanks(semanticIds)
  addRanks(keywordIds)

  return [...fused.entries()]
    .map(([id, score]) => {
      const raw = getRawNode(id)
      if (!raw) return null
      const node = getNode(id)
      if (category && !node.data.categories.includes(category)) return null
      const similarity = queryEmbedding ? cosineSimilarity(queryEmbedding, JSON.parse(raw.embedding)) : null
      return { node, similarity, keywordMatch: keywordSet.has(id), score }
    })
    .filter(r => r && (r.keywordMatch || r.similarity >= minSimilarity))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * GET /api/search?q=...&limit=5&category=...&minSimilarity=0.2
 * Hybrid (meaning + keyword) search over memories - see hybridSearch().
 * minSimilarity defaults to 0 so the MCP server's existing callers keep
 * getting a full top-N list; the Home search bar passes it explicitly.
 */
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 5, category, minSimilarity = 0 } = req.query
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' })
    }

    const results = await hybridSearch(q, {
      limit: Math.max(1, parseInt(limit, 10) || 5),
      category,
      minSimilarity: Number(minSimilarity) || 0
    })

    res.json({ results })
  } catch (error) {
    console.error('Search failed:', error)
    res.status(500).json({ error: 'Search failed', message: error.message })
  }
})

/**
 * POST /api/ask { question }
 * Retrieves the most relevant memories and has Claude answer the question
 * from them. Returns the answer, the ids it cited, every retrieved memory
 * id (so the 3D view can light up the whole evidence set), and `askBack` -
 * a question for Sarah when the memories leave a gap (answer null = none).
 */
router.post('/ask', async (req, res) => {
  try {
    const question = (req.body?.question || '').trim()
    if (!question) {
      return res.status(400).json({ error: '"question" is required' })
    }

    const results = await hybridSearch(question, { limit: 8, minSimilarity: MIN_SIMILARITY })
    if (results.length === 0) {
      return res.json({ answer: null, citedIds: [], retrievedIds: [], askBack: null })
    }

    const memories = results.map(({ node }) => ({
      id: node.id,
      title: node.data.title,
      content: node.data.content || '',
      categories: node.data.categories || [],
      timestamp: node.data.timestamp
    }))
    const { answer, citedIds, askBack } = await answerFromMemories(question, memories)

    res.json({ answer, citedIds, askBack, retrievedIds: memories.map(m => m.id) })
  } catch (error) {
    console.error('Ask failed:', error)
    res.status(500).json({ error: 'Ask failed', message: error.message })
  }
})

export default router
