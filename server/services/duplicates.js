import { createHash } from 'crypto'
import { db } from './db.js'
import { judgeDuplicatePairs } from './anthropic.js'

// Near-duplicate detection reads the RAW embedding similarity stored on each
// edge, not the edge's composite `strength`. The composite adds up to +0.25
// for a shared category and +0.18 for keyword overlap (then caps at 1.0) -
// right for "are these related?", wrong for "are these the same?": with
// nearly every memory tagged Research + Interests, any same-topic pair
// saturated at 1.0 and got flagged (2026-09-30: 7 of 8 suggestions were
// siblings or general-vs-specific pairs, raw similarity only 0.70-0.80).
// 0.85 is deliberately strict - it only auto-flags near-verbatim repeats.
// Subtler duplicates ("Shor's algorithm interest" vs "Quantum encryption
// threat", raw 0.69) are left to the on-demand Claude check below.
const DUPLICATE_THRESHOLD = 0.85

// How many of the most-similar unreviewed pairs one "Check with Claude"
// click sends, and the raw similarity a pair needs to be worth asking about
// at all. Keeps each click to a single small request - see COST.md.
const CLAUDE_CHECK_BATCH = 10
const CLAUDE_CHECK_FLOOR = 0.6

// Bump whenever the judging prompt in judgeDuplicatePairs() changes meaning:
// it's part of each verdict's signature, so old verdicts go stale and those
// pairs get re-judged on the next click. v2 (2026-09-30): named specifics
// (algorithms, tools, people...) are never duplicates of a general memory.
const JUDGE_PROMPT_VERSION = 2

// Negation/polarity guard (pinned in the plan doc): embeddings conflate topic
// similarity with sentiment - "loves React" and "hates React" score highly
// similar since they're about the same subject (correct for linking them,
// Phase 2) but wrong for suggesting a merge (this phase). Checked
// asymmetrically: if exactly one side of the pair contains a negation
// marker, block the suggestion outright regardless of score. This is a
// coarse presence check over the whole title+content, not scoped to the
// specific shared concept - deliberately simple per the plan doc, not a full
// NLP treatment. Apostrophe made optional so "don't"/"dont" both match, and
// stems are left open-ended (\w*) so conjugations match too - a plain \b...\b
// word match would miss "hates"/"disliked"/"stopped" entirely (no boundary
// between "hate" and the "s" in "hates").
const NEGATION_MARKERS = [
  'not', "don'?t", 'never', 'dislik\\w*', 'hat\\w*', 'stopp?\\w*', 'unlik\\w*', 'avoid\\w*', 'quit\\w*'
]
const NEGATION_REGEX = new RegExp(`\\b(${NEGATION_MARKERS.join('|')})\\b`, 'i')

function hasNegationMarker(node) {
  return NEGATION_REGEX.test(`${node.title} ${node.content}`)
}

// Claude's verdicts, one row per pair. `signature` hashes both memories'
// text (plus JUDGE_PROMPT_VERSION) at review time, so editing either memory
// or changing the prompt quietly invalidates the old verdict (the pair just
// becomes eligible for the next check). ON DELETE CASCADE
// cleans up after merges/deletes.
db.exec(`
  CREATE TABLE IF NOT EXISTS duplicate_reviews (
    node_a TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    node_b TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL CHECK (verdict IN ('same', 'different')),
    reason TEXT,
    signature TEXT NOT NULL,
    reviewed_at TEXT NOT NULL,
    PRIMARY KEY (node_a, node_b)
  );
`)

const getCandidateEdges = db.prepare(`
  SELECT source, target, embedding_similarity AS similarity FROM edges
  WHERE embedding_similarity >= ? ORDER BY embedding_similarity DESC
`)
const getNodeInfo = db.prepare(`SELECT id, title, content, timestamp FROM nodes WHERE id = ?`)
const getReview = db.prepare(`SELECT verdict, reason, signature FROM duplicate_reviews WHERE node_a = ? AND node_b = ?`)
const upsertReview = db.prepare(`
  INSERT INTO duplicate_reviews (node_a, node_b, verdict, reason, signature, reviewed_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (node_a, node_b) DO UPDATE SET
    verdict = excluded.verdict, reason = excluded.reason,
    signature = excluded.signature, reviewed_at = excluded.reviewed_at
`)

function orderedPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA]
}

function pairSignature(nodeA, nodeB) {
  const [first, second] = nodeA.id < nodeB.id ? [nodeA, nodeB] : [nodeB, nodeA]
  return createHash('sha1')
    .update(`v${JUDGE_PROMPT_VERSION}\n${first.title}\n${first.content}\n${second.title}\n${second.content}`)
    .digest('hex')
}

// A still-valid Claude verdict for this pair, or null if never reviewed or
// either memory has been edited since.
function currentReview(nodeA, nodeB) {
  const review = getReview.get(...orderedPair(nodeA.id, nodeB.id))
  if (!review || review.signature !== pairSignature(nodeA, nodeB)) return null
  return review
}

function toSuggestion(nodeA, nodeB, similarity, source, reason) {
  const [existing, duplicate] = nodeA.timestamp <= nodeB.timestamp ? [nodeA, nodeB] : [nodeB, nodeA]
  return {
    existingId: existing.id,
    existingTitle: existing.title,
    duplicateId: duplicate.id,
    duplicateTitle: duplicate.title,
    duplicateContent: duplicate.content,
    score: similarity,
    source,
    reason: reason || null
  }
}

/**
 * Surfaces near-duplicate suggestions. A pair is suggested when either
 * Claude has judged it the same idea ('claude'), or its raw embedding
 * similarity clears DUPLICATE_THRESHOLD ('similarity') and Claude hasn't
 * judged it different. Pure read, computed fresh on every GET /api/graph.
 * Never merges anything itself - see mergeDuplicate() below.
 */
export function detectDuplicates() {
  const suggestions = []

  for (const edge of getCandidateEdges.all(CLAUDE_CHECK_FLOOR)) {
    const nodeA = getNodeInfo.get(edge.source)
    const nodeB = getNodeInfo.get(edge.target)
    if (!nodeA || !nodeB) continue

    const review = currentReview(nodeA, nodeB)
    if (review?.verdict === 'same') {
      suggestions.push(toSuggestion(nodeA, nodeB, edge.similarity, 'claude', review.reason))
      continue
    }
    if (review?.verdict === 'different') continue

    if (edge.similarity < DUPLICATE_THRESHOLD) continue
    if (hasNegationMarker(nodeA) !== hasNegationMarker(nodeB)) continue
    suggestions.push(toSuggestion(nodeA, nodeB, edge.similarity, 'similarity'))
  }

  return suggestions
}

/**
 * "Check with Claude" - the only paid part of duplicate detection, and only
 * ever run from an explicit button click. Sends the CLAUDE_CHECK_BATCH most
 * similar pairs that don't already have a valid verdict to Claude in ONE
 * request, stores each verdict, and returns counts. Repeated clicks walk
 * further down the list rather than re-asking about the same pairs.
 */
export async function checkDuplicatesWithClaude() {
  const pairs = []
  for (const edge of getCandidateEdges.all(CLAUDE_CHECK_FLOOR)) {
    if (pairs.length >= CLAUDE_CHECK_BATCH) break
    const nodeA = getNodeInfo.get(edge.source)
    const nodeB = getNodeInfo.get(edge.target)
    if (!nodeA || !nodeB || currentReview(nodeA, nodeB)) continue
    pairs.push({ nodeA, nodeB })
  }

  const remaining = () => getCandidateEdges.all(CLAUDE_CHECK_FLOOR).filter(edge => {
    const nodeA = getNodeInfo.get(edge.source)
    const nodeB = getNodeInfo.get(edge.target)
    return nodeA && nodeB && !currentReview(nodeA, nodeB)
  }).length

  if (pairs.length === 0) return { checked: 0, found: 0, remaining: 0, batchSize: CLAUDE_CHECK_BATCH }

  const verdicts = await judgeDuplicatePairs(pairs.map(({ nodeA, nodeB }, index) => ({
    index,
    a: { title: nodeA.title, content: nodeA.content },
    b: { title: nodeB.title, content: nodeB.content }
  })))

  const now = new Date().toISOString()
  let found = 0
  const tx = db.transaction(() => {
    for (const verdict of verdicts) {
      const pair = pairs[verdict.index]
      if (!pair) continue
      const same = verdict.same === true
      if (same) found++
      upsertReview.run(
        ...orderedPair(pair.nodeA.id, pair.nodeB.id),
        same ? 'same' : 'different',
        verdict.reason || null,
        pairSignature(pair.nodeA, pair.nodeB),
        now
      )
    }
  })
  tx()

  return { checked: verdicts.length, found, remaining: remaining(), batchSize: CLAUDE_CHECK_BATCH }
}

