import Anthropic from '@anthropic-ai/sdk'
import { config, ownerName, ownerPossessive } from '../config.js'
import { getCategories } from './taxonomy.js'
import { EXTRACTION_RULES, ENTITY_RULE, ENTITY_JSON_EXAMPLE } from './extractionRules.js'

let anthropic = null

function getAnthropic() {
  if (!anthropic && config.anthropicApiKey) {
    anthropic = new Anthropic({ apiKey: config.anthropicApiKey })
  }
  return anthropic
}

/**
 * Extract memories from a conversation using Claude
 */
export async function extractMemoriesWithClaude(conversationText, threadName = 'General', model = 'claude-haiku-4-5-20251001', maxTokens = 2000) {
  const client = getAnthropic()
  if (!client) {
    throw new Error('Anthropic API key not configured')
  }

  const categoryNames = getCategories().map(c => c.name)

  // System prompt with cache_control - this part will be cached!
  const systemPrompt = `You are analyzing a conversation to extract key memories, facts, and concepts about the person.

${EXTRACTION_RULES}
3. One or more categories that genuinely apply, chosen ONLY from this exact
   list (do not invent new ones, do not paraphrase them): ${categoryNames.join(', ')}
   If nothing fits well, pick the closest one - every memory needs at least one.
   Tag every category that genuinely applies - three or more is fine; don't
   stop at one or two out of habit (e.g. skincare is Health as well as
   whatever else fits; an API-cost decision is Financial as well as Project).
4. Keywords for connecting related concepts - specific terms or short phrases,
   not full sentences. Reuse an existing way of phrasing something you've
   already used in this same batch instead of inventing a new near-duplicate
   phrasing for the same concept.
   When a concept sits inside a broader one (a neighborhood within a city, a
   library within a language, a team within a company), include BOTH the
   specific and the general term as separate keywords - e.g. a memory about
   "Bermondsey" should also carry the keyword "London", not only "Bermondsey".
   Without the general term, two memories about the same broader place/thing
   at different levels of specificity won't share any keyword at all and
   won't connect, even though they obviously should.
${ENTITY_RULE}

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
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
}`

  const userPrompt = `Conversation to analyze:
${conversationText}

Extract memories as JSON:`

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // cache_control here is a no-op at this prompt's length; see COST.md
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [{
        role: 'user',
        content: userPrompt
      }]
    })

    // Extract text content from Claude's response
    const textContent = response.content.find(block => block.type === 'text')
    if (!textContent) {
      throw new Error('No text content in Claude response')
    }

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonText = textContent.text.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/, '').replace(/\n?```$/, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/, '').replace(/\n?```$/, '')
    }

    const result = JSON.parse(jsonText)
    
    // Log cache performance. Note: caching only activates once cacheable
    // content clears the model's minimum cacheable length (e.g. 4096 tokens
    // for Haiku 4.5) - our ~200-token system prompt is well under that, so
    // cache_creation/cache_read will normally read 0. The win from Haiku here
    // is its lower base per-token price, not caching.
    if (response.usage) {
      console.log(`📊 Token usage:`, {
        input: response.usage.input_tokens,
        cache_creation: response.usage.cache_creation_input_tokens || 0,
        cache_read: response.usage.cache_read_input_tokens || 0,
        output: response.usage.output_tokens
      })
      
      if (response.usage.cache_read_input_tokens > 0) {
        const savings = ((response.usage.cache_read_input_tokens / (response.usage.input_tokens + response.usage.cache_read_input_tokens)) * 100).toFixed(1)
        console.log(`💰 Cache savings: ${savings}% of input tokens`)
      }
    }
    
    // Add metadata
    return result.memories.map(memory => ({
      ...memory,
      thread: threadName,
      timestamp: new Date().toISOString()
    }))
  } catch (error) {
    console.error('Failed to extract memories with Claude:', error)
    throw new Error('Failed to extract memories from conversation')
  }
}

/**
 * Get model name and pricing info
 */
export function getModelInfo(modelKey) {
  const models = {
    'claude-haiku': {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      cost: '$1 / MTok in, $5 / MTok out',
      costWithCache: 'same (system prompt is too short to be cached)',
      description: 'Cheapest current Claude model; ~2.5x cheaper input / 2x cheaper output than GPT-4o'
    },
    'claude-sonnet': {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      cost: '$2 / MTok in, $10 / MTok out',
      costWithCache: 'same (system prompt is too short to be cached)',
      description: 'More capable than Haiku; still cheaper than GPT-4o on input'
    }
  }

  return models[modelKey] || models['claude-haiku']
}

