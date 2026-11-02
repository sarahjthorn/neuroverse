import express from 'express'
import { randomUUID } from 'crypto'
import { db, CANONICAL_CATEGORIES } from '../services/db.js'
import { generateEmbeddings, cosineSimilarity } from '../services/openai.js'
import { config } from '../config.js'

const router = express.Router()

// Axon's inbox: the options the
// morning plan suggests, and the ideas the explore task surfaces. Sarah
// answers each one on the Axon tab or from any Claude chat (the MCP
// update_inbox_item tool). No Claude calls here; ideas cost one
// embedding each (the repeat check below).
//
// new -> done | later | rejected, and expired when a newer plan replaces
// an option she never answered. `later` stays open ("not today"), dimmed.
export const INBOX_STATUSES = ['new', 'done', 'later', 'rejected', 'expired']
// What a click on the option opens (see the plan's "One click starts the
// task" table). Axon never sends or submits anything itself.
export const START_KINDS = ['claude_doc', 'email', 'url', 'rota', 'github', 'claude_chat']
// option: a small action for today (the morning plan). idea: something new
// worth doing, which reached her only because the critic said "do"
//. Accepting an idea gives no XP.
export const KINDS = ['option', 'idea']

// The filter on ideas: at most 3 reach her a day, and none that repeats an
// idea from the last 90 days. Raw embedding similarity, like the question
// repeat check (services/curiosity.js); stricter against ones she turned
// down, so a rejected idea doesn't come back reworded.
export const IDEAS_PER_DAY = 3
const IDEA_MEMORY_DAYS = 90
const IDEA_REPEAT_SIMILARITY = 0.7
const REJECTED_IDEA_REPEAT_SIMILARITY = 0.6

const selectById = db.prepare(`SELECT * FROM inbox_items WHERE id = ?`)
const selectOpen = db.prepare(`
  SELECT * FROM inbox_items WHERE status IN ('new', 'later') ORDER BY created_at DESC
`)
// Open items plus the last week's answers - long enough for the morning
// plan to see what she turned down and not suggest it again. Expired ones
// (options she never answered) are left out.
const selectRecent = db.prepare(`
  SELECT * FROM inbox_items
  WHERE status IN ('new', 'later') OR (status IN ('done', 'rejected') AND status_changed_at >= ?)
  ORDER BY created_at DESC
`)
const selectRecentIdeas = db.prepare(`
  SELECT * FROM inbox_items WHERE kind = 'idea' AND created_at >= ?
`)
const selectOpenByTitle = db.prepare(`
  SELECT * FROM inbox_items WHERE status IN ('new', 'later') AND lower(title) = lower(?)
`)
const insertItem = db.prepare(`
  INSERT INTO inbox_items (id, kind, title, why, category, impact, effort, minutes, series,
    series_step, needs_note, start_kind, start_url, start_label, status, for_date, source,
    created_by, embedding, created_at, status_changed_at)
  VALUES (@id, @kind, @title, @why, @category, @impact, @effort, @minutes, @series,
    @series_step, @needs_note, @start_kind, @start_url, @start_label, 'new', @for_date, @source,
    @created_by, @embedding, @at, @at)
`)
const expireOlder = db.prepare(`
  UPDATE inbox_items SET status = 'expired', status_changed_at = @at
  WHERE status = 'new' AND kind = 'option' AND source = @source AND (for_date IS NULL OR for_date < @today)
`)
const insertXp = db.prepare(`
  INSERT INTO xp_events (id, item_id, category, points, reason, at)
  VALUES (@id, @item_id, @category, @points, @reason, @at)
`)
const selectXp = db.prepare(`SELECT * FROM xp_events ORDER BY at`)
const hasXp = db.prepare(`SELECT 1 FROM xp_events WHERE item_id = ?`)

const clean = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
// The planner reads pages other people can edit (the Rota), and the card
// opens start links with one click, so only plain web links get through.
const webLink = v => (clean(v) && /^https?:\/\//i.test(clean(v)) ? clean(v) : null)
const rating = v => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(3, Math.max(1, n)) : null
}
const category = v => CANONICAL_CATEGORIES.find(c => c.toLowerCase() === String(v || '').trim().toLowerCase()) || null

// The local calendar day, since "today's options" means Sarah's day.
export function localDay(date = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toItem({ embedding, ...row }) {
  return { ...row, needs_note: Boolean(row.needs_note) }
}

// Bigger, harder things are worth more, so the bars reward the brave option
// as well as the easy one. 15-45 per item.
export const xpFor = item => 10 * (item.impact || 1) + 5 * (item.effort || 1)

// Level n needs 50 * n^2 XP in total - early levels come quickly.
function levelFor(xp) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1
  const floor = 50 * (level - 1) ** 2
  const next = 50 * level ** 2
  return { level, progress: (xp - floor) / (next - floor), next_at: next }
}

