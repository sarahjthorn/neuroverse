import { db } from './db.js'
import { cosineSimilarity } from './openai.js'

// Below this raw embedding similarity, category/keyword signals never get a
// chance to contribute at all - they can only nudge a relationship the
// embeddings already suggest, never manufacture one from nothing.
// See docs/ARCHITECTURE.md.
const MIN_EMBEDDING_FLOOR = 0.35

// Max composite score contribution from keyword overlap (a 0-1 Jaccard
// fraction, scaled down).
//
// Calibrated against this app's real data, not guessed: "Loves building web
// apps" <-> "Interest in Web Development" - the exact pair that kicked off
// this whole project ("why aren't these linked?") - scores 0.526 on
// embedding similarity alone, 0.14 keyword Jaccard, and shares a category.
// The first-pass weights (0.15 keyword / 0.05 shared-category) landed the
// composite at 0.597, just under the 0.6 edge threshold - the flagship
// motivating example would still have been missed. Nudged up so it clears.
const KEYWORD_BOOST_WEIGHT = 0.18

// Category contribution is capped in total, split between an exact shared
// category (stronger signal) and category_adjacency hits (weaker - two
// categories that are merely "related", not the same).
//
// Recalibrated 2026-09-17 at your request ("same category should be grounds
// for a link") - deliberately a *strong nudge*, not a guarantee: a shared
// category alone still can't manufacture an edge out of nothing (MIN_EMBEDDING_FLOOR
// above still gates it, and even at the cap a pair needs >=0.35 embedding
// similarity to clear the 0.6 edge threshold on category boost alone). What
// changes is that a pair which is already *plausibly* related (~0.4-0.5
// embedding similarity - same topic, different phrasing) now reliably clears
// the threshold once they share a category, instead of needing keyword
// overlap too. Old values (0.06 / 0.12 cap) were tuned only to rescue one
// specific flagship pair; these are tuned to make category matter on its own.
const CATEGORY_BOOST_CAP = 0.25
const SHARED_CATEGORY_BOOST = 0.15

const getCategoryIdsForNode = db.prepare(`SELECT category_id FROM node_categories WHERE node_id = ?`)
const getKeywordIdsForNode = db.prepare(`SELECT keyword_id FROM node_keywords WHERE node_id = ?`)
const getAdjacencyBoost = db.prepare(`
  SELECT boost FROM category_adjacency
  WHERE (category_a = ? AND category_b = ?) OR (category_a = ? AND category_b = ?)
`)

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0
  let shared = 0
  for (const id of setA) {
    if (setB.has(id)) shared++
  }
  const unionSize = setA.size + setB.size - shared
  return unionSize > 0 ? shared / unionSize : 0
}

function categoryBoostFor(nodeAId, nodeBId) {
  const categoriesA = getCategoryIdsForNode.all(nodeAId).map(r => r.category_id)
  const categoriesB = getCategoryIdsForNode.all(nodeBId).map(r => r.category_id)
  const setB = new Set(categoriesB)

  let sharedCount = 0
  let adjacencyBoostSum = 0
  for (const catA of categoriesA) {
    if (setB.has(catA)) {
      sharedCount++
      continue
    }
    for (const catB of categoriesB) {
      const row = getAdjacencyBoost.get(catA, catB, catB, catA)
      if (row) adjacencyBoostSum += row.boost
    }
  }

  return Math.min(CATEGORY_BOOST_CAP, sharedCount * SHARED_CATEGORY_BOOST + adjacencyBoostSum)
}

/**
 * Composite relatedness score for a pair of nodes. embeddingA/embeddingB are
 * passed in (rather than looked up) since callers already have them on hand
 * from the vec0 candidate search - avoids a redundant row fetch per pair.
 */
export function computeCompositeScore(nodeAId, nodeBId, embeddingA, embeddingB) {
  const embeddingSimilarity = cosineSimilarity(embeddingA, embeddingB)

  if (embeddingSimilarity < MIN_EMBEDDING_FLOOR) {
    return {
      embeddingSimilarity, keywordOverlap: 0, categoryBoost: 0, strength: embeddingSimilarity
    }
  }

  const keywordsA = new Set(getKeywordIdsForNode.all(nodeAId).map(r => r.keyword_id))
  const keywordsB = new Set(getKeywordIdsForNode.all(nodeBId).map(r => r.keyword_id))
  const keywordOverlap = jaccard(keywordsA, keywordsB)

  const categoryBoost = categoryBoostFor(nodeAId, nodeBId)

  const strength = Math.min(1, embeddingSimilarity + keywordOverlap * KEYWORD_BOOST_WEIGHT + categoryBoost)

  return { embeddingSimilarity, keywordOverlap, categoryBoost, strength }
}
