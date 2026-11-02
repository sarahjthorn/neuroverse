import { db } from './db.js'
import { getCategories } from './taxonomy.js'
import { writeCuriousQuestions } from './anthropic.js'
import { generateEmbedding, generateEmbeddings } from './openai.js'
import { findNearestNodes } from './storage.js'
import { config, userName } from '../config.js'

// "Your brain is curious" (Home and Reflect): the brain asks Sarah
// questions. She picks what about - a category, a keyword or anything she
// types - or "Surprise me", which picks 3 categories for her.
// Picking the memories is free and local (this file); only writing the
// questions calls Claude, and only from a button (COST.md).
//
// Until 2026-10-05 the brain chose its own "gaps" (thin categories,
// bridges between unrelated clusters) and sent ~20 memories. That kept
// circling the same few memories and gluing unrelated topics together, so
// now Sarah sets the theme (or asks to be surprised).

// How many questions one click asks for. Claude writes spares, so
// near-repeats of past questions can be dropped and the batch still has
// QUESTIONS_PER_BATCH.
const QUESTIONS_PER_BATCH = 3
const QUESTION_SPARES = 3
// Memories sent: for a chosen topic, and per category for "Surprise me".
const TOPIC_MEMORIES = 12
const SURPRISE_MEMORIES_PER_CATEGORY = 4
// Free-text topics find their memories by meaning; below this similarity
// they're noise (measured 2026-09-30: unrelated memories scored under 0.33).
const TEXT_TOPIC_MIN_SIMILARITY = 0.3
// Keyword chips offered in the picker: every keyword on at least this many
// memories, most used first, capped (Home shows the first few; Reflect's
// open-questions card shows them all as a cloud).
const KEYWORD_CHIP_MIN = 3
const KEYWORD_CHIP_MAX = 120
// Loose ends: memories this old that sound still in progress ("training
// for", "planning to") get flagged to Claude as worth a follow-up.
const LOOSE_END_AGE_DAYS = 21
// Cleaning: a memory this similar (embedding cosine) to one already picked
// is a near-repeat ("Spain travel photos" / "Portugal travel photos") and
// adds nothing. Memories behind the last few questions are skipped too, so
// the brain doesn't keep circling the same ones.
const NEAR_REPEAT_SIMILARITY = 0.8
const RECENT_SOURCE_QUESTIONS = 9
// Saturated topics: keywords on at least this share of all memories (e.g.
// "Neuroverse"). A category pick takes at most this many memories carrying
// one, so Project isn't all one project - unless that keyword is the topic.
const SATURATED_KEYWORD_SHARE = 0.06
const SATURATED_KEYWORD_MIN = 5
const MAX_SATURATED = { topic: 4, surprise: 1 }
const CONTENT_CHARS = 160
// Past questions sent back so Claude doesn't repeat itself: the latest on
// the same topic, plus a few from anywhere.
const PAST_SAME_TOPIC = 15
const PAST_OTHER = 5
// Skipping or dismissing a question means "not this": the memories behind
// it stay out of the next this-many questions, and its category is picked
// less often by "Surprise me".
const SKIP_COOLDOWN_QUESTIONS = 30
const SKIP_WEIGHT = 3
// "Surprise me" leans away from categories asked about lately.
const SURPRISE_CATEGORIES = 3
const SURPRISE_LOOKBACK = 30
// A new question this similar (embedding cosine) to a past one is a
// rephrase and gets dropped; the bar is lower against skipped/dismissed
// ones. Measured 2026-09-30 on real history: rephrases scored 0.57-0.82,
// unrelated questions mostly under 0.55. If too few survive, the closest
// calls under HARD_REPEAT_SIMILARITY top the batch back up to 3.
const REPEAT_SIMILARITY = 0.7
const SKIPPED_REPEAT_SIMILARITY = 0.6
const HARD_REPEAT_SIMILARITY = 0.8
// "From time to time", one "Surprise me" question is a wildcard: a random,
// playful question not tied to any memory.
const WILDCARD_CHANCE = 0.35