// Life (all XP), per-category XP, and discipline: of the last 14 days, the
// days with at least one thing done. A rolling window, so a missed day
// dents it instead of wiping out a streak.
export function stats(now = new Date()) {
  const events = selectXp.all()
  const total = events.reduce((sum, e) => sum + e.points, 0)
  const byCategory = {}
  for (const e of events) {
    const key = e.category || 'Other'
    byCategory[key] = (byCategory[key] || 0) + e.points
  }
  const doneDays = new Set(events.map(e => localDay(e.at)))
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push({ date: localDay(d), done: doneDays.has(localDay(d)) })
  }
  return {
    xp: total,
    ...levelFor(total),
    by_category: byCategory,
    discipline: { days, count: days.filter(d => d.done).length, window: days.length }
  }
}

function buildItem(raw, defaults) {
  const title = clean(raw?.title)
  if (!title) return { error: 'Every item needs a title' }
  const startKind = START_KINDS.includes(raw.startKind ?? raw.start_kind) ? (raw.startKind ?? raw.start_kind) : null
  return {
    item: {
      id: randomUUID(),
      kind: KINDS.includes(raw.kind) ? raw.kind : 'option',
      title,
      why: clean(raw.why),
      category: category(raw.category),
      impact: rating(raw.impact),
      effort: rating(raw.effort),
      minutes: Number.isFinite(Number(raw.minutes)) && Number(raw.minutes) > 0 ? Math.round(Number(raw.minutes)) : null,
      series: clean(raw.series),
      series_step: clean(raw.seriesStep ?? raw.series_step),
      // A step in a series always asks what she did, so the next step can
      // build on it (the plan's "Series and notes").
      needs_note: (raw.needsNote ?? raw.needs_note ?? Boolean(clean(raw.series))) ? 1 : 0,
      start_kind: startKind,
      start_url: webLink(raw.startUrl ?? raw.start_url),
      start_label: clean(raw.startLabel ?? raw.start_label),
      for_date: clean(raw.forDate ?? raw.for_date) || defaults.today,
      source: clean(raw.source) || defaults.source,
      created_by: clean(raw.createdBy ?? raw.created_by) || defaults.createdBy,
      embedding: null,
      at: defaults.at
    }
  }
}