// answerFromMemories' model ends with this line when the memories don't
// fully answer the question, followed by a short question for Sarah that
// would fill the gap - the search bar asks it back. Alone (no answer
// before it) it's a complete miss.
const ASK_BACK = 'ASK_BACK:'

/**
 * Answer a question from the brain's own memories (retrieval-augmented):
 * the caller does the semantic retrieval, this only turns the retrieved
 * memories into a short answer. Citations come back as memory ids so the
 * UI can link each one to its node.
 */
export async function answerFromMemories(question, memories) {
  const client = getAnthropic()
  if (!client) {
    throw new Error('Anthropic API key not configured')
  }

  const memoryBlock = memories
    .map(m => `<memory id="${m.id}" date="${m.timestamp || 'unknown'}" categories="${m.categories.join(', ')}">\n${m.title}\n${m.content}\n</memory>`)
    .join('\n')

  const response = await client.beta.messages.create({
    model: config.answerModel,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `You answer questions about ${ownerName()} using only the memories provided from their personal knowledge base.
Write 2-4 short sentences in second person ("You've said..."), plain text, no markdown.
Cite the memories you rely on inline as [id] using their exact id attribute.
Never guess or speculate from hints ("that might suggest...").
If the memories only partly answer the question, give what they do say, then end with a final line: ${ASK_BACK} <one short, direct question to ${ownerName()}, in second person, that would fill the gap - e.g. "Where are you originally from?">
If they don't answer it at all, reply with only that ${ASK_BACK} line.`,
    messages: [{
      role: 'user',
      content: `<memories>\n${memoryBlock}\n</memories>\n\nQuestion: ${question}`
    }]
  })

  if (response.stop_reason === 'refusal') {
    return { answer: null, citedIds: [], askBack: null }
  }

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  const split = text.indexOf(ASK_BACK)
  const askBack = split === -1 ? null : text.slice(split + ASK_BACK.length).trim() || null
  const answer = (split === -1 ? text : text.slice(0, split)).trim()
  if (!answer) {
    return { answer: null, citedIds: [], askBack }
  }
  const knownIds = new Set(memories.map(m => m.id))
  const citedIds = [...new Set([...answer.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]))]
    .filter(id => knownIds.has(id))

  return { answer, citedIds, askBack }
}

/**
 * Write the Stats page's weekly digest: a short, warm recap of the week's
 * memories. Only ever called from the manual "Write my weekly digest"
 * button - never automatically (see docs/COST.md).
 */
export async function writeWeeklyDigest(memories) {
  const client = getAnthropic()
  if (!client) {
    throw new Error('Anthropic API key not configured')
  }

  const memoryBlock = memories
    .map(m => `<memory date="${m.timestamp}" categories="${m.categories.join(', ')}">\n${m.title}\n${m.content}\n</memory>`)
    .join('\n')

  const response = await client.beta.messages.create({
    model: config.answerModel,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `You write a short recap for ${ownerName()} of what went into their personal knowledge base since their last recap (at most the past week).
Write 3-5 sentences in second person ("Lately you..."), plain text, no markdown or lists.
Pick out the main themes, anything that seems new for them, and one fun observation. Base it only on the memories given.`,
    messages: [{
      role: 'user',
      content: `<memories>\n${memoryBlock}\n</memories>`
    }]
  })

  if (response.stop_reason === 'refusal') return null
  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
}

/**
 * Duplicate check for the Tidy up card: judges a small batch of memory
 * pairs as the same idea or not. Only ever called from the manual "Check
 * with Claude" button (server/services/duplicates.js) - never
 * automatically (see COST.md). Structured output guarantees the JSON shape.
 */
