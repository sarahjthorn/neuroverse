import OpenAI from 'openai'
import { config } from '../config.js'
import { getCategories } from './taxonomy.js'
import { EXTRACTION_RULES, ENTITY_RULE, ENTITY_JSON_EXAMPLE } from './extractionRules.js'

let openai = null

function getOpenAI() {
  if (!openai && config.openaiApiKey) {
    openai = new OpenAI({ apiKey: config.openaiApiKey })
  }
  return openai
}

/**
 * Extract memories from a conversation using GPT-4
 */
export async function extractMemories(conversationText, threadName = 'General') {
  const ai = getOpenAI()
  if (!ai) {
    throw new Error('OpenAI API key not configured')
  }

  const categoryNames = getCategories().map(c => c.name)

  const prompt = `You are analyzing a conversation to extract key memories, facts, and concepts about the person.

${EXTRACTION_RULES}
3. One or more categories that genuinely apply, chosen ONLY from this exact
   list (do not invent new ones, do not paraphrase them): ${categoryNames.join(', ')}
   If nothing fits well, pick the closest one - every memory needs at least one.
   Tag every category that genuinely applies - three or more is fine; don't
   stop at one or two out of habit (e.g. skincare is Health as well as
   whatever else fits; an API-cost decision is Financial as well as Project).
4. Keywords for connecting related concepts - specific terms or short
   phrases, reusing existing phrasing for the same concept where possible.
   When a concept sits inside a broader one (a neighborhood within a city, a
   library within a language, a team within a company), include BOTH the
   specific and the general term as separate keywords - e.g. a memory about
   "Bermondsey" should also carry the keyword "London", not only "Bermondsey".
   Without the general term, two memories about the same broader place/thing
   at different levels of specificity won't share any keyword at all and
   won't connect, even though they obviously should.
${ENTITY_RULE}

Return a JSON array of memory objects with this structure:
{
  "memories": [
    {
      "title": "Short title",
      "content": "One short sentence stating a single idea",
      "categories": ["Category name", "Category name"],
      "keywords": ["keyword1", "keyword2"],
      ${ENTITY_JSON_EXAMPLE}
    }
  ]
}

Conversation to analyze:
${conversationText}

Extract memories as JSON:`

  try {
    const response = await ai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.7
    })

    const result = JSON.parse(response.choices[0].message.content)
    
    // Add metadata
    return result.memories.map(memory => ({
      ...memory,
      thread: threadName,
      timestamp: new Date().toISOString()
    }))
  } catch (error) {
    console.error('Failed to extract memories:', error)
    throw new Error('Failed to extract memories from conversation')
  }
}

/**
 * Generate embedding vector for text using OpenAI
 */
export async function generateEmbedding(text) {
  const ai = getOpenAI()
  if (!ai) {
    throw new Error('OpenAI API key not configured')
  }

  try {
    const response = await ai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float'
    })

    return response.data[0].embedding
  } catch (error) {
    console.error('Failed to generate embedding:', error)
    // Keep OpenAI's reason (e.g. "Your API key has been invalidated") so it
    // reaches Claude through the MCP error instead of a generic failure.
    throw new Error(`Failed to generate embedding: ${error.message}`)
  }
}

// Several texts in one request (same price per token as one at a time).
export async function generateEmbeddings(texts) {
  const ai = getOpenAI()
  if (!ai) {
    throw new Error('OpenAI API key not configured')
  }
  if (texts.length === 0) return []
  const response = await ai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
    encoding_format: 'float'
  })
  return response.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (normA * normB)
}