// Embeds the new ideas (one call) and drops any too close to an idea from
// the last 90 days, in any status, or to another one in the same batch.
// Each repeat comes back as the idea it matched, with how close it was.
// With no OpenAI key (tests, new users) every idea gets through unchecked;
// with one, a failed check throws, so nothing unfiltered reaches her.
async function splitRepeatIdeas(ideas, at) {
  if (!config.openaiApiKey) return { fresh: ideas, repeats: [] }
  const vectors = await generateEmbeddings(ideas.map(i => [i.title, i.why].filter(Boolean).join('. ')))
  const since = new Date(new Date(at).getTime() - IDEA_MEMORY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const seen = selectRecentIdeas.all(since).filter(r => r.embedding).map(r => ({
    row: r,
    vector: JSON.parse(r.embedding),
    limit: r.status === 'rejected' ? REJECTED_IDEA_REPEAT_SIMILARITY : IDEA_REPEAT_SIMILARITY
  }))
  const fresh = []
  const repeats = []
  ideas.forEach((idea, i) => {
    const vector = vectors[i]
    const match = seen.find(p => cosineSimilarity(p.vector, vector) >= p.limit)
    if (match) {
      const similarity = Number(cosineSimilarity(match.vector, vector).toFixed(2))
      repeats.push({ ...toItem(match.row), similarity, repeat_of: idea.title })
      return
    }
    idea.embedding = JSON.stringify(vector)
    fresh.push(idea)
    seen.push({ row: { ...idea, status: 'new' }, vector, limit: IDEA_REPEAT_SIMILARITY })
  })
  return { fresh, repeats }
}

// Ideas already added today (her local day), for the daily cap.
function ideasToday(at) {
  const since = new Date(new Date(at).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
  return selectRecentIdeas.all(since).filter(r => localDay(r.created_at) === localDay(at)).length
}

/**
 * GET /api/inbox?status=recent|pending|all  ->  { items, stats, today }
 * recent (default): open items plus the last week's done and rejected ones.
 * pending: open items only. all: everything, expired included.
 */
router.get('/inbox', (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const rows = req.query.status === 'all'
    ? db.prepare(`SELECT * FROM inbox_items ORDER BY created_at DESC`).all()
    : req.query.status === 'pending' ? selectOpen.all() : selectRecent.all(since)
  res.json({ items: rows.map(toItem), stats: stats(), today: localDay() })
})

/**
 * POST /api/inbox  { items: [...], source?, createdBy?, expireOld? }
 * Adds items (or one item, if the body is the item itself). An open item
 * with the same title isn't added twice - it's returned as `existing`.
 * kind 'idea' also goes through the filter: a repeat of an idea from the
 * last 90 days comes back in `repeats` (the idea it matched, with
 * `similarity` and `repeat_of`), and ideas past today's cap of 3 come back
 * as `over_cap` titles. If the repeat check fails, nothing is added (503).
 * expireOld: true marks this source's unanswered options from earlier days
 * as expired, so each morning's plan replaces yesterday's.
 */
router.post('/inbox', async (req, res) => {
  try {
    await addItems(req, res)
  } catch (error) {
    console.error('Failed to add to the inbox:', error.message)
    res.status(503).json({ error: `Nothing added - try again later (${error.message})` })
  }
})

async function addItems(req, res) {
  const body = req.body || {}
  const list = Array.isArray(body.items) ? body.items : [body]
  const at = new Date().toISOString()
  const defaults = { at, today: localDay(), source: clean(body.source), createdBy: clean(body.createdBy) }

  const built = list.map(raw => buildItem(raw, defaults))
  const bad = built.find(b => b.error)
  if (bad) return res.status(400).json({ error: bad.error })

  const items = built.map(b => b.item)
  const ideas = items.filter(i => i.kind === 'idea')
  const { fresh, repeats } = ideas.length ? await splitRepeatIdeas(ideas, at) : { fresh: [], repeats: [] }
  const blocked = new Set(ideas.filter(i => !fresh.includes(i)))

  const created = []
  const existing = []
  const overCap = []
  let expired = 0
  db.transaction(() => {
    if (body.expireOld && defaults.source) {
      expired = expireOlder.run({ at, source: defaults.source, today: defaults.today }).changes
    }
    let ideaRoom = IDEAS_PER_DAY - ideasToday(at)
    for (const item of items) {
      if (blocked.has(item)) continue
      const dupe = selectOpenByTitle.get(item.title)
      if (dupe) {
        existing.push(toItem(dupe))
        continue
      }
      if (item.kind === 'idea' && ideaRoom-- <= 0) {
        overCap.push(item.title)
        continue
      }
      insertItem.run(item)
      created.push(toItem(selectById.get(item.id)))
    }
  })()
  res.json({ created, existing, repeats, expired, over_cap: overCap })
}

/**
 * PATCH /api/inbox/:id  { status?, note?, reason?, started?, why? }
 * done: needs a note for items that ask for one (series steps), and adds XP.
 * started: true records the one-click start (opening the doc, the email).
 * why: replaces the item's recommendation text, e.g. when a deep-think
 * rerun changes it. The repeat-check embedding stays the original's.
 */
router.patch('/inbox/:id', (req, res) => {
  const row = selectById.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Inbox item not found' })
  const { status, started } = req.body || {}
  const note = clean(req.body?.note)
  const reason = clean(req.body?.reason)
  const why = clean(req.body?.why)
  if (status !== undefined && !INBOX_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${INBOX_STATUSES.join(', ')}` })
  }
  if (status === 'done' && row.needs_note && !note && !row.outcome_note) {
    return res.status(400).json({ error: 'Add a few words about what you did, so the next step can build on it' })
  }

  const at = new Date().toISOString()
  db.transaction(() => {
    const fields = { id: row.id, at }
    const sets = []
    if (status && status !== row.status) {
      sets.push('status = @status', 'status_changed_at = @at')
      fields.status = status
    }
    if (note) { sets.push('outcome_note = @note'); fields.note = note }
    if (reason) { sets.push('reason = @reason'); fields.reason = reason }
    if (why) { sets.push('why = @why'); fields.why = why }
    if (started && !row.started_at) sets.push('started_at = @at')
    if (sets.length) db.prepare(`UPDATE inbox_items SET ${sets.join(', ')} WHERE id = @id`).run(fields)

    // XP only the first time it's ever marked done (done -> later -> done
    // again doesn't count twice), and never for accepting an idea: XP is
    // for things actually done.
    if (status === 'done' && row.kind !== 'idea' && !hasXp.get(row.id)) {
      insertXp.run({ id: randomUUID(), item_id: row.id, category: row.category, points: xpFor(row), reason: row.title, at })
    }
  })()

  res.json({ item: toItem(selectById.get(row.id)), stats: stats() })
})

export default router
