import express from 'express'
import { userName } from '../config.js'
import { getOpenQuestions, getClosedQuestions, getQuestion, closeQuestion, generateQuestions, createSearchQuestion, getTopics } from '../services/curiosity.js'
import { detectDuplicates } from '../services/duplicates.js'
import { ingestConversation } from './conversation.js'

const router = express.Router()

// Every route below returns both lists (plus the topics the "ask me about"
// picker offers) so the client refreshes in one go.
function allQuestions() {
  return {
    questions: getOpenQuestions(),
    history: getClosedQuestions(),
    topics: getTopics()
  }
}

/**
 * GET /api/questions - the brain's open questions (oldest first) and the
 * closed ones (newest first) for Reflect's history. Free.
 */
router.get('/questions', (req, res) => {
  res.json(allQuestions())
})

/**
 * POST /api/questions/generate  { topic?: { kind: 'category' | 'keyword' | 'text', value } }
 * Manual-only (the "ask me about" picker on Home and Reflect) - one Claude
 * call per click (see COST.md). No topic = "Surprise me". Returns every
 * open question, new ones included.
 */
router.post('/questions/generate', async (req, res) => {
  try {
    const created = await generateQuestions(req.body?.topic)
    res.json({ created: created.length, ...allQuestions() })
  } catch (error) {
    console.error('Question generation failed:', error)
    res.status(500).json({ error: 'Question generation failed', message: error.message })
  }
})

// Runs an answer through the normal memory extraction (same cost as
// pasting a short conversation), with the question as context so a short
// answer like "Yes, in March" still makes sense on its own.
async function answerQuestion(question, answer) {
  const owner = userName() || 'The user'
  const conversation = question.gap === 'search'
    ? `${owner}'s AI Brain couldn't answer one of their searches, so it asked them: ${question.question}\n\n${owner} answered: ${answer}`
    : `${owner}'s AI Brain asked them: ${question.question}\n\n${owner} answered: ${answer}`
  const graph = await ingestConversation(conversation)
  closeQuestion(question.id, 'answered', { answer, answerNodeIds: graph.newNodeIds })
  return {
    newNodeIds: graph.newNodeIds,
    ...allQuestions(),
    graph: { ...graph, suggestedDuplicates: detectDuplicates() }
  }
}

/**
 * POST /api/questions/:id/answer  { answer }
 * See answerQuestion().
 */
router.post('/questions/:id/answer', async (req, res) => {
  try {
    const question = getQuestion(req.params.id)
    if (!question) return res.status(404).json({ error: 'Question not found' })
    if (question.status !== 'open') return res.status(409).json({ error: 'Question already closed' })
    const answer = (req.body.answer || '').trim()
    if (!answer) return res.status(400).json({ error: 'Answer is required' })

    res.json(await answerQuestion(question, answer))
  } catch (error) {
    console.error('Answering question failed:', error)
    res.status(500).json({ error: 'Answering question failed', message: error.message })
  }
})

/**
 * POST /api/questions/from-search  { question, answer? }
 * The search bar couldn't answer `question`, so it asks Sarah back. With
 * an answer, it's saved straight away (one extraction call, like any
 * answer); without one it's "remind me later" and becomes an open
 * question on Home/Reflect (free). Ignoring the prompt never calls this,
 * so unanswered searches don't pile up.
 */
router.post('/questions/from-search', async (req, res) => {
  try {
    const text = (req.body.question || '').trim()
    if (!text) return res.status(400).json({ error: 'Question is required' })
    const answer = (req.body.answer || '').trim()

    const question = createSearchQuestion(text)
    if (!answer) return res.json(allQuestions())
    res.json(await answerQuestion(question, answer))
  } catch (error) {
    console.error('Saving search question failed:', error)
    res.status(500).json({ error: 'Saving search question failed', message: error.message })
  }
})

/**
 * POST /api/questions/:id/close  { status: 'skipped' | 'dismissed' }
 * Skip = not now; dismissed = "not relevant", which also steers future
 * questions away from the topic. Free.
 */
router.post('/questions/:id/close', (req, res) => {
  const { status } = req.body
  if (!['skipped', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: "status must be 'skipped' or 'dismissed'" })
  }
  const question = getQuestion(req.params.id)
  if (!question) return res.status(404).json({ error: 'Question not found' })
  closeQuestion(question.id, status)
  res.json(allQuestions())
})

export default router