// Short descriptions of each category, so Claude knows what a pick means.
const CATEGORY_HINTS = {
  Health: 'physical health, fitness, exercise, sleep, diet, skincare, injuries, medical',
  Mind: 'mood, stress, confidence, feelings, mental health, beliefs, how they see themselves',
  Relationships: 'family, partner, friends, colleagues, manager, people in their life',
  Personal: 'where they live, background, life events, identity, home',
  Travel: 'trips, countries visited, travel plans, holidays',
  Financial: 'money, saving, budgeting, investing, income, spending',
  Career: 'job, role, employer, career goals, job search',
  Research: 'topics they are researching, curious about, reading up on',
  Interests: 'hobbies, things they enjoy, follows or collects',
  Technical: 'programming, tools, languages, tech stack, skills',
  Project: 'things they are building or making, side projects',
  Preferences: 'likes, dislikes, working style, how they prefer things'
}

// Phrases that mark something as still in progress when it was stored.
const IN_PROGRESS_REGEX = /\b(planning|plans? to|going to|want(s|ed)? to|hoping|hopes? to|interviewing|considering|thinking about|training for|learning|working on|trying to|saving for|about to|looking for|deciding)\b/i

// Kept forever, like digests - answered/skipped/dismissed questions are the
// "already asked" history. Deliberately NOT graph nodes; an answer becomes
// ordinary memories through the normal extraction pipeline instead.
db.exec(`
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    why TEXT NOT NULL,
    gap TEXT NOT NULL,
    source_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'skipped', 'dismissed')),
    answer TEXT,
    answer_node_ids TEXT NOT NULL DEFAULT '[]',
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
`)
const questionColumns = () => db.prepare(`PRAGMA table_info(questions)`).all().map(c => c.name)
// The category a question is about (NULL if none), so "Surprise me" can
// rotate through categories instead of always landing on the same ones.
if (!questionColumns().includes('category')) {
  db.exec(`ALTER TABLE questions ADD COLUMN category TEXT`)
}
// The category pair of an old "Connect two topics" question (retired
// 2026-10-07) - nothing writes it now; kept so past
// questions keep their history.
if (!questionColumns().includes('bridge')) {
  db.exec(`ALTER TABLE questions ADD COLUMN bridge TEXT`)
}
// The question's own embedding, for catching rephrased repeats. Filled in
// lazily (older rows get one the next time questions are generated).
if (!questionColumns().includes('embedding')) {
  db.exec(`ALTER TABLE questions ADD COLUMN embedding TEXT`)
}
// What Sarah asked to be asked about ("category:Health", "keyword:running",
// "text:my running"), or NULL for "Surprise me" and older questions.
if (!questionColumns().includes('topic')) {
  db.exec(`ALTER TABLE questions ADD COLUMN topic TEXT`)
}

const SKIPPED = `status IN ('skipped', 'dismissed')`

const MEMORY_COLUMNS = 'n.id, n.title, n.content, n.timestamp, n.embedding'

