import express from 'express'
import { db } from '../services/db.js'
import { setKeywordKind, ENTITY_KINDS } from '../services/taxonomy.js'

const router = express.Router()

const getKeywordByTerm = db.prepare(`SELECT * FROM keywords WHERE term = ? COLLATE NOCASE`)
const getNodeById = db.prepare(`SELECT id, title FROM nodes WHERE id = ?`)
const getAliases = db.prepare(`SELECT alias FROM keyword_aliases WHERE keyword_id = ? ORDER BY alias`)

// Auto-derive fallback (docs/ARCHITECTURE.md): the node
// carrying this keyword with the longest content is treated as its
// "definition" until someone manually sets one. Pure local computation, no
// API calls - consistent with how Phase 3's re-scoring stayed local-only.
const findRichestNodeForKeyword = db.prepare(`
  SELECT n.id, n.title, n.content FROM nodes n
  JOIN node_keywords nk ON nk.node_id = n.id
  WHERE nk.keyword_id = ?
  ORDER BY LENGTH(n.content) DESC
  LIMIT 1
`)

/**
 * GET /api/keywords/:term
 * Returns a keyword's description and defining node - the manually-set
 * value if present, otherwise an auto-derived fallback so hovering/clicking
 * a keyword is never empty.
 */
router.get('/keywords/:term', (req, res) => {
  try {
    const keyword = getKeywordByTerm.get(req.params.term)
    if (!keyword) {
      return res.status(404).json({ error: 'Keyword not found' })
    }

    let description = keyword.description
    let definingNodeId = keyword.defining_node_id
    let autoDerived = false

    if (!description || !definingNodeId) {
      const candidate = findRichestNodeForKeyword.get(keyword.id)
      if (candidate) {
        if (!definingNodeId) definingNodeId = candidate.id
        if (!description) description = candidate.content
        autoDerived = true
      }
    }

    const definingNode = definingNodeId ? getNodeById.get(definingNodeId) : null

    res.json({
      term: keyword.term,
      description: description || null,
      definingNode: definingNode || null,
      autoDerived,
      kind: keyword.kind || null,
      kindSource: keyword.kind_source || null,
      aliases: getAliases.all(keyword.id).map(r => r.alias),
      entityKinds: ENTITY_KINDS
    })
  } catch (error) {
    res.status(500).json({ error: 'Failed to get keyword' })
  }
})

/**
 * PATCH /api/keywords/:term
 * Manually set a keyword's description, defining node and/or entity kind -
 * overrides the auto-derived fallback above. Only touches fields actually present in the
 * request body.
 */
router.patch('/keywords/:term', (req, res) => {
  try {
    const keyword = getKeywordByTerm.get(req.params.term)
    if (!keyword) {
      return res.status(404).json({ error: 'Keyword not found' })
    }

    if ('kind' in req.body && req.body.kind !== null && !ENTITY_KINDS.includes(req.body.kind)) {
      return res.status(400).json({ error: `kind must be one of ${ENTITY_KINDS.join(', ')}, or null` })
    }

    const description = 'description' in req.body ? req.body.description : keyword.description
    const definingNodeId = 'definingNodeId' in req.body ? req.body.definingNodeId : keyword.defining_node_id

    if (definingNodeId && !getNodeById.get(definingNodeId)) {
      return res.status(400).json({ error: 'definingNodeId does not refer to an existing node' })
    }

    db.prepare(`UPDATE keywords SET description = ?, defining_node_id = ? WHERE id = ?`)
      .run(description, definingNodeId, keyword.id)

    // A manual kind (or null for "not an entity") is Sarah's call, so
    // extraction won't change it afterwards.
    if ('kind' in req.body) {
      setKeywordKind(keyword.id, req.body.kind, 'sarah')
    }

    const definingNode = definingNodeId ? getNodeById.get(definingNodeId) : null
    const kind = 'kind' in req.body ? req.body.kind : keyword.kind
    res.json({ term: keyword.term, description, definingNode, autoDerived: false, kind })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update keyword' })
  }
})

export default router
