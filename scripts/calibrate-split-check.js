// Picks SPLIT_SIMILARITY in server/services/memoryReview.js: scores every
// stored memory that has a place it could split, plus hand-made examples
// with a known answer, and prints how each threshold would do. Read-only;
// costs one embedding call per 100 memories (well under $0.001 in total).
//   node scripts/calibrate-split-check.js
import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { candidateParts } from '../server/services/memoryReview.js'
import { generateEmbeddings, cosineSimilarity } from '../server/services/openai.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const db = new Database(join(process.env.BRAIN_DATA_DIR || join(root, 'data'), 'brain.db'), { readonly: true })

// [content, is it two ideas?]
const LABELLED = [
  ['Started a new job as a PM at Acme, and has been learning Rust on weekends.', true],
  ['Is training for a half marathon in March; prefers terse answers from Claude.', true],
  ['Lives in London - enjoys baking sourdough at the weekend.', true],
  ['Prefers Postgres over Mongo for this project, and is planning a trip to Japan in October.', true],
  ['Runs an Etsy shop selling digital planners. Is allergic to cats.', true],
  ['Works at a bank as a data engineer, while saving for a house deposit.', true],
  ['Is learning Rust on weekends, and wants to build a CLI tool with it.', false],
  ['Runs with a club on Wednesdays - usually a 10k route along the river.', false],
  ['The AI Brain project uses SQLite; its vector search runs on sqlite-vec.', false],
  ['Prefers Garmin watches over Apple Watch, but finds Garmin apps clunky.', false],
  ['Neuroverse shows memories as stars. Linked memories drift closer together.', false],
  ['Wants a fitness watch for marathon training, and is comparing Garmin models.', false]
]

async function score(contents) {
  const scored = []
  const withParts = contents.map(c => ({ ...c, parts: candidateParts(c.content) })).filter(c => c.parts.length)
  for (let i = 0; i < withParts.length; i += 100) {
    const chunk = withParts.slice(i, i + 100)
    const vectors = await generateEmbeddings(chunk.flatMap(c => c.parts))
    let at = 0
    for (const c of chunk) {
      const v = vectors.slice(at, at + c.parts.length)
      at += c.parts.length
      let lowest = 1
      for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++) lowest = Math.min(lowest, cosineSimilarity(v[a], v[b]))
      scored.push({ ...c, lowest })
    }
  }
  return scored
}

const real = db.prepare(`SELECT content FROM nodes`).all()
const realScored = await score(real)
const labelled = await score(LABELLED.map(([content, twoIdeas]) => ({ content, twoIdeas })))

console.log(`${real.length} memories, ${realScored.length} have a possible split point\n`)
console.log('Labelled examples:')
for (const l of labelled) console.log(`  ${l.lowest.toFixed(3)}  ${l.twoIdeas ? 'TWO' : 'one'}  ${l.content}`)
console.log(`  (${LABELLED.length - labelled.length} labelled examples had no split point)\n`)

console.log('threshold  flagged-real  labelled: caught/missed two-idea, false alarms')
for (const t of [0.2, 0.25, 0.3, 0.35, 0.4, 0.45]) {
  const flagged = realScored.filter(s => s.lowest < t).length
  const caught = labelled.filter(l => l.twoIdeas && l.lowest < t).length
  const missed = labelled.filter(l => l.twoIdeas && l.lowest >= t).length
  const falseAlarm = labelled.filter(l => !l.twoIdeas && l.lowest < t).length
  console.log(`  ${t.toFixed(2)}      ${String(flagged).padStart(3)}           ${caught}/${missed}, ${falseAlarm}`)
}

console.log('\nLowest-scoring real memories:')
for (const s of realScored.sort((a, b) => a.lowest - b.lowest).slice(0, 25)) {
  console.log(`  ${s.lowest.toFixed(3)}  ${s.content}`)
}
