import { db } from './db.js'
import { resolveCategoryId, findOrCreateKeyword } from './taxonomy.js'

const getCategoriesForNode = db.prepare(`
  SELECT c.name FROM categories c
  JOIN node_categories nc ON nc.category_id = c.id
  WHERE nc.node_id = ?
  ORDER BY c.name
`)

const getKeywordsForNode = db.prepare(`
  SELECT k.term FROM keywords k
  JOIN node_keywords nk ON nk.keyword_id = k.id
  WHERE nk.node_id = ?
  ORDER BY k.term
`)

function rowToNode(row) {
  const categories = getCategoriesForNode.all(row.id).map(r => r.name)
  const keywords = getKeywordsForNode.all(row.id).map(r => r.term)

  return {
    id: row.id,
    data: {
      title: row.title,
      content: row.content,
      // Singular field some views still read - always the first category.
      category: categories[0],
      categories,
      keywords,
      thread: row.thread,
      timestamp: row.timestamp
    }
  }
}

function rowToEdge(row) {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    data: {
      strength: row.strength,
      type: row.type,
      // Null for edges created before Phase 2 (composite scoring) - only
      // populated going forward, and after Phase 3's re-scoring pass runs.
      embeddingSimilarity: row.embedding_similarity,
      keywordOverlap: row.keyword_overlap,
      categoryBoost: row.category_boost
    }
  }
}

/**
 * Load the entire graph. Embeddings are intentionally left out - the
 * frontend never uses them, and they're the majority of the payload size.
 * Use getRawNode() for the embedding when a server-side caller needs it.
 */
export function loadGraph() {
  const nodes = db.prepare('SELECT * FROM nodes').all().map(rowToNode)
  const edges = db.prepare('SELECT * FROM edges').all().map(rowToEdge)
  return { nodes, edges }
}

/**
 * Insert new nodes/edges. Existing ids/edge-pairs are silently skipped
 * (matches the old JSON-file's dedupe behavior).
 *
 * Each node's `data.categoryIds` / `data.keywordIds` must already be
 * resolved (see server/services/taxonomy.js) before calling this - category
 * approval and keyword fuzzy-matching both need to happen outside the
 * synchronous DB transaction here.
 */
