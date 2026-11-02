// Free checks on memories Claude wrote itself (MCP store_memory /
// store_memories), which are stored as written - no extraction model
// re-reads them any more (COST.md #1). Nothing here changes a memory; it
// returns notes the MCP reply passes back so the saving Claude can fix
// its own work. See docs/MEMORY_PIPELINE.md.
import { generateEmbeddings, cosineSimilarity } from './openai.js'

// Where one sentence most often joins two ideas: a new sentence, a
// semicolon, a spaced dash, or a comma followed by a joining word.
// "because" / "so" / "to" are left alone - a reason belongs with its fact.
const BREAKS = /(?<=[.!?])\s+(?=[A-Z])|;\s+|\s+[-–—]\s+/
const COMMA_JOIN = /,\s+(?=(?:and|but|while|plus|also|whereas)\b)/
const JOIN_WORD = /^(?:and|but|while|plus|also|whereas)\s+/i

// ", and" that ends a list ("Spain, Portugal, and Morocco") isn't a join:
// only cut there when the clause before it has no other comma.
function splitCommaJoins(clause) {
  const pieces = clause.split(COMMA_JOIN)
  const out = [pieces[0]]
  for (const piece of pieces.slice(1)) {
    if (out[out.length - 1].includes(',')) out[out.length - 1] += `, ${piece}`
    else out.push(piece)
  }
  return out
}

const MIN_PART_WORDS = 4
const LONG_WORDS = 35

// Parts of one idea read alike; two ideas don't. Picked from Sarah's 526
// memories plus hand-made two-idea examples (scripts/calibrate-split-check.js,
// 2026-10-07) - see the numbers in docs/MEMORY_PIPELINE.md.
export const SPLIT_SIMILARITY = 0.22

const words = text => text.trim().split(/\s+/).filter(Boolean).length

/** The pieces a memory's sentence could be cut into, or [] if none. */
export function candidateParts(content) {
  // Quoted text is never cut ("You do X - is it A or B?").
  const quotes = []
  const masked = content.replace(/"[^"]*"|“[^”]*”/g, q => `\u0000${quotes.push(q) - 1}\u0000`)
  const unmask = p => p.replace(/\u0000(\d+)\u0000/g, (_, i) => quotes[i])
  const parts = masked
    .split(BREAKS)
    .flatMap(splitCommaJoins)
    .map(p => unmask(p.replace(JOIN_WORD, '')).trim())
    .filter(p => words(p) >= MIN_PART_WORDS)
  return parts.length >= 2 ? parts : []
}

/**
 * Notes on one memory: { title, notes: [string], parts? }. One embedding
 * call (≈ $0.0000002) only when the sentence has a place it could split.
 * Embedding trouble never blocks a save - the check is just skipped.
 */
export async function reviewMemory(memory, { categoriesDropped = [] } = {}) {
  const notes = []
  let parts

  const candidates = candidateParts(memory.content)
  if (candidates.length) {
    try {
      const vectors = await generateEmbeddings(candidates)
      let lowest = 1
      for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
          lowest = Math.min(lowest, cosineSimilarity(vectors[i], vectors[j]))
        }
      }
      if (lowest < SPLIT_SIMILARITY) {
        parts = candidates
        notes.push(`looks like ${candidates.length} separate ideas (${candidates.map(p => `"${p}"`).join(' / ')}) - consider update_memory to keep one and store_memory for the rest`)
      }
    } catch (error) {
      console.warn('Split check skipped:', error.message)
    }
  }

  if (!parts && words(memory.content) > LONG_WORDS) {
    notes.push(`long (${words(memory.content)} words) - memories should be one sentence, ideally under 25 words`)
  }
  if (categoriesDropped.length) {
    notes.push(`unknown categories ignored: ${categoriesDropped.join(', ')}`)
  }
  if (!memory.keywords?.length) {
    notes.push('no keywords - it will only link by meaning')
  }
  return { title: memory.title, notes, ...(parts && { parts }) }
}