export async function judgeDuplicatePairs(pairs) {
  const client = getAnthropic()
  if (!client) {
    throw new Error('Anthropic API key not configured')
  }

  const pairBlock = pairs
    .map(p => `<pair index="${p.index}">\nA: ${p.a.title} - ${p.a.content}\nB: ${p.b.title} - ${p.b.content}\n</pair>`)
    .join('\n')

  const response = await client.beta.messages.create({
    model: config.answerModel,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            verdicts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  same: { type: 'boolean' },
                  reason: { type: 'string' }
                },
                required: ['index', 'same', 'reason'],
                additionalProperties: false
              }
            }
          },
          required: ['verdicts'],
          additionalProperties: false
        }
      }
    },
    system: `You review pairs of memories from ${ownerPossessive()} personal knowledge base and decide whether each pair should be merged into one memory.
Each memory is meant to hold one idea. Mark a pair "same" only if both memories express the same underlying idea at the same level of detail, so keeping both adds nothing.
Mark it "different" when:
- they share a topic but say different things: a general interest and a specific application of it, two sibling applications, or two different questions about the same subject;
- one names something specific the other doesn't - an algorithm, tool, product, paper, person, place or other proper noun (e.g. "interested in Shor's algorithm" vs "worried quantum computers threaten encryption"). ${ownerName()} wants named specifics kept as their own memories.
Give a one-sentence reason for each verdict, addressed to ${ownerName()} in second person.`,
    messages: [{
      role: 'user',
      content: pairBlock
    }]
  })

  console.log(`📊 Duplicate check token usage:`, {
    pairs: pairs.length,
    input: response.usage.input_tokens,
    output: response.usage.output_tokens
  })
  if (response.stop_reason === 'refusal') return []
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  return JSON.parse(text).verdicts
}

/**
 * The brain's questions (Home's curious card and Reflect): writes a few
 * short questions on the theme Sarah picked (a category, keyword, typed
 * topic or two categories to connect), or across a few random categories
 * ("Surprise me"). Picking the memories to send is free and
 * local (server/services/curiosity.js); this only turns them into
 * questions. Only ever called from a button - never automatically (see
 * COST.md). Runs on QUESTION_MODEL (Sonnet 5.5 by default); Haiku takes
 * neither `effort` nor the server-side refusal fallback, so those are only
 * sent to other models.
 */
export async function writeCuriousQuestions({ memories, topic, surpriseCategories, categoryNames, pastQuestions, count, wildcard = false }) {
  const client = getAnthropic()
  if (!client) {
    throw new Error('Anthropic API key not configured')
  }

  const memoryBlock = memories.length > 0
    ? memories
      .map(m => `<m id="${m.id}" date="${m.date}" categories="${m.categories.join(', ')}"${m.looseEnd ? ' maybe_unfinished="true"' : ''}>${m.content}</m>`)
      .join('\n')
    : '(none yet)'
  const pastBlock = pastQuestions.length > 0
    ? pastQuestions.map(q => `<asked status="${q.status}">${q.question}</asked>`).join('\n')
    : '(none yet)'

  const theme = topic
    ? `Theme, chosen by ${ownerName()}: ${topic}.`
    : `${ownerName()} asked to be surprised. Spread the questions across: ${surpriseCategories.join('; ')}. Set "category" to the one each is mostly about.${wildcard ? ' Make one of the first three a playful wildcard from nowhere (a taste, a habit, a childhood memory, a small joy) with no memory_ids and "category" "none".' : ''}`

  const isHaiku = config.questionModel.includes('haiku')
  const request = {
    model: config.questionModel,
    max_tokens: 2000,
    output_config: {
      ...(isHaiku ? {} : { effort: 'low' }),
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  why: { type: 'string' },
                  category: { type: 'string', enum: [...categoryNames, 'none'] },
                  memory_ids: { type: 'array', items: { type: 'string' } }
                },
                required: ['question', 'why', 'category', 'memory_ids'],
                additionalProperties: false
              }
            }
          },
          required: ['questions'],
          additionalProperties: false
        }
      }
    },
    system: `You are ${ownerPossessive()} personal knowledge base, and you're curious about them. Write ${count} questions for them, best first.

${theme}

Keep each question short - one sentence, ideally under 20 words - and easy to answer in a line or two. Ask like a curious friend: specific, warm, sometimes playful, and gentle about health, money and relationships. A question can build on one memory or connect a few when the link is real and interesting. Mix up how they're phrased; don't open every one with what you already know, and don't offer either/or options ("A, or is it B?"). Memories marked maybe_unfinished are good for "what happened next?".

Don't ask what the memories already answer, and don't repeat anything in already_asked. A "skipped" or "dismissed" question means leave that subject alone for now.

For each question, list the memories it builds on in memory_ids, and write "why": one short sentence to ${ownerName()} saying what prompted it.`,
    messages: [{
      role: 'user',
      content: `<already_asked>\n${pastBlock}\n</already_asked>\n\n<memories>\n${memoryBlock}\n</memories>`
    }]
  }
  const response = isHaiku
    ? await client.messages.create(request)
    : await client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })

  console.log(`📊 Curious questions token usage:`, {
    model: config.questionModel,
    memories: memories.length,
    input: response.usage.input_tokens,
    output: response.usage.output_tokens
  })
  if (response.stop_reason === 'refusal') return []
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
  return JSON.parse(text).questions
}