export function addToGraph(newNodes, newEdges) {
  const insertNode = db.prepare(`
    INSERT OR IGNORE INTO nodes (id, title, content, keywords, thread, timestamp, embedding)
    VALUES (@id, @title, @content, @keywords, @thread, @timestamp, @embedding)
  `)
  const insertEmbedding = db.prepare(`INSERT OR IGNORE INTO node_embeddings (id, embedding) VALUES (?, ?)`)
  const insertNodeCategory = db.prepare(`INSERT OR IGNORE INTO node_categories (node_id, category_id) VALUES (?, ?)`)
  const insertNodeKeyword = db.prepare(`INSERT OR IGNORE INTO node_keywords (node_id, keyword_id) VALUES (?, ?)`)
  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO edges (id, source, target, strength, type, embedding_similarity, keyword_overlap, category_boost)
    VALUES (@id, @source, @target, @strength, @type, @embeddingSimilarity, @keywordOverlap, @categoryBoost)
  `)
  const findReverseEdge = db.prepare(`
    SELECT 1 FROM edges WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)
  `)

  const tx = db.transaction((nodes, edges) => {
    for (const n of nodes) {
      const embeddingJson = JSON.stringify(n.data.embedding || [])
      const keywordTerms = n.data.keywords || []

      insertNode.run({
        id: n.id,
        title: n.data.title,
        content: n.data.content,
        // A JSON copy of the keyword terms, for the full-text search index
        // (node_fts in db.js); the node_keywords links below are the real ones.
        keywords: JSON.stringify(keywordTerms),
        thread: n.data.thread || 'General',
        timestamp: n.data.timestamp || new Date().toISOString(),
        embedding: embeddingJson
      })
      if (n.data.embedding) {
        insertEmbedding.run(n.id, embeddingJson)
      }

      for (const categoryId of n.data.categoryIds || []) {
        insertNodeCategory.run(n.id, categoryId)
      }
      for (const keywordId of n.data.keywordIds || []) {
        insertNodeKeyword.run(n.id, keywordId)
      }
    }

    for (const e of edges) {
      const dupe = findReverseEdge.get(e.source, e.target, e.target, e.source)
      if (dupe) continue
      insertEdge.run({
        id: e.id,
        source: e.source,
        target: e.target,
        strength: e.data.strength,
        type: e.data.type,
        embeddingSimilarity: e.data.embeddingSimilarity ?? null,
        keywordOverlap: e.data.keywordOverlap ?? null,
        categoryBoost: e.data.categoryBoost ?? null
      })
    }
  })
  tx(newNodes, newEdges)

  return loadGraph()
}

/**
 * Partially update a node. Only fields present in updates.data are changed.
 * `categories` (names) must be on the fixed list - unknown names throw.
 * `keywords` (terms) go through the same fuzzy-match-or-create pipeline as
 * extraction, which is why this is async now.
 */
export async function updateNode(nodeId, updates) {
  const existing = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId)
  if (!existing) {
    throw new Error('Node not found')
  }

  const data = updates.data || {}
  const merged = {
    id: nodeId,
    title: data.title ?? existing.title,
    content: data.content ?? existing.content,
    keywords: existing.keywords,
    thread: data.thread ?? existing.thread
  }

  let categoryIds = null
  if (data.categories) {
    categoryIds = data.categories.map(name => {
      const id = resolveCategoryId(name)
      if (!id) throw new Error(`Unknown category "${name}"`)
      return id
    })
  }

  let resolvedKeywords = null
  if (data.keywords) {
    resolvedKeywords = []
    for (const term of data.keywords) {
      const keyword = await findOrCreateKeyword(term)
      if (keyword) resolvedKeywords.push(keyword)
    }
    merged.keywords = JSON.stringify(resolvedKeywords.map(k => k.term))
  }

  db.prepare(`
    UPDATE nodes SET title=@title, content=@content, keywords=@keywords, thread=@thread
    WHERE id = @id
  `).run(merged)

  if (categoryIds) {
    db.prepare(`DELETE FROM node_categories WHERE node_id = ?`).run(nodeId)
    const insertNodeCategory = db.prepare(`INSERT OR IGNORE INTO node_categories (node_id, category_id) VALUES (?, ?)`)
    categoryIds.forEach(id => insertNodeCategory.run(nodeId, id))
  }

  if (resolvedKeywords) {
    db.prepare(`DELETE FROM node_keywords WHERE node_id = ?`).run(nodeId)
    const insertNodeKeyword = db.prepare(`INSERT OR IGNORE INTO node_keywords (node_id, keyword_id) VALUES (?, ?)`)
    resolvedKeywords.forEach(kw => insertNodeKeyword.run(nodeId, kw.id))
  }

  return getNode(nodeId)
}

/**
 * Delete a node. Edges, node_categories, and node_keywords all cascade via
 * FK; the vec0 index row is cleaned up manually since virtual tables can't
 * hold real foreign keys.
 */
export function deleteNode(nodeId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId)
    db.prepare('DELETE FROM node_embeddings WHERE id = ?').run(nodeId)
  })
  tx()
  return loadGraph()
}

/**
 * Get a single node in frontend shape (no embedding).
 */
export function getNode(nodeId) {
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId)
  return row ? rowToNode(row) : undefined
}

/**
 * Get a node's full row, including its embedding - for server-side use only
 * (search, relationship detection). Never expose this over the API as-is.
 */
export function getRawNode(nodeId) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId)
}

/**
 * Find nodes whose embedding is nearest to the given embedding, using the
 * vec0 index for fast candidate retrieval and exact cosine similarity
 * (computed in JS, via cosineSimilarity) to score/filter/rank them.
 */
export function findNearestNodes(embedding, { excludeId, candidatePool = 30 } = {}) {
  const rows = db.prepare(`
    SELECT id FROM node_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?
  `).all(JSON.stringify(embedding), candidatePool)

  return rows
    .map(r => r.id)
    .filter(id => id !== excludeId)
}

const getAliasTargets = db.prepare(`
  SELECT a.alias, k.term FROM keyword_aliases a JOIN keywords k ON k.id = a.keyword_id
`)
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Words too common to be worth matching on - without this, "what do I think
// about X" would rank every memory containing "think" alongside X.
const STOPWORDS = new Set(`a about after all also am an and any are as at be been before but by can could
  did do does for from had has have he her his how i if in into is it its just like me more most my no
  not of on or our out she so some than that the their them then there these they this to up us was we
  were what when where which who why will with would you your`.split(/\s+/))

/**
 * BM25 keyword search over title, content and keywords (the `node_fts`
 * index). Returns node ids, best match first. The query is reduced to plain
 * words OR'd together, so FTS5 query syntax in user input can't throw.
 */
export function keywordSearchNodes(query, { limit = 20 } = {}) {
  // An old name for a keyword ("AI Brain") also searches for its current
  // one ("Neuroverse"), since merged memories only carry the new term.
  const lower = query.toLowerCase()
  const expanded = [lower, ...getAliasTargets.all()
    .filter(a => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(a.alias.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(lower))
    .map(a => a.term.toLowerCase())].join(' ')
  const terms = (expanded.match(/[\p{L}\p{N}]+/gu) || [])
    .filter(t => !STOPWORDS.has(t))
  if (terms.length === 0) return []

  const match = [...new Set(terms)].map(t => `"${t}"`).join(' OR ')
  // bm25() weights: a hit in the title or keywords counts more than one in
  // the body. Lower bm25 is better, hence ORDER BY ascending.
  return db.prepare(`
    SELECT id FROM node_fts
    WHERE node_fts MATCH ?
    ORDER BY bm25(node_fts, 0, 3.0, 1.0, 2.0)
    LIMIT ?
  `).all(match, limit).map(r => r.id)
}
