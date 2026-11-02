import { db, CANONICAL_CATEGORIES } from './db.js'
import { generateEmbedding, cosineSimilarity } from './openai.js'

// Empirically calibrated against this app's own data (text-embedding-3-small),
// not guessed: real near-duplicates score 0.75-0.86 ("React"/"React.js" =
// 0.75, "full-stack"/"full-stack apps" = 0.78, "task management"/"task
// management app" = 0.86), while genuinely different terms land at 0.67 and
// below ("web development"/"software development" = 0.67, "TypeScript"/
// "JavaScript" = 0.56). 0.72 sits in the gap between those two clusters.
const KEYWORD_MATCH_THRESHOLD = 0.72

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * The categories memories can be tagged with (seeded from CANONICAL_CATEGORIES).
 */
export function getCategories() {
  return db.prepare(`SELECT id, name FROM categories ORDER BY name`).all()
}

/**
 * Look up a category by name (case-insensitive). Never creates one -
 * extraction only ever matches against the fixed list.
 */
export function resolveCategoryId(name) {
  const row = db.prepare(`SELECT id FROM categories WHERE name = ? COLLATE NOCASE`).get(name)
  return row?.id ?? null
}

/**
 * Find a canonical keyword for `term`, or mint a new one. Exact match
 * (case-insensitive) short-circuits before any embedding call. Otherwise
 * embeds the term and fuzzy-matches against existing keyword embeddings -
 * a plain linear scan, which is fine at the keyword-dictionary sizes this
 * app will realistically have (dozens to low hundreds, not millions).
 */
export async function findOrCreateKeyword(term) {
  const normalized = (term || '').trim()
  if (!normalized) return null

  const aliased = db.prepare(`
    SELECT k.* FROM keyword_aliases a JOIN keywords k ON k.id = a.keyword_id WHERE a.alias = ?
  `).get(normalized)
  if (aliased) return aliased

  const exact = db.prepare(`SELECT * FROM keywords WHERE term = ? COLLATE NOCASE`).get(normalized)
  if (exact) return exact

  const embedding = await generateEmbedding(normalized)

  const candidates = db.prepare(`SELECT * FROM keywords`).all()
  let best = null
  let bestScore = 0
  for (const candidate of candidates) {
    const candidateEmbedding = JSON.parse(candidate.embedding)
    if (candidateEmbedding.length === 0) continue // migrated placeholder, not backfilled yet
    const score = cosineSimilarity(embedding, candidateEmbedding)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  if (best && bestScore >= KEYWORD_MATCH_THRESHOLD) return best

  const id = generateId('kw')
  db.prepare(`INSERT INTO keywords (id, term, embedding, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, normalized, JSON.stringify(embedding), new Date().toISOString())
  return { id, term: normalized, embedding: JSON.stringify(embedding) }
}

// What a keyword can name when it's an entity rather than a plain concept.
// "project" is something Sarah herself builds or runs (Neuroverse,
// my-print-shop); a company, employer, university or platform is an
// organisation (Acme Bank, Leeds University, Etsy). Tools, languages and books are
// plain concepts.
export const ENTITY_KINDS = ['person', 'place', 'organisation', 'project']

/**
 * Set a keyword's entity kind (null = plain concept). `source` is 'model'
 * for extraction or 'sarah' for a manual correction; the model never
 * overwrites a kind Sarah has set.
 */
export function setKeywordKind(keywordId, kind, source) {
  if (kind !== null && !ENTITY_KINDS.includes(kind)) {
    throw new Error(`Unknown entity kind "${kind}"`)
  }
  const sql = source === 'sarah'
    ? `UPDATE keywords SET kind = ?, kind_source = 'sarah' WHERE id = ?`
    : `UPDATE keywords SET kind = ?, kind_source = 'model' WHERE id = ? AND (kind_source IS NULL OR kind_source = 'model')`
  db.prepare(sql).run(kind, keywordId)
}

/**
 * One-time-per-keyword backfill: the migration in db.js seeds pre-existing
 * keywords with an empty '[]' embedding placeholder (to avoid API calls
 * during a plain server boot). This fills them in for real so they can
 * participate in fuzzy matching. Safe to call on every server start - it's
 * a no-op once every keyword has a real embedding.
 */
export async function backfillKeywordEmbeddings() {
  const unembedded = db.prepare(`SELECT id, term FROM keywords WHERE embedding = '[]'`).all()
  if (unembedded.length === 0) return { backfilled: 0 }

  console.log(`🔤 Backfilling embeddings for ${unembedded.length} migrated keyword(s)...`)
  const update = db.prepare(`UPDATE keywords SET embedding = ? WHERE id = ?`)

  for (const kw of unembedded) {
    const embedding = await generateEmbedding(kw.term)
    update.run(JSON.stringify(embedding), kw.id)
  }

  console.log(`✅ Backfilled ${unembedded.length} keyword embedding(s)`)
  return { backfilled: unembedded.length }
}

export { CANONICAL_CATEGORIES }
