import express from 'express'
import { randomUUID } from 'crypto'
import { db, CANONICAL_CATEGORIES } from '../services/db.js'
import { photoFromUrl, photoFromDataUrl, removePhoto, PhotoError } from '../services/wishlistPhotos.js'

const router = express.Router()

// idea -> researching -> ready -> bought | dropped. Sarah likes to take her
// time before buying, so the list is as much about how long something has
// been wanted (first_mentioned, mention_count) as about what it is.
export const WISHLIST_STATUSES = ['idea', 'researching', 'ready', 'bought', 'dropped']

const selectAll = db.prepare(`SELECT * FROM wishlist_items ORDER BY last_mentioned DESC`)
const selectById = db.prepare(`SELECT * FROM wishlist_items WHERE id = ?`)
const selectByName = db.prepare(`SELECT * FROM wishlist_items WHERE name = ?`)
const insertItem = db.prepare(`
  INSERT INTO wishlist_items (id, name, categories, keywords, why, status, price, notes, options,
    mention_count, first_mentioned, last_mentioned, status_changed_at)
  VALUES (@id, @name, @categories, @keywords, @why, @status, @price, @notes, @options,
    1, @at, @at, @at)
`)
const deleteItem = db.prepare(`DELETE FROM wishlist_items WHERE id = ?`)
const setPhoto = db.prepare(`UPDATE wishlist_items SET image = @image, link = COALESCE(link, @link) WHERE id = @id`)
const setLink = db.prepare(`UPDATE wishlist_items SET link = ? WHERE id = ?`)
const aliasTerm = db.prepare(`
  SELECT k.term FROM keyword_aliases a JOIN keywords k ON k.id = a.keyword_id WHERE a.alias = ?
`)
const exactTerm = db.prepare(`SELECT term FROM keywords WHERE term = ? COLLATE NOCASE`)

function toItem(row) {
  return {
    ...row,
    categories: JSON.parse(row.categories),
    keywords: JSON.parse(row.keywords),
    notes: JSON.parse(row.notes),
    options: JSON.parse(row.options),
    image_url: row.image ? `/api/wishlist-images/${row.image}` : null
  }
}

const clean = v => (typeof v === 'string' && v.trim() ? v.trim() : null)
const asList = v => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])

// Only the canonical categories, in canonical spelling.
function cleanCategories(raw) {
  return asList(raw)
    .map(c => CANONICAL_CATEGORIES.find(k => k.toLowerCase() === String(c).trim().toLowerCase()))
    .filter(Boolean)
}

// Resolved onto the brain's existing keywords (aliases, then a
// case-insensitive exact match) so items line up with memories - but never
// minting a keyword row: that would cost an embedding call and fill the
// brain's vocabulary with shopping terms. Unmatched terms are kept as-is.
function cleanKeywords(raw) {
  return asList(raw)
    .map(clean)
    .filter(Boolean)
    .map(t => aliasTerm.get(t)?.term || exactTerm.get(t)?.term || t.toLowerCase())
}

const union = (a, b) => {
  const seen = new Set(a.map(x => x.toLowerCase()))
  return [...a, ...b.filter(x => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))]
}

