// The free checks on memories Claude writes itself (server/services/memoryReview.js).
// The meaning comparison needs an embedding, so here only the split finder
// and the no-API notes are tested; scripts/calibrate-split-check.js scores
// the real thing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Importing the service opens the database, so point it at a throwaway one
// with no API keys first.
const dataDir = mkdtempSync(join(tmpdir(), 'brain-review-'))
process.env.BRAIN_DATA_DIR = dataDir
process.env.BRAIN_ENV_FILE = join(dataDir, 'no.env')
process.env.OPENAI_API_KEY = ''
process.env.ANTHROPIC_API_KEY = ''
const { candidateParts, reviewMemory } = await import('../server/services/memoryReview.js')
test.after(() => rmSync(dataDir, { recursive: true, force: true }))

test('finds the places a sentence joins two clauses', () => {
  assert.deepEqual(
    candidateParts('Started a new job as a PM at Acme, and has been learning Rust on weekends.'),
    ['Started a new job as a PM at Acme', 'has been learning Rust on weekends.']
  )
  assert.deepEqual(
    candidateParts('Is training for a half marathon; prefers terse answers from Claude.'),
    ['Is training for a half marathon', 'prefers terse answers from Claude.']
  )
  assert.equal(candidateParts('Runs an Etsy shop selling planners. Is allergic to cats.').length, 2)
})

test('leaves lists, quotes, reasons and short tails alone', () => {
  assert.deepEqual(candidateParts('Traveled to Spain, Portugal, and Morocco with Sam and Alex in 2024.'), [])
  assert.deepEqual(candidateParts('Dislikes the "You do X - is it A or B?" question template.'), [])
  assert.deepEqual(candidateParts('Is learning Rust because she wants to build a CLI tool.'), [])
  assert.deepEqual(candidateParts('Likes running, and swims.'), [])
})

test('notes that need no API call', async () => {
  const long = await reviewMemory({
    title: 'Long one',
    content: Array(40).fill('word').join(' '),
    keywords: []
  }, { categoriesDropped: ['Hobbies'] })
  assert.equal(long.notes.length, 3)
  assert.match(long.notes.join(' '), /long \(40 words\)/)
  assert.match(long.notes.join(' '), /unknown categories ignored: Hobbies/)
  assert.match(long.notes.join(' '), /no keywords/)

  const fine = await reviewMemory({ title: 'Fine', content: 'Learning Rust on weekends.', keywords: ['Rust'] })
  assert.deepEqual(fine.notes, [])
})