function dot(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

// Memories behind recently skipped or dismissed questions - kept out of
// every pick.
function skippedSourceIds() {
  return new Set(db.prepare(`
    SELECT source_ids, status FROM questions ORDER BY created_at DESC LIMIT ?
  `).all(SKIP_COOLDOWN_QUESTIONS)
    .filter(r => r.status === 'skipped' || r.status === 'dismissed')
    .flatMap(r => JSON.parse(r.source_ids)))
}

function toQuestion({ embedding, ...row }) {
  return {
    ...row,
    source_ids: JSON.parse(row.source_ids),
    answer_node_ids: JSON.parse(row.answer_node_ids)
  }
}

export function getOpenQuestions() {
  return db.prepare(`SELECT * FROM questions WHERE status = 'open' ORDER BY created_at`).all().map(toQuestion)
}

// Answered, skipped and dismissed questions, newest first - the Reflect
// page's history.
export function getClosedQuestions(limit = 100) {
  return db.prepare(`SELECT * FROM questions WHERE status != 'open' ORDER BY closed_at DESC LIMIT ?`).all(limit).map(toQuestion)
}

export function getQuestion(id) {
  const row = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(id)
  return row ? toQuestion(row) : null
}

export function closeQuestion(id, status, { answer = null, answerNodeIds = [] } = {}) {
  db.prepare(`
    UPDATE questions SET status = ?, answer = ?, answer_node_ids = ?, closed_at = ?
    WHERE id = ?
  `).run(status, answer, JSON.stringify(answerNodeIds), new Date().toISOString(), id)
}

function memoryCategories(nodeId) {
  return db.prepare(`
    SELECT c.name FROM node_categories nc JOIN categories c ON c.id = nc.category_id
    WHERE nc.node_id = ?
  `).all(nodeId).map(r => r.name)
}

function categoryCounts() {
  const counts = new Map(getCategories().map(c => [c.name, 0]))
  for (const row of db.prepare(`
    SELECT c.name, COUNT(*) AS n FROM node_categories nc JOIN categories c ON c.id = nc.category_id
    GROUP BY c.name
  `).all()) {
    counts.set(row.name, row.n)
  }
  return counts
}

// Keywords on a big share of all memories, most common first.
function saturatedKeywords() {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM nodes`).get().n
  const min = Math.max(SATURATED_KEYWORD_MIN, Math.ceil(total * SATURATED_KEYWORD_SHARE))
  return db.prepare(`
    SELECT k.id, k.term, COUNT(*) AS n FROM node_keywords nk JOIN keywords k ON k.id = nk.keyword_id
    GROUP BY k.id HAVING n >= ? ORDER BY n DESC
  `).all(min)
}

/**
 * Free: what the picker offers - every category with its memory count, and
 * the keywords used on KEYWORD_CHIP_MIN+ memories, most used first (minus
 * the owner's own name, which is on everything about them).
 */
export function getTopics() {
  const owner = userName().toLowerCase()
  return {
    categories: [...categoryCounts()].map(([name, count]) => ({ name, count })),
    keywords: db.prepare(`
      SELECT k.term, COUNT(*) AS count FROM node_keywords nk JOIN keywords k ON k.id = nk.keyword_id
      GROUP BY k.id HAVING count >= ? ORDER BY count DESC, k.term LIMIT ?
    `).all(KEYWORD_CHIP_MIN, KEYWORD_CHIP_MAX + 1)
      .filter(k => k.term.toLowerCase() !== owner)
      .slice(0, KEYWORD_CHIP_MAX)
  }
}

// A topic as the client sends it: { kind: 'category' | 'keyword' | 'text', value }.
function normaliseTopic(topic) {
  if (!topic || !['category', 'keyword', 'text'].includes(topic.kind)) return null
  const value = String(topic.value || '').trim().slice(0, 100)
  return value ? { kind: topic.kind, value } : null
}

const topicKey = (topic) => `${topic.kind}:${topic.value}`

const categoryLabel = (name) => `${name} (${CATEGORY_HINTS[name] || 'a part of their life'})`

function topicLabel(topic) {
  if (topic.kind === 'category') return categoryLabel(topic.value)
  return topic.value
}

/**
 * A memory picker shared by every mode: skips memories on skip cooldown,
 * behind the last few questions, near-repeats of one already picked, and
 * too many from a saturated keyword. `relaxed` lets recently-asked-about
 * memories back in, for topics small enough that they'd otherwise be empty.
 */
function memoryPicker({ maxSaturated, exemptKeyword = null }) {
  const recentSources = new Set(db.prepare(`SELECT source_ids FROM questions ORDER BY created_at DESC LIMIT ?`)
    .all(RECENT_SOURCE_QUESTIONS).flatMap(r => JSON.parse(r.source_ids)))
  const cooling = skippedSourceIds()
  const saturated = saturatedKeywords().filter(k => k.term.toLowerCase() !== exemptKeyword?.toLowerCase())
  const saturatedNodes = new Set(saturated.length === 0 ? [] : db.prepare(`
    SELECT DISTINCT node_id FROM node_keywords WHERE keyword_id IN (${saturated.map(() => '?').join(',')})
  `).all(...saturated.map(k => k.id)).map(r => r.node_id))
  const cutoff = new Date(Date.now() - LOOSE_END_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const picked = new Map()
  let saturatedPicked = 0
  const pick = (nodes, limit, { relaxed = false, category = null } = {}) => {
    let added = 0
    for (const node of nodes) {
      if (added >= limit) break
      if (picked.has(node.id) || cooling.has(node.id)) continue
      if (!relaxed && recentSources.has(node.id)) continue
      if (saturatedNodes.has(node.id) && saturatedPicked >= maxSaturated) continue
      const vector = JSON.parse(node.embedding)
      if ([...picked.values()].some(p => dot(p.vector, vector) >= NEAR_REPEAT_SIMILARITY)) continue
      if (saturatedNodes.has(node.id)) saturatedPicked++
      const looseEnd = node.timestamp < cutoff && IN_PROGRESS_REGEX.test(`${node.title} ${node.content}`)
      picked.set(node.id, { ...node, vector, category, looseEnd })
      added++
    }
    return added
  }
  return { pick, picked }
}

const categoryMemories = db.prepare(`
  SELECT ${MEMORY_COLUMNS} FROM nodes n
  JOIN node_categories nc ON nc.node_id = n.id JOIN categories c ON c.id = nc.category_id
  WHERE c.name = ? ORDER BY RANDOM()
`)
const keywordMemories = db.prepare(`
  SELECT ${MEMORY_COLUMNS} FROM nodes n
  JOIN node_keywords nk ON nk.node_id = n.id JOIN keywords k ON k.id = nk.keyword_id
  WHERE k.term = ? COLLATE NOCASE ORDER BY RANDOM()
`)
const getMemory = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM nodes n WHERE id = ?`)

// Memories for one chosen topic, a random spread of them (so repeat
// clicks see different ones). Free apart from one embedding for typed
// topics (a fraction of a thousandth of a cent - COST.md #2).
async function topicMemories(topic) {
  let candidates
  if (topic.kind === 'category') {
    candidates = categoryMemories.all(topic.value)
  } else if (topic.kind === 'keyword') {
    candidates = keywordMemories.all(topic.value)
  } else {
    const vector = await generateEmbedding(topic.value)
    candidates = findNearestNodes(vector, { candidatePool: 40 })
      .map(id => getMemory.get(id))
      .filter(n => n && dot(vector, JSON.parse(n.embedding)) >= TEXT_TOPIC_MIN_SIMILARITY)
  }
  const { pick, picked } = memoryPicker({
    maxSaturated: MAX_SATURATED.topic,
    exemptKeyword: topic.kind === 'keyword' ? topic.value : null
  })
  const added = pick(candidates, TOPIC_MEMORIES)
  if (added < TOPIC_MEMORIES / 2) pick(candidates, TOPIC_MEMORIES - added, { relaxed: true })
  return [...picked.values()]
}

// "Surprise me": SURPRISE_CATEGORIES different categories, picked at
// random but leaning towards ones asked about least lately (skips count
// extra), with a few memories from each.
function surpriseCategories() {
  const recent = new Map()
  for (const r of db.prepare(`
    SELECT category, status FROM questions WHERE category IS NOT NULL ORDER BY created_at DESC LIMIT ?
  `).all(SURPRISE_LOOKBACK)) {
    const weight = r.status === 'skipped' || r.status === 'dismissed' ? SKIP_WEIGHT : 1
    recent.set(r.category, (recent.get(r.category) || 0) + weight)
  }
  const pool = [...categoryCounts()].filter(([, n]) => n > 0)
    .map(([name]) => ({ name, weight: 1 / (1 + (recent.get(name) || 0)) }))
  const chosen = []
  while (chosen.length < SURPRISE_CATEGORIES && pool.length > 0) {
    let r = Math.random() * pool.reduce((sum, c) => sum + c.weight, 0)
    const i = Math.max(0, pool.findIndex(c => (r -= c.weight) <= 0))
    chosen.push(pool.splice(i, 1)[0].name)
  }
  return chosen
}

function surpriseMemories(categories) {
  const { pick, picked } = memoryPicker({ maxSaturated: MAX_SATURATED.surprise })
  for (const name of categories) {
    const candidates = categoryMemories.all(name)
    const added = pick(candidates, SURPRISE_MEMORIES_PER_CATEGORY, { category: name })
    if (added === 0) pick(candidates, SURPRISE_MEMORIES_PER_CATEGORY, { category: name, relaxed: true })
  }
  return [...picked.values()]
}

const parseVector = (json) => (json ? JSON.parse(json) : null)

// Splits candidates into fresh ones and rephrases of a past question (or
// of each other), keeping Claude's order. One batched embedding call
// covers the candidates plus any past questions still missing an
// embedding, which are saved. Repeats come back with how close they were,
// so the batch can be topped up with the least-bad ones if needed.
async function splitRepeats(candidates) {
  const past = db.prepare(`SELECT id, question, status, embedding FROM questions`).all()
  const missing = past.filter(q => !q.embedding)
  let vectors
  try {
    vectors = await generateEmbeddings([...candidates.map(q => q.question), ...missing.map(q => q.question)])
  } catch (error) {
    console.warn("Couldn't check questions for repeats:", error.message)
    return { fresh: candidates.map(q => ({ ...q, vector: null })), repeats: [] }
  }
  const save = db.prepare(`UPDATE questions SET embedding = ? WHERE id = ?`)
  missing.forEach((q, i) => {
    const vector = vectors[candidates.length + i]
    q.embedding = JSON.stringify(vector)
    save.run(q.embedding, q.id)
  })

  const seen = past.map(q => ({
    vector: parseVector(q.embedding),
    limit: q.status === 'skipped' || q.status === 'dismissed' ? SKIPPED_REPEAT_SIMILARITY : REPEAT_SIMILARITY
  }))
  const fresh = []
  const repeats = []
  candidates.forEach((q, i) => {
    const vector = vectors[i]
    const closest = Math.max(0, ...seen.filter(p => p.vector).map(p => dot(p.vector, vector)))
    if (seen.some(p => p.vector && dot(p.vector, vector) >= p.limit)) {
      console.log(`🔁 Dropped a repeat question (${closest.toFixed(2)}): ${q.question}`)
      repeats.push({ ...q, vector, closest })
      return
    }
    fresh.push({ ...q, vector })
    seen.push({ vector, limit: REPEAT_SIMILARITY })
  })
  return { fresh, repeats }
}

/**
 * The paid step: one Claude call writing QUESTIONS_PER_BATCH new questions
 * (plus spares, see splitRepeats) about `topic`, or about 3 random
 * categories when there's no topic ("Surprise me"). Returns the stored
 * questions.
 */
export async function generateQuestions(rawTopic) {
  const topic = normaliseTopic(rawTopic)
  const categories = topic ? [] : surpriseCategories()
  const picked = topic ? await topicMemories(topic) : surpriseMemories(categories)
  // A surprise batch with no memories at all has nothing to go on; a
  // chosen topic can still get opening questions.
  if (!topic && picked.length === 0) return []
  const wildcard = !topic && Math.random() < WILDCARD_CHANCE

  // Short ids (m1, m2...) instead of node ids: ~15 fewer tokens each, and
  // mapped back below.
  const shortIds = new Map(picked.map((m, i) => [`m${i + 1}`, m.id]))
  const memories = picked.map((m, i) => ({
    id: `m${i + 1}`,
    date: (m.timestamp || '').slice(0, 10),
    categories: memoryCategories(m.id),
    looseEnd: m.looseEnd,
    // Titles mostly restate the content - send the sentence only, trimmed.
    content: m.content.length > CONTENT_CHARS ? `${m.content.slice(0, CONTENT_CHARS - 1)}…` : m.content
  }))

  const key = topic ? topicKey(topic) : null
  const sameTopic = topic
    ? db.prepare(`SELECT question, status FROM questions WHERE topic = ? OR (category = ? AND ? = 'category') ORDER BY created_at DESC LIMIT ?`)
      .all(key, topic.value, topic.kind, PAST_SAME_TOPIC)
    : db.prepare(`SELECT question, status FROM questions WHERE category IN (${categories.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`)
      .all(...categories, PAST_SAME_TOPIC)
  const others = db.prepare(`SELECT question, status FROM questions WHERE gap != 'search' ORDER BY created_at DESC LIMIT ?`)
    .all(PAST_OTHER + sameTopic.length)
    .filter(q => !sameTopic.some(s => s.question === q.question))
    .slice(0, PAST_OTHER)

  const written = await writeCuriousQuestions({
    memories,
    topic: topic ? topicLabel(topic) : null,
    surpriseCategories: categories.map(categoryLabel),
    categoryNames: categories,
    pastQuestions: [...sameTopic, ...others],
    count: QUESTIONS_PER_BATCH + QUESTION_SPARES,
    wildcard
  })

  // Fresh ones first; if repeats left the batch short, the least-similar
  // repeats that aren't outright rephrases fill it, so a click always
  // gives QUESTIONS_PER_BATCH when it can.
  const { fresh, repeats } = await splitRepeats(written)
  const batch = [
    ...fresh,
    ...repeats.filter(q => q.closest < HARD_REPEAT_SIMILARITY).sort((a, b) => a.closest - b.closest)
  ].slice(0, QUESTIONS_PER_BATCH)

  const insert = db.prepare(`
    INSERT INTO questions (id, question, why, gap, category, topic, source_ids, model, created_at, embedding)
    VALUES (@id, @question, @why, @gap, @category, @topic, @source_ids, @model, @created_at, @embedding)
  `)
  const now = Date.now()
  return batch.map(({ vector, closest, ...q }, i) => {
    const row = {
      id: `question_${now}_${i}`,
      question: q.question,
      why: q.why,
      // What kind of question it was, for the history: the topic kind, or
      // "surprise" / "wildcard" (a surprise question tied to no category).
      gap: topic ? topic.kind : categories.includes(q.category) ? 'surprise' : 'wildcard',
      category: topic?.kind === 'category' ? topic.value : (categories.includes(q.category) ? q.category : null),
      topic: key,
      // Only ids Claude was actually shown - never a made-up one.
      source_ids: JSON.stringify(q.memory_ids.filter(id => shortIds.has(id)).map(id => shortIds.get(id))),
      model: config.questionModel,
      created_at: new Date(now + i).toISOString(),
      embedding: vector ? JSON.stringify(vector) : null
    }
    insert.run(row)
    return toQuestion({ ...row, status: 'open', answer: null, answer_node_ids: '[]', closed_at: null })
  })
}

/**
 * A question Sarah asked the search bar that her memories couldn't answer,
 * turned around so she can fill the gap. Free - no Claude call; only her
 * answer costs anything (normal extraction). Stored as-is, in her words,
 * with gap 'search' so it's told apart from the brain's own questions.
 */
export function createSearchQuestion(text) {
  const row = {
    id: `question_${Date.now()}_search`,
    question: text,
    why: "You asked your brain this and it didn't know yet.",
    gap: 'search',
    source_ids: '[]',
    model: 'search',
    created_at: new Date().toISOString()
  }
  db.prepare(`
    INSERT INTO questions (id, question, why, gap, source_ids, model, created_at)
    VALUES (@id, @question, @why, @gap, @source_ids, @model, @created_at)
  `).run(row)
  return getQuestion(row.id)
}