// A mention can be dated in the past (backfilling from old chats), so it
// moves first/last_mentioned outward rather than just stamping "now".
function mentionDate(raw) {
  const d = raw ? new Date(raw) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function appendEntry(list, text, at) {
  const t = clean(text)
  if (!t || list.some(e => e.text.toLowerCase() === t.toLowerCase())) return list
  return [...list, { at, text: t }].sort((a, b) => a.at.localeCompare(b.at))
}

// Edited list of option texts: unchanged ones keep their date and details.
function replaceEntries(list, texts, at) {
  const seen = new Set()
  return texts.map(clean)
    .filter(t => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .map(t => list.find(e => e.text === t) || { at, text: t })
}

const sameText = (a, b) => a.toLowerCase() === b.toLowerCase()
const cleanList = v => (Array.isArray(v) ? v.map(clean).filter(Boolean) : undefined)

// Options double as the comparison: each specific product being weighed
// carries its own pros, cons, price, shop link and a one-line take, matched
// by name (text). Fields given replace what's there; new names are added.
function mergeOptionDetails(list, details, at) {
  let out = list
  for (const d of Array.isArray(details) ? details : []) {
    const text = clean(d?.text || d?.name)
    if (!text) continue
    if (!out.some(o => sameText(o.text, text))) out = [...out, { at, text }]
    out = out.map(o => {
      if (!sameText(o.text, text)) return o
      const next = { ...o }
      const pros = cleanList(d.pros)
      const cons = cleanList(d.cons)
      if (pros) next.pros = pros
      if (cons) next.cons = cons
      for (const key of ['price', 'link', 'summary']) if (d[key] !== undefined) next[key] = clean(d[key])
      if (d.ruledOut !== undefined) next.ruledOut = Boolean(d.ruledOut)
      return next
    })
  }
  return out
}

const STOPWORDS = new Set(['the', 'and', 'for', 'new', 'with', 'set', 'pair', 'kit'])
const nameWords = name => new Set(
  name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOPWORDS.has(w))
)

// Items that are probably the same thing under another name - "Garmin
// Forerunner 265" vs "Garmin watch" - by a shared name word or two shared
// keywords. Deliberately loose: it only asks Claude to check, it never merges.
function findSimilar(name, keywords) {
  const words = nameWords(name)
  const kws = new Set(keywords.map(k => k.toLowerCase()))
  return selectAll.all().map(toItem).filter(item => {
    const sharedWord = [...nameWords(item.name)].some(w => words.has(w))
    const sharedKeywords = item.keywords.filter(k => kws.has(k.toLowerCase())).length
    return sharedWord || sharedKeywords >= 2
  })
}

// Replaces an item's photo, from a link (product page or image) or an
// uploaded data: URL. A product page also becomes the item's shop link if it
// has none yet.
async function attachPhoto(row, { url, dataUrl, replaceLink }) {
  const { file, page } = dataUrl
    ? { file: photoFromDataUrl(row.id, dataUrl), page: null }
    : await photoFromUrl(row.id, url)
  setPhoto.run({ id: row.id, image: file, link: page })
  if (replaceLink) setLink.run(clean(url), row.id)
  removePhoto(row.image)
}

// When Claude or the add form supplies a link but there's no photo yet, try
// to grab one - best effort: a shop blocking us shouldn't fail the add.
async function maybeAttachPhoto(id, { link, imageUrl }) {
  const row = selectById.get(id)
  const url = clean(imageUrl) || (!row.image && clean(link))
  if (!url) return
  try {
    await attachPhoto(row, { url })
  } catch (error) {
    console.warn(`Wishlist photo for "${row.name}" skipped:`, error.message)
  }
}

/**
 * GET /api/wishlist?q=
 * Every item, most recently mentioned first. q filters by words in the
 * name, keywords, why, options and notes.
 */
router.get('/wishlist', (req, res) => {
  try {
    let items = selectAll.all().map(toItem)
    const q = clean(req.query.q)?.toLowerCase()
    if (q) {
      const terms = q.split(/\s+/)
      items = items.filter(i => {
        const text = [i.name, i.why, ...i.keywords, ...i.categories, ...i.options.map(o => o.text), ...i.notes.map(n => n.text)]
          .filter(Boolean).join(' ').toLowerCase()
        return terms.some(t => text.includes(t))
      })
    }
    res.json({ items, statuses: WISHLIST_STATUSES })
  } catch (error) {
    res.status(500).json({ error: 'Failed to load wishlist' })
  }
})

/**
 * POST /api/wishlist
 * { name, categories?, keywords?, why?, price?, note?, option?, optionDetails?, link?, imageUrl?, mentionedAt?, force? }
 * Adds an item, or - if one with that name exists - records another mention
 * of it: bumps the count, widens the date range, merges categories/keywords,
 * appends the note/option, and fills in why/price only where still empty.
 * A new name that looks like an existing item gets a 409 with the lookalikes
 * instead, unless force is set.
 */
router.post('/wishlist', async (req, res) => {
  try {
    const name = clean(req.body.name)
    if (!name) return res.status(400).json({ error: 'name is required' })
    const at = mentionDate(req.body.mentionedAt)
    const categories = cleanCategories(req.body.categories)
    const keywords = cleanKeywords(req.body.keywords)
    const existing = selectByName.get(name)

    if (!existing) {
      if (!req.body.force) {
        const similar = findSimilar(name, keywords)
        if (similar.length) return res.status(409).json({ error: 'Possible duplicate', similar })
      }
      const id = randomUUID()
      insertItem.run({
        id,
        name,
        categories: JSON.stringify(categories),
        keywords: JSON.stringify(keywords),
        why: clean(req.body.why),
        status: 'idea',
        price: clean(req.body.price),
        notes: JSON.stringify(appendEntry([], req.body.note, at)),
        options: JSON.stringify(mergeOptionDetails(appendEntry([], req.body.option, at), req.body.optionDetails, at)),
        at
      })
      if (clean(req.body.link)) setLink.run(clean(req.body.link), id)
      await maybeAttachPhoto(id, req.body)
      return res.json({ created: true, item: toItem(selectById.get(id)) })
    }

    const item = toItem(existing)
    db.prepare(`
      UPDATE wishlist_items SET
        categories = @categories, keywords = @keywords,
        why = COALESCE(why, @why), price = COALESCE(price, @price),
        notes = @notes, options = @options, mention_count = mention_count + 1,
        first_mentioned = MIN(first_mentioned, @at), last_mentioned = MAX(last_mentioned, @at)
      WHERE id = @id
    `).run({
      id: item.id,
      categories: JSON.stringify(union(item.categories, categories)),
      keywords: JSON.stringify(union(item.keywords, keywords)),
      why: clean(req.body.why),
      price: clean(req.body.price),
      notes: JSON.stringify(appendEntry(item.notes, req.body.note, at)),
      options: JSON.stringify(mergeOptionDetails(appendEntry(item.options, req.body.option, at), req.body.optionDetails, at)),
      at
    })
    if (clean(req.body.link) && !item.link) setLink.run(clean(req.body.link), item.id)
    await maybeAttachPhoto(item.id, req.body)
    res.json({ created: false, item: toItem(selectById.get(item.id)) })
  } catch (error) {
    res.status(500).json({ error: 'Failed to add wishlist item', message: error.message })
  }
})

/**
 * PATCH /api/wishlist/:id
 * { name?, categories?, keywords?, why?, price?, status?, note?, option?, options?, optionDetails?,
 *   removeOption?, chooseOption?, link?, imageUrl?, checkedIn? }
 * Edits fields directly (no mention bump); categories/keywords replace the
 * full set, as does options (a list of texts). optionDetails adds or updates
 * options by name - [{ text, pros?, cons?, price?, link?, summary?, ruledOut? }].
 * chooseOption picks one: marks it chosen and moves the item to Ready.
 * imageUrl replaces the photo; a link fills in a missing one. checkedIn: true records a "yes, still want it" so the 30-day
 * nudge goes quiet again.
 */
router.patch('/wishlist/:id', async (req, res) => {
  try {
    const row = selectById.get(req.params.id)
    if (!row) return res.status(404).json({ error: 'Wishlist item not found' })
    const item = toItem(row)
    const now = new Date().toISOString()
    const b = req.body

    if (b.status !== undefined && !WISHLIST_STATUSES.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of ${WISHLIST_STATUSES.join(', ')}` })
    }

    let options = Array.isArray(b.options) ? replaceEntries(item.options, b.options, now) : item.options
    options = mergeOptionDetails(appendEntry(options, b.option, now), b.optionDetails, now)
    if (clean(b.removeOption)) options = options.filter(o => !sameText(o.text, clean(b.removeOption)))
    // Picking the winner: it's marked chosen, the item moves to Ready to
    // buy, and the option's shop link (if any) becomes the item's link and
    // photo - otherwise the page asks for one.
    const chosen = clean(b.chooseOption) && options.find(o => sameText(o.text, clean(b.chooseOption)))
    if (clean(b.chooseOption) && !chosen) {
      return res.status(400).json({ error: `No option called "${b.chooseOption}"` })
    }
    if (chosen) {
      options = options.map(o => ({ ...o, chosen: o === chosen, ruledOut: o === chosen ? false : o.ruledOut }))
      b.status = 'ready'
      if (chosen.link) b.link = chosen.link
    } else if (b.status === 'idea' || b.status === 'researching') {
      // Back to deciding: the pick no longer stands.
      options = options.map(({ chosen: _, ...o }) => o)
    }

    const next = {
      id: item.id,
      name: b.name !== undefined ? clean(b.name) || item.name : item.name,
      categories: JSON.stringify(b.categories !== undefined ? cleanCategories(b.categories) : item.categories),
      keywords: JSON.stringify(b.keywords !== undefined ? cleanKeywords(b.keywords) : item.keywords),
      why: b.why !== undefined ? clean(b.why) : item.why,
      price: b.price !== undefined ? clean(b.price) : item.price,
      link: b.link !== undefined ? clean(b.link) : item.link,
      status: b.status ?? item.status,
      status_changed_at: b.status && b.status !== item.status ? now : item.status_changed_at,
      checked_in_at: b.checkedIn ? now : item.checked_in_at,
      notes: JSON.stringify(appendEntry(item.notes, b.note, now)),
      options: JSON.stringify(options)
    }
    db.prepare(`
      UPDATE wishlist_items SET name = @name, categories = @categories, keywords = @keywords,
        why = @why, price = @price, link = @link, status = @status, status_changed_at = @status_changed_at,
        checked_in_at = @checked_in_at, notes = @notes, options = @options
      WHERE id = @id
    `).run(next)
    // A new shop link (e.g. the exact one picked on moving to Ready) brings
    // its own photo, replacing the old one.
    const newLink = clean(b.link) && clean(b.link) !== item.link ? clean(b.link) : null
    await maybeAttachPhoto(item.id, { imageUrl: b.imageUrl || newLink })
    res.json({ item: toItem(selectById.get(item.id)) })
  } catch (error) {
    if (/UNIQUE/.test(error.message)) {
      return res.status(409).json({ error: 'Another wishlist item already has that name' })
    }
    res.status(500).json({ error: 'Failed to update wishlist item', message: error.message })
  }
})

/**
 * POST /api/wishlist/:id/photo
 * { url } - a product page (its preview image is used) or an image link -
 * or { dataUrl } for an uploaded file. Replaces any existing photo.
 * replaceLink: true also makes url the item's shop link - the "which exact
 * one?" prompt when an item moves to Ready to buy. Fails
 * with 422 and a readable message when the page has no usable image or the
 * shop blocks the request.
 */
router.post('/wishlist/:id/photo', async (req, res) => {
  const row = selectById.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Wishlist item not found' })
  try {
    await attachPhoto(row, req.body)
    res.json({ item: toItem(selectById.get(row.id)) })
  } catch (error) {
    const known = error instanceof PhotoError || error.name === 'TimeoutError'
    res.status(known ? 422 : 500).json({
      error: error.name === 'TimeoutError' ? 'That site took too long to answer' : known ? error.message : 'Couldn\'t save that photo'
    })
  }
})

/**
 * DELETE /api/wishlist/:id/photo
 */
router.delete('/wishlist/:id/photo', (req, res) => {
  const row = selectById.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Wishlist item not found' })
  setPhoto.run({ id: row.id, image: null, link: null })
  removePhoto(row.image)
  res.json({ item: toItem(selectById.get(row.id)) })
})

/**
 * DELETE /api/wishlist/:id
 */
router.delete('/wishlist/:id', (req, res) => {
  try {
    removePhoto(selectById.get(req.params.id)?.image)
    deleteItem.run(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete wishlist item' })
  }
})

export default router
