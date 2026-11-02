import express from 'express'
import { loadGraph } from '../services/storage.js'
import { writeWeeklyDigest } from '../services/anthropic.js'
import { db } from '../services/db.js'
import { config } from '../config.js'

const router = express.Router()

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// Keeps one digest's input bounded however busy a week was.
const MAX_DIGEST_MEMORIES = 60

const lastDigestEnd = db.prepare('SELECT MAX(period_end) AS end FROM digests')

/**
 * POST /api/stats/digest
 * Manual-only ("Catch me up" on Reflect) - one Claude call per click.
 * Covers what's new since the last digest, but never more than the last
 * 7 days, so a long gap doesn't make it (or its cost) balloon.
 */
router.post('/stats/digest', async (req, res) => {
  try {
    const { end } = lastDigestEnd.get()
    const cutoff = Math.max(Date.now() - WEEK_MS, end ? new Date(end).getTime() : 0)
    const recent = loadGraph().nodes
      .filter(n => n.data.timestamp && new Date(n.data.timestamp).getTime() > cutoff)
      .sort((a, b) => b.data.timestamp.localeCompare(a.data.timestamp))
      .slice(0, MAX_DIGEST_MEMORIES)

    if (recent.length === 0) {
      return res.json({ digest: null, count: 0 })
    }

    const text = await writeWeeklyDigest(recent.map(n => ({
      title: n.data.title,
      content: n.data.content || '',
      categories: n.data.categories || [],
      timestamp: n.data.timestamp
    })))
    if (!text) {
      return res.json({ digest: null, count: recent.length })
    }

    const now = new Date()
    const digest = {
      id: `digest_${now.getTime()}`,
      created_at: now.toISOString(),
      period_start: new Date(cutoff).toISOString(),
      period_end: now.toISOString(),
      memory_count: recent.length,
      model: config.answerModel,
      text
    }
    db.prepare(`
      INSERT INTO digests (id, created_at, period_start, period_end, memory_count, model, text)
      VALUES (@id, @created_at, @period_start, @period_end, @memory_count, @model, @text)
    `).run(digest)

    res.json({ digest, count: recent.length })
  } catch (error) {
    console.error('Digest failed:', error)
    res.status(500).json({ error: 'Digest failed', message: error.message })
  }
})

/**
 * GET /api/stats/digests - every saved digest, newest first. Free.
 */
router.get('/stats/digests', (req, res) => {
  res.json({ digests: db.prepare('SELECT * FROM digests ORDER BY created_at DESC').all() })
})

export default router