const getRawNode = db.prepare(`SELECT * FROM nodes WHERE id = ?`)
const getCategoryIdsForNode = db.prepare(`SELECT category_id FROM node_categories WHERE node_id = ?`)
const getKeywordIdsForNode = db.prepare(`SELECT keyword_id FROM node_keywords WHERE node_id = ?`)
const insertNodeCategory = db.prepare(`INSERT OR IGNORE INTO node_categories (node_id, category_id) VALUES (?, ?)`)
const insertNodeKeyword = db.prepare(`INSERT OR IGNORE INTO node_keywords (node_id, keyword_id) VALUES (?, ?)`)
const getEdgesTouching = db.prepare(`SELECT id, source, target FROM edges WHERE source = ? OR target = ?`)
const findEdgeBetween = db.prepare(`
  SELECT id FROM edges WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)
`)
const repointEdgeSource = db.prepare(`UPDATE edges SET source = ? WHERE id = ?`)
const repointEdgeTarget = db.prepare(`UPDATE edges SET target = ? WHERE id = ?`)
const deleteEdgeRow = db.prepare(`DELETE FROM edges WHERE id = ?`)
const deleteNodeRow = db.prepare(`DELETE FROM nodes WHERE id = ?`)
const deleteEmbeddingRow = db.prepare(`DELETE FROM node_embeddings WHERE id = ?`)

/**
 * Resolves a confirmed duplicate suggestion: the two say the same thing, so
 * the duplicate's content is discarded and only its categories/keywords
 * fold onto the survivor so no tagging is lost. There's deliberately no
 * "append as an update" option (removed 2026-09-30) - memories are one idea
 * in one sentence, so a memory that adds something new should stay its own
 * node (docs/MEMORY_PIPELINE.md). Every edge touching the duplicate is re-pointed
 * onto the survivor (dropping any that would collide with an edge that
 * already exists between the survivor and that node, or would self-loop),
 * then the duplicate node itself is deleted. Requires explicit confirmation
 * from the caller - never invoked automatically.
 */
export function mergeDuplicate(existingId, duplicateId) {
  if (existingId === duplicateId) throw new Error('Cannot merge a node with itself')

  const existing = getRawNode.get(existingId)
  const duplicate = getRawNode.get(duplicateId)
  if (!existing) throw new Error('Existing node not found')
  if (!duplicate) throw new Error('Duplicate node not found')

  const tx = db.transaction(() => {
    for (const row of getCategoryIdsForNode.all(duplicateId)) {
      insertNodeCategory.run(existingId, row.category_id)
    }
    for (const row of getKeywordIdsForNode.all(duplicateId)) {
      insertNodeKeyword.run(existingId, row.keyword_id)
    }

    for (const edge of getEdgesTouching.all(duplicateId, duplicateId)) {
      const otherId = edge.source === duplicateId ? edge.target : edge.source

      if (otherId === existingId || findEdgeBetween.get(existingId, otherId, otherId, existingId)) {
        deleteEdgeRow.run(edge.id)
        continue
      }

      if (edge.source === duplicateId) repointEdgeSource.run(existingId, edge.id)
      else repointEdgeTarget.run(existingId, edge.id)
    }

    deleteNodeRow.run(duplicateId)
    deleteEmbeddingRow.run(duplicateId)
  })
  tx()
}
