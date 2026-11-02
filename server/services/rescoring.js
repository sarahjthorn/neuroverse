import { db } from './db.js'
import { computeCompositeScore } from './scoring.js'
import { findNearestNodes } from './storage.js'

const CANDIDATE_POOL = 30
const EDGE_THRESHOLD = 0.6

const findExistingEdge = db.prepare(`
  SELECT id, type FROM edges WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)
`)
const updateEdge = db.prepare(`
  UPDATE edges
  SET strength = ?, type = ?, embedding_similarity = ?, keyword_overlap = ?, category_boost = ?
  WHERE id = ?
`)
const insertEdge = db.prepare(`
  INSERT INTO edges (id, source, target, strength, type, embedding_similarity, keyword_overlap, category_boost)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const getEmbedding = db.prepare('SELECT embedding FROM nodes WHERE id = ?')

/**
 * Re-runs the composite score (server/services/scoring.js) across the
 * existing graph (docs/ARCHITECTURE.md). Pure local
 * computation: no embedding or extraction API calls, reuses what's already
 * stored. Candidate pairs come from each node's vec0 nearest-neighbors
 * (same mechanism used when a new node is added), not a full O(n^2) scan,
 * so this stays cheap as the graph grows.
 *
 * Creates any newly-qualifying edges and refreshes the score breakdown on
 * already-existing ones (most pre-Phase-2 edges have NULL breakdown columns
 * until this runs). Never deletes an edge, even one that would now score
 * below threshold - pruning existing relationships is a separate,
 * more consequential decision than refreshing or adding them, and isn't
 * part of this pass. On-demand only; nothing calls this automatically.
 */
export function recalculateRelationships({ threshold = EDGE_THRESHOLD } = {}) {
  const nodes = db.prepare('SELECT id, embedding FROM nodes').all()
  const processedPairs = new Set()

  let created = 0
  let updated = 0
  let skipped = 0

  const tx = db.transaction(() => {
    for (const node of nodes) {
      const embeddingA = JSON.parse(node.embedding)
      const candidateIds = findNearestNodes(embeddingA, {
        excludeId: node.id,
        candidatePool: CANDIDATE_POOL
      })

      for (const candidateId of candidateIds) {
        const pairKey = [node.id, candidateId].sort().join('|')
        if (processedPairs.has(pairKey)) continue
        processedPairs.add(pairKey)

        const candidateRow = getEmbedding.get(candidateId)
        if (!candidateRow) continue

        const score = computeCompositeScore(
          node.id,
          candidateId,
          embeddingA,
          JSON.parse(candidateRow.embedding)
        )

        const type = score.strength > 0.8 ? 'strong' : 'moderate'

        const existing = findExistingEdge.get(node.id, candidateId, candidateId, node.id)
        if (existing?.type === 'manual') {
          // A manual edge (First Light links its answers to your identity
          // star - server/routes/intro.js) is kept as is, never re-scored.
          skipped++
        } else if (existing) {
          updateEdge.run(
            score.strength, type,
            score.embeddingSimilarity, score.keywordOverlap, score.categoryBoost,
            existing.id
          )
          updated++
        } else if (score.strength > threshold) {
          insertEdge.run(
            `e${node.id}-${candidateId}`, node.id, candidateId,
            score.strength, type,
            score.embeddingSimilarity, score.keywordOverlap, score.categoryBoost
          )
          created++
        } else {
          skipped++
        }
      }
    }
  })
  tx()

  return { nodesScanned: nodes.length, pairsScored: processedPairs.size, created, updated, skipped }
}
