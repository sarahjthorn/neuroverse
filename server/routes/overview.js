import express from 'express'
import { db } from '../services/db.js'
import { ENTITY_KINDS } from '../services/taxonomy.js'

const router = express.Router()

// The "map of the brain" Claude reads instead of every memory (MCP
// `get_brain_overview`). Counts and titles only, straight from SQL, so its
// size stays roughly fixed however big the brain gets - Claude then uses
// search_memories to read the memories it actually needs. Free: no API calls.
const ENTITIES_PER_KIND = 12
const KEYWORDS_PER_CATEGORY = 6
const TITLES_PER_CATEGORY = 2
// With ?category=X Claude asked for more detail on one part of life
const KEYWORDS_FOCUSED = 25
const TITLES_FOCUSED = 10

const countAll = db.prepare(`SELECT COUNT(*) AS n FROM nodes`)

const categoryCounts = db.prepare(`
  SELECT c.name, COUNT(*) AS count FROM node_categories nc
  JOIN categories c ON c.id = nc.category_id
  GROUP BY c.id ORDER BY count DESC
`)

// Entities mentioned at least twice, so one-off names don't crowd it
const entitiesOfKind = db.prepare(`
  SELECT k.term, COUNT(*) AS count FROM keywords k
  JOIN node_keywords nk ON nk.keyword_id = k.id
  WHERE k.kind = ?
  GROUP BY k.id HAVING count >= 2
  ORDER BY count DESC, k.term LIMIT ?
`)

// Keywords used at least twice in the category (one-offs are noise here)
const topKeywordsIn = db.prepare(`
  SELECT k.term, COUNT(*) AS count FROM node_keywords nk
  JOIN keywords k ON k.id = nk.keyword_id
  JOIN node_categories nc ON nc.node_id = nk.node_id
  JOIN categories c ON c.id = nc.category_id
  WHERE c.name = ? COLLATE NOCASE
  GROUP BY k.id HAVING count >= 2
  ORDER BY count DESC, k.term LIMIT ?
`)

const latestTitlesIn = db.prepare(`
  SELECT n.title FROM nodes n
  JOIN node_categories nc ON nc.node_id = n.id
  JOIN categories c ON c.id = nc.category_id
  WHERE c.name = ? COLLATE NOCASE
  ORDER BY n.timestamp DESC LIMIT ?
`)

/**
 * GET /api/overview?category=Career
 * { total, entities: { person: [{term, count}], ... },
 *   categories: [{ name, count, keywords: [{term, count}], latest: [title] }] }
 */
router.get('/overview', (req, res) => {
  try {
    const focus = req.query.category || null
    const keywordLimit = focus ? KEYWORDS_FOCUSED : KEYWORDS_PER_CATEGORY
    const titleLimit = focus ? TITLES_FOCUSED : TITLES_PER_CATEGORY

    const categories = categoryCounts.all()
      .filter(c => !focus || c.name.toLowerCase() === String(focus).toLowerCase())
      .map(c => ({
        ...c,
        keywords: topKeywordsIn.all(c.name, keywordLimit),
        latest: latestTitlesIn.all(c.name, titleLimit).map(r => r.title)
      }))

    const entities = {}
    if (!focus) {
      for (const kind of ENTITY_KINDS) {
        const rows = entitiesOfKind.all(kind, ENTITIES_PER_KIND)
        if (rows.length) entities[kind] = rows
      }
    }

    res.json({ total: countAll.get().n, entities, categories })
  } catch (error) {
    console.error('Error building overview:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
