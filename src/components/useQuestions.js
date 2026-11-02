import { useCallback, useEffect, useState } from 'react'

// The brain's questions (server/services/curiosity.js), shared by the Home
// card and the Reflect page so answering in one updates the other.
// generate() is the one paid call and only ever runs from a button
// (see COST.md).
// `nodes` changing (memories added, edited or deleted) re-fetches, so the
// picker's keywords stay current - a free, local call.
export function useQuestions(onAnswered, nodes) {
  const [questions, setQuestions] = useState([])
  const [history, setHistory] = useState([])
  const [topics, setTopics] = useState({ categories: [], keywords: [] })
  const [generating, setGenerating] = useState(null)

  const apply = (data) => {
    setQuestions(data.questions || [])
    setHistory(data.history || [])
    if (data.topics) setTopics(data.topics)
  }

  const post = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || data.error)
    return data
  }

  useEffect(() => {
    fetch('/api/questions')
      .then(r => r.json())
      .then(apply)
      .catch(error => console.error('Failed to load questions:', error))
  }, [nodes])

  // Each returns a short message for the UI to show. `topic` is
  // { kind: 'category' | 'keyword' | 'text', value }, or null for
  // "Surprise me".
  const generate = useCallback(async (topic = null) => {
    setGenerating(topic ? `${topic.kind}:${topic.value}` : 'surprise')
    try {
      const data = await post('/api/questions/generate', { topic })
      apply(data)
      if (data.created === 0) return topic ? `Couldn't think of anything new to ask about ${topic.value} - try another topic.` : "Couldn't think of anything new to ask right now."
      return data.created < 3 ? `Only found ${data.created} new thing${data.created === 1 ? '' : 's'} to ask${topic ? ` about ${topic.value}` : ''}.` : null
    } catch (error) {
      console.error('Failed to generate questions:', error)
      return `Couldn't ask for questions: ${error.message}`
    } finally {
      setGenerating(null)
    }
  }, [])

  const answer = useCallback(async (id, text) => {
    const data = await post(`/api/questions/${id}/answer`, { answer: text })
    // The "Memory saved" pop-up (MemoryToast, via onAnswered) is the
    // confirmation, so there's no inline message.
    onAnswered(data.graph, data.newNodeIds)
    apply(data)
    return null
  }, [onAnswered])

  const close = useCallback(async (id, status) => {
    const data = await post(`/api/questions/${id}/close`, { status })
    apply(data)
    return status === 'dismissed' ? "Got it - I won't ask about that again." : null
  }, [])

  // A search the brain couldn't answer, asked back. With an answer it's
  // saved now; without one it's "remind me later" and joins the open
  // questions. Never called if Sarah ignores it, so nothing is kept.
  const askBack = useCallback(async (question, text = '') => {
    const data = await post('/api/questions/from-search', { question, answer: text })
    if (text) onAnswered(data.graph, data.newNodeIds)
    apply(data)
  }, [onAnswered])

  return { questions, history, topics, generating, generate, answer, close, askBack }
}
