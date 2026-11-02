#!/usr/bin/env node

/**
 * AI Brain MCP Server
 * 
 * This MCP server allows Claude Desktop to interact with your AI Brain.
 * Claude can store memories, search for them, and explore relationships
 * automatically during conversations.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import axios from 'axios'

// Configuration
const API_BASE_URL = process.env.AI_BRAIN_API_URL || 'http://localhost:3001/api'

// Kept in sync by hand with server/services/db.js's CANONICAL_CATEGORIES -
// this process talks to the API over HTTP rather than importing server
// internals, so it can't read the list directly.
const CATEGORIES = [
  'Career', 'Personal', 'Health', 'Research', 'Travel', 'Financial',
  'Project', 'Interests', 'Technical', 'Relationships', 'Preferences',
  'Mind'
]

// Which keywords name one specific real thing - the server stores the kind
// on the keyword (person / place / organisation / project).
const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Exactly one of this memory\'s keywords' },
    kind: { type: 'string', enum: ['person', 'place', 'organisation', 'project'] },
  },
  required: ['name', 'kind'],
}
// The tools have to stand on their own: not every Claude app shows the
// server's INSTRUCTIONS, but every app sends the tool descriptions. These
// descriptions are the source of truth for "how"; INSTRUCTIONS only points
// at them (see "Keeping the MCP server in sync" in CLAUDE.md).
const CATEGORY_GUIDE = 'Every category that genuinely applies - three or more is fine, don\'t stop at one or two out of habit. Career: job, role, job search. Personal: name, location, family, life events. Health: the body - fitness, sleep, diet, skincare. Mind: mood, stress, confidence, feelings, mental health, beliefs, self-image (feeling busy or behind is Mind). Research: topics she\'s curious about, even from one question (store the topic, not the news event). Travel: trips and travel habits. Financial: money goals, budgeting, anything about cost. Project: what she\'s building. Interests: hobbies, recurring topics. Technical: skills, tools, technical opinions. Relationships: people and organisations she mentions. Preferences: likes, dislikes, working style. Opinions and decisions go under whichever topical category fits. A project is tagged with a keyword (its name), not its own category.'
const KEYWORDS_GUIDE = 'A few specific terms that connect related memories. Reuse the brain\'s existing keywords where they fit (get_brain_overview lists them) instead of near-duplicates, and add the project name if it\'s about a specific project.'

const OPTION_LINK_DESCRIPTION = 'Shop page for this exact product - always include one. Find it with web search: prefer the brand\'s UK page, else a UK retailer; if the site blocks bots, use another retailer; never scrape search engines.'
const ENTITIES_DESCRIPTION = 'Optional: the keywords that name one specific, real thing, with their kind - person ("Priya"), place ("London"), organisation (employer, company, club, platform: "LSEG", "Etsy") or project (something the user builds or runs: "Neuroverse"). Not generic concepts, tools, languages or books. Leave out if none.'

// Sent to the client at connect time; Claude apps that support MCP server
// instructions add this to every conversation the server is connected to.
// Deliberately short: each tool's description (CATEGORY_GUIDE, KEYWORDS_GUIDE,
// the wishlist and inbox rules) carries the "how", so don't restate it here.
// Keep those descriptions in step with CLAUDE.md (see "Keeping the MCP
// server in sync" in CLAUDE.md).
const INSTRUCTIONS = `This is Sarah's personal memory brain. Use it in every conversation, silently and without asking first: whenever she reveals a durable fact, or asks a question that shows what she's curious about, save it (default to saving; skip only the clearly trivial). Each memory is one plain sentence about one idea; use store_memories whenever there are two or more. Follow each tool's description for categories, keywords, entities, the wishlist, and Axon's daily inbox options. If the brain is offline, carry on and don't dwell on it.`

// Create MCP server
const server = new Server(
  {
    name: 'ai-brain',
    version: '1.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: INSTRUCTIONS,
  }
)

const WISHLIST_STATUSES = ['idea', 'researching', 'ready', 'bought', 'dropped']
// Kept in step with server/routes/inbox.js.
const INBOX_STATUSES = ['new', 'done', 'later', 'rejected', 'expired']
const START_KINDS = ['claude_doc', 'email', 'url', 'rota', 'github', 'claude_chat']
const INBOX_KINDS = ['option', 'idea']

// Helper function to make API calls
async function callAPI(endpoint, method = 'GET', data = null) {
  try {
    const config = {
      method,
      url: `${API_BASE_URL}${endpoint}`,
      headers: { 'Content-Type': 'application/json' },
    }
    
    if (data) {
      config.data = data
    }
    
    const response = await axios(config)
    return response.data
  } catch (error) {
    if (error.response) {
      const { error: summary, message } = error.response.data || {}
      const apiError = new Error(`API Error: ${[summary, message].filter(Boolean).join(' - ') || error.message}`)
      apiError.status = error.response.status
      apiError.data = error.response.data
      throw apiError
    }
    throw new Error(`Network Error: ${error.message}`)
  }
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'store_memory',
        description: 'Store a new memory about Sarah in her brain. Call this proactively and silently - never ask first or announce it - whenever she reveals a durable fact: a preference, skill, project, goal, relationship, opinion, decision, habit or feeling. It doesn\'t need an explicit "I like X": a single targeted question is itself a signal of what she\'s curious about. Default to saving; skip only clearly trivial, one-off or already-stored things. Before replying, check whether anything from this exchange should have been saved and hasn\'t been. For two or more memories at once, use store_memories instead. If the reply lists something under "Please check", fix it with update_memory. If the brain is offline, carry on with the conversation and don\'t dwell on it.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short title for the memory (2-5 words)',
            },
            content: {
              type: 'string',
              description: 'One plain sentence stating a single idea (ideally under 25 words). If you have several ideas, call store_memory once per idea instead of combining them - many small memories beat one long one. Name any subject other than the user explicitly (e.g. the project name) so it stands alone.',
            },
            categories: {
              type: 'array',
              items: { type: 'string', enum: CATEGORIES },
              description: CATEGORY_GUIDE,
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: KEYWORDS_GUIDE,
            },
            entities: {
              type: 'array',
              items: ENTITY_SCHEMA,
              description: ENTITIES_DESCRIPTION,
            },
          },
          required: ['title', 'content', 'categories', 'keywords'],
        },
      },
      {
        name: 'store_memories',
        description: 'Store several memories about Sarah in one call - use this instead of repeated store_memory calls whenever there are two or more to save (several ideas in one message, or catching up on a whole conversation). Much faster than one call each. Same rules as store_memory (proactive and silent, default to saving, each memory one idea in one plain sentence, fix anything under "Please check" with update_memory). Before a catch-up, check search_memories so you don\'t re-save what is already stored.',
        inputSchema: {
          type: 'object',
          properties: {
            memories: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Short title (2-5 words)' },
                  content: { type: 'string', description: 'One plain sentence stating a single idea (ideally under 25 words). Name any subject other than the user explicitly.' },
                  categories: { type: 'array', items: { type: 'string', enum: CATEGORIES }, description: 'Same guide as store_memory\'s categories' },
                  keywords: { type: 'array', items: { type: 'string' }, description: 'Same guide as store_memory\'s keywords' },
                  entities: { type: 'array', items: ENTITY_SCHEMA, description: ENTITIES_DESCRIPTION },
                },
                required: ['title', 'content', 'categories', 'keywords'],
              },
            },
          },
          required: ['memories'],
        },
      },
      {
        name: 'search_memories',
        description: 'Search for memories in the knowledge graph using semantic similarity. Returns the most relevant memories based on the query.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (matches by meaning and by exact words, e.g. names)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 5,
            },
            category: {
              type: 'string',
              description: 'Optional: filter to memories that include this category',
              enum: CATEGORIES,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_related_memories',
        description: 'Get memories that are semantically related to a specific memory. Useful for exploring connections.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: {
              type: 'string',
              description: 'ID of the memory to find related memories for',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of related memories to return',
              default: 5,
            },
          },
          required: ['memoryId'],
        },
      },
      {
        name: 'get_brain_overview',
        description: 'A compact map of the brain: how many memories there are, the main people, places, organisations and projects, and per category the most-used keywords and latest titles. Small and fixed in size however big the brain grows. Use it to get oriented, answer broad "what do you know about me" questions, or see which keywords already exist before storing; then use search_memories to read the memories themselves.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Optional: zoom into one category for more of its keywords and titles',
              enum: CATEGORIES,
            },
          },
        },
      },
      {
        name: 'update_memory',
        description: 'Update an existing memory. Use this when information needs to be corrected or refined.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: {
              type: 'string',
              description: 'ID of the memory to update',
            },
            title: {
              type: 'string',
              description: 'Updated title',
            },
            content: {
              type: 'string',
              description: 'Updated content',
            },
            categories: {
              type: 'array',
              items: { type: 'string', enum: CATEGORIES },
              description: 'Updated categories (replaces the full set)',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Updated keywords (replaces the full set)',
            },
          },
          required: ['memoryId'],
        },
      },
      {
        name: 'delete_memory',
        description: 'Delete a memory from the knowledge graph. Use with caution.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: {
              type: 'string',
              description: 'ID of the memory to delete',
            },
          },
          required: ['memoryId'],
        },
      },
      {
        name: 'recalculate_relationships',
        description: 'Re-score relationships across the whole knowledge graph using the current relatedness formula (embedding similarity + keyword overlap + category adjacency). Local computation only - no API cost. Use when the user asks to refresh/recalculate connections, or after category/keyword taxonomy changes might have made old edges stale. Never call this proactively or automatically - only when explicitly asked.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'add_wishlist_item',
        description: 'Add something Sarah is thinking about buying to her wishlist, or record another mention of an item already on it (same name = same item: the mention count goes up and the note is appended). Call this proactively whenever she mentions wanting, considering, comparing or researching a product - no need to ask. Use list_wishlist with a query first if unsure of the existing name. If the reply says it looks like an existing item, re-call with that item\'s exact name, or with force: true if it is genuinely different. She likes to take her time, so never nudge her to buy - just keep the list accurate. If the reason she wants it says something about her, also store_memory.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Short name for the need, not a brand, unless she is set on that exact thing. Ask: would a different brand or model still count as getting it? If yes, name the need ("Fitness watch" while she compares Garmin and Apple Watch, "Face moisturiser") and put brands/models in option. If no, be specific ("Glastonbury 2027 ticket").',
            },
            categories: {
              type: 'array',
              items: { type: 'string', enum: CATEGORIES },
              description: 'One or more categories it belongs to, same as for memories (e.g. a running watch: Health; a festival ticket: Interests, Travel)',
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific terms that link it to related memories - reuse existing brain keywords where they fit (e.g. running, half marathon, garmin)',
            },
            why: {
              type: 'string',
              description: 'Why she wants it, in one sentence, close to her own words',
            },
            price: {
              type: 'string',
              description: 'Rough price or budget if mentioned, e.g. "~£350"',
            },
            note: {
              type: 'string',
              description: 'What was said about it this time (one sentence) - builds up a history of her thinking',
            },
            option: {
              type: 'string',
              description: 'A specific model/variant being considered, e.g. "Forerunner 265 - AMOLED, ~£350"',
            },
            optionDetails: {
              type: 'array',
              description: 'The specific products being weighed against each other, for the page\'s side-by-side decision view. Matched by name: new names are added, given fields replace old ones.',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Product name, e.g. "Garmin Forerunner 570"' },
                  summary: { type: 'string', description: 'What it is in a few words, e.g. "Neutral daily trainer"' },
                  price: { type: 'string', description: 'Rough price, e.g. "~£400"' },
                  link: { type: 'string', description: OPTION_LINK_DESCRIPTION },
                  pros: { type: 'array', items: { type: 'string' }, description: '2-4 short pros, judged against what she wants it for' },
                  cons: { type: 'array', items: { type: 'string' }, description: '2-4 short cons, judged the same way' },
                  ruledOut: { type: 'boolean', description: 'She has ruled this one out' },
                },
                required: ['text'],
              },
            },
            link: {
              type: 'string',
              description: 'Product page URL, when one came up (e.g. from a web search or a link she shared). Its product photo is pulled in for the wishlist page if the item has none yet. Not for general items or experiences - those show as coloured tiles.',
            },
            imageUrl: {
              type: 'string',
              description: 'A direct image URL for the product, only if its product page has no usable photo. Replaces any existing photo. Not for general items or experiences.',
            },
            mentionedAt: {
              type: 'string',
              description: 'ISO date of the mention, only when backfilling from an older conversation; omit for now',
            },
            force: {
              type: 'boolean',
              description: 'Add as a new item even though it looks like an existing one - only after a possible-duplicate reply, when it really is something different',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'list_wishlist',
        description: 'List Sarah\'s wishlist: what she is thinking about buying, how long each item has been on the list, how often it has come up, and its status. Use it when she asks about her wishlist or what to buy, or to check an item\'s existing name before adding it.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional: words to look for in names, keywords, categories, reasons, options and notes (e.g. "garmin watch running") - use it to check whether something is already on the list',
            },
            status: {
              type: 'string',
              enum: WISHLIST_STATUSES,
              description: 'Optional: only items with this status. By default bought and dropped items are left out (unless a query is given).',
            },
          },
        },
      },
      {
        name: 'update_wishlist_item',
        description: 'Change a wishlist item: move its status (idea -> researching -> ready -> bought, or dropped; ready means she has decided and will buy it with her next paycheck, so rename it to the exact model then), fix its details, or add a note/option without counting it as a new mention. Use when she says she bought something, went off it, or narrowed down her choice. When moving it to ready, use chooseOption if she picked one of the options, and include link: the shop page for the exact product she chose (ask her if unsure) - that is where its photo comes from.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Item id from list_wishlist or add_wishlist_item' },
            status: { type: 'string', enum: WISHLIST_STATUSES },
            name: { type: 'string' },
            categories: { type: 'array', items: { type: 'string', enum: CATEGORIES }, description: 'Replaces the full set' },
            keywords: { type: 'array', items: { type: 'string' }, description: 'Replaces the full set' },
            why: { type: 'string' },
            price: { type: 'string' },
            note: { type: 'string', description: 'A note to append' },
            option: { type: 'string', description: 'A specific model/variant to append' },
            optionDetails: {
              type: 'array',
              description: 'The specific products being weighed against each other, for the page\'s side-by-side decision view. Matched by name: new names are added, given fields replace old ones.',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Product name, e.g. "Garmin Forerunner 570"' },
                  summary: { type: 'string', description: 'What it is in a few words, e.g. "Neutral daily trainer"' },
                  price: { type: 'string', description: 'Rough price, e.g. "~£400"' },
                  link: { type: 'string', description: OPTION_LINK_DESCRIPTION },
                  pros: { type: 'array', items: { type: 'string' }, description: '2-4 short pros, judged against what she wants it for' },
                  cons: { type: 'array', items: { type: 'string' }, description: '2-4 short cons, judged the same way' },
                  ruledOut: { type: 'boolean', description: 'She has ruled this one out' },
                },
                required: ['text'],
              },
            },
            chooseOption: { type: 'string', description: 'Name of the option she has decided on: marks it chosen and moves the item to ready (its link becomes the item\'s link)' },
            removeOption: { type: 'string', description: 'Name of an option to delete' },
            link: { type: 'string', description: 'Product page URL - also pulls in its product photo if the item has none' },
            imageUrl: { type: 'string', description: 'A product page or direct image URL to use as the item\'s photo (replaces the current one)' },
          },
          required: ['id'],
        },
      },
      {
        name: 'add_inbox_items',
        description: 'Add options or ideas to Sarah\'s Axon inbox on Neuroverse\'s Axon tab. Only call this when she asks for something to go on her list, or when running an Axon job that says to - never to fill the list. Options (the default kind) are small concrete actions for today: each needs impact, effort and minutes so she can sort by what suits her energy, and ideally a start action (what one click opens); the morning plan uses expireOld: true so today\'s options replace yesterday\'s unanswered ones. Ideas (kind "idea") are new things worth doing that an independent critic recommended "do"; why is that recommendation in one or two plain lines. The server keeps at most 3 ideas a day and blocks any idea too similar to one from the last 90 days (reported back, not added). An open item with the same title is not added twice.',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: INBOX_KINDS, description: 'option (default): an action for today. idea: something new worth doing' },
                  title: { type: 'string', description: 'The action, verb first, e.g. "Draft a catch-up email to a former colleague"' },
                  why: { type: 'string', description: 'One line on why this one, pointing at her goals or memories' },
                  category: { type: 'string', enum: CATEGORIES },
                  impact: { type: 'integer', minimum: 1, maximum: 3 },
                  effort: { type: 'integer', minimum: 1, maximum: 3 },
                  minutes: { type: 'integer', description: 'Rough time it takes' },
                  series: { type: 'string', description: 'If it is one step of a longer piece of work, the series name (e.g. "Why Anthropic? answer"). Series steps ask for a note when done.' },
                  seriesStep: { type: 'string', description: 'e.g. "draft 1 of ~3"' },
                  needsNote: { type: 'boolean', description: 'Ask what she did when it is marked done (default: true for series steps)' },
                  startKind: { type: 'string', enum: START_KINDS, description: 'What clicking it opens' },
                  startUrl: { type: 'string', description: 'The link it opens: the Claude Doc, a Gmail compose link with recipient and subject filled, the article, the Rota, the PR' },
                  startLabel: { type: 'string', description: 'Button text, e.g. "Open draft", "Write email"' },
                },
                required: ['title'],
              },
            },
            source: { type: 'string', description: 'Who added them, e.g. "axon-morning-plan", "axon-explore"' },
            createdBy: { type: 'string', description: 'The Claude session id that produced them, if known' },
            expireOld: { type: 'boolean', description: 'Mark this source\'s unanswered options from earlier days as expired' },
          },
          required: ['items'],
        },
      },
      {
        name: 'list_inbox',
        description: 'List Sarah\'s Axon inbox: today\'s open options (new, or "not today"), what she has done or turned down in the last week with her notes and reasons, plus her XP, level and discipline (days with a win out of the last 14). Use it before suggesting what to do next, and to find an item\'s id.',
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['recent', 'pending', 'all'], description: 'recent (default): open items plus the last week\'s done and rejected ones; pending: only open items; all: everything ever' },
          },
        },
      },
      {
        name: 'update_inbox_item',
        description: 'Record what Sarah did with one of Axon\'s daily options. Call this proactively whenever she mentions doing, skipping or not wanting one ("sent the email to my supervisor", "did the dishes") - list_inbox finds the id. done: with a short note of what she did or where she got to (required for series steps, so the next step can build on it). later: "not today". rejected: "not for me", with her reason if given. For ideas: done = yes, do it; later = park; rejected = drop. Done adds XP (not for ideas). Never nag her about options she hasn\'t done. why: only for an Axon job that has rethought an idea (a deep-think rerun), to replace its recommendation text. Steering deep-think: when she says what Axon should think about next ("keep going on the master\'s", "do the ISA one next"), save it as note "next (<today and the time now, e.g. 28 Oct 16:40>): <keep going | the decision she picked>" on that deep-think idea (the idea whose link is that Doc), with no status, so the next night\'s run picks it up.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Item id from list_inbox' },
            status: { type: 'string', enum: INBOX_STATUSES },
            note: { type: 'string', description: 'What she did, or where she got to' },
            reason: { type: 'string', description: 'Why she turned it down' },
            why: { type: 'string', description: 'New recommendation text for an idea an Axon job has rethought' },
          },
          required: ['id'],
        },
      },
    ],
  }
})

const DAY_MS = 24 * 60 * 60 * 1000
const age = iso => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
  return days < 1 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

function formatWishlistItem(item) {
  const head = `**${item.name}** [${item.status}]${item.categories.length ? ` · ${item.categories.join(', ')}` : ''}${item.price ? ` · ${item.price}` : ''} (id: ${item.id})`
  const lines = [head]
  if (item.keywords.length) lines.push(`   Keywords: ${item.keywords.join(', ')}`)
  if (item.why) lines.push(`   Why: ${item.why}`)
  lines.push(`   First mentioned ${age(item.first_mentioned)}, mentioned ${item.mention_count}×, last ${age(item.last_mentioned)}`)
  for (const o of item.options) {
    const flags = [o.chosen && 'CHOSEN', o.ruledOut && 'ruled out', o.price].filter(Boolean).join(', ')
    lines.push(`   Option: ${o.text}${flags ? ` (${flags})` : ''}`)
    if (o.pros?.length) lines.push(`     + ${o.pros.join('; ')}`)
    if (o.cons?.length) lines.push(`     - ${o.cons.join('; ')}`)
  }
  if (item.notes.length) lines.push(`   Latest note: ${item.notes[item.notes.length - 1].text}`)
  if (item.link) lines.push(`   Link: ${item.link}`)
  lines.push(`   Photo: ${item.image_url ? 'yes' : 'none yet'}`)
  return lines.join('\n')
}

const dots = n => (n ? '●'.repeat(n) + '○'.repeat(3 - n) : '?')

function formatInboxItem(item) {
  const meta = [item.category, `impact ${dots(item.impact)}`, `effort ${dots(item.effort)}`, item.minutes && `${item.minutes} min`]
    .filter(Boolean).join(' · ')
  const lines = [`**${item.title}** [${item.kind === 'idea' ? 'idea, ' : ''}${item.status}] · ${meta} (id: ${item.id})`]
  if (item.repeat_of) lines.push(`   Blocked "${item.repeat_of}": ${Math.round(item.similarity * 100)}% similar to this one`)
  if (item.why) lines.push(`   Why: ${item.why}`)
  if (item.series) lines.push(`   Series: ${item.series}${item.series_step ? ` (${item.series_step})` : ''}${item.needs_note ? ' - asks for a note when done' : ''}`)
  if (item.start_url) lines.push(`   Starts with: ${item.start_label || item.start_kind || 'link'} ${item.start_url}`)
  if (item.source) lines.push(`   From: ${item.source}`)
  if (item.started_at) lines.push(`   Started ${age(item.started_at)}`)
  if (item.outcome_note) lines.push(`   What she did: ${item.outcome_note}`)
  if (item.reason) lines.push(`   Reason: ${item.reason}`)
  return lines.join('\n')
}

function formatInboxStats(stats) {
  const cats = Object.entries(stats.by_category).map(([c, xp]) => `${c} ${xp}`).join(', ')
  return `Level ${stats.level} (${stats.xp} XP${cats ? `: ${cats}` : ''}) · discipline ${stats.discipline.count} of ${stats.discipline.window} days`
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'store_memory':
      case 'store_memories': {
        // Stored exactly as written - no model rewrites or splits them - so
        // the reply carries the server's free checks (two ideas in one, too
        // long, ...) for Claude to fix with update_memory / store_memory.
        const memories = name === 'store_memory'
          ? [{ title: args.title, content: args.content, categories: args.categories, keywords: args.keywords, entities: args.entities }]
          : args.memories
        const { stored, reviews = [] } = await callAPI('/memories/batch', 'POST', { memories })
        const storedList = stored
          .map(n => `- ${n.title}: ${n.content} (${n.categories.join(', ')}) [id: ${n.id}]`)
          .join('\n')
        const reviewText = reviews.length === 0 ? '' :
          `\n\nPlease check:\n${reviews.map(r => `- ${r.title}: ${r.notes.join('; ')}`).join('\n')}`
        return {
          content: [
            {
              type: 'text',
              text: `✓ Stored ${stored.length} ${stored.length === 1 ? 'memory' : 'memories'}:\n${storedList}${reviewText}`,
            },
          ],
        }
      }

      case 'search_memories': {
        const params = new URLSearchParams({ q: args.query, limit: String(args.limit || 5) })
        if (args.category) params.set('category', args.category)

        const { results } = await callAPI(`/search?${params.toString()}`)
        const topResults = results.map(r => ({ node: r.node, similarity: r.similarity, keywordMatch: r.keywordMatch }))

        if (topResults.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No memories found matching your search.',
              },
            ],
          }
        }

        const matchLabel = r => {
          const parts = []
          if (r.similarity != null) parts.push(`Similarity: ${(r.similarity * 100).toFixed(1)}%`)
          if (r.keywordMatch) parts.push('exact keyword match')
          return parts.join(' · ')
        }

        const resultText = topResults
          .map((r, i) => {
            const node = r.node
            return `${i + 1}. **${node.data.title}** (${node.data.categories.join(', ')})\n   ${node.data.content}\n   Keywords: ${node.data.keywords.join(', ')}\n   ${matchLabel(r)}`
          })
          .join('\n\n')

        return {
          content: [
            {
              type: 'text',
              text: `Found ${topResults.length} relevant memories:\n\n${resultText}`,
            },
          ],
        }
      }

      case 'get_related_memories': {
        let found
        try {
          found = await callAPI(`/nodes/${encodeURIComponent(args.memoryId)}/related?limit=${args.limit || 5}`)
        } catch (error) {
          if (/not found/i.test(error.message)) {
            return { content: [{ type: 'text', text: 'Memory not found.' }] }
          }
          throw error
        }
        const { node: sourceNode, related } = found

        if (related.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No related memories found for "${sourceNode.title}".`,
              },
            ],
          }
        }

        const resultText = related
          .map((r, i) => {
            const node = r.node
            return `${i + 1}. **${node.data.title}** (${node.data.categories.join(', ')})\n   ${node.data.content}\n   Connection strength: ${(r.strength * 100).toFixed(1)}%`
          })
          .join('\n\n')

        return {
          content: [
            {
              type: 'text',
              text: `Memories related to "${sourceNode.title}":\n\n${resultText}`,
            },
          ],
        }
      }

      case 'get_brain_overview': {
        const query = args.category ? `?category=${encodeURIComponent(args.category)}` : ''
        const { total, entities, categories } = await callAPI(`/overview${query}`)

        if (total === 0) {
          return { content: [{ type: 'text', text: 'The brain is empty - no memories yet.' }] }
        }

        const counted = list => list.map(e => `${e.term} (${e.count})`).join(', ')
        const lines = [`${total} memories. Use search_memories to read any of them.`]

        const kindLabels = { person: 'People', place: 'Places', organisation: 'Organisations', project: 'Projects' }
        const entityLines = Object.entries(entities)
          .map(([kind, list]) => `${kindLabels[kind] || kind}: ${counted(list)}`)
        if (entityLines.length) lines.push('', ...entityLines)

        lines.push('')
        for (const c of categories) {
          const parts = [`${c.name} (${c.count})`]
          if (c.keywords.length) parts.push(`keywords: ${counted(c.keywords)}`)
          if (c.latest.length) parts.push(`latest: ${c.latest.map(t => `"${t}"`).join(', ')}`)
          lines.push(`- ${parts.join(' | ')}`)
        }
        if (args.category && categories.length === 0) lines.push(`No memories in ${args.category}.`)

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'update_memory': {
        const updates = {
          data: {},
        }

        if (args.title) updates.data.title = args.title
        if (args.content) updates.data.content = args.content
        if (args.categories) updates.data.categories = args.categories
        if (args.keywords) updates.data.keywords = args.keywords

        const updated = await callAPI(`/nodes/${args.memoryId}`, 'PATCH', updates)

        return {
          content: [
            {
              type: 'text',
              text: `✓ Memory updated successfully!\n\nTitle: ${updated.data.title}\nContent: ${updated.data.content}`,
            },
          ],
        }
      }

      case 'delete_memory': {
        await callAPI(`/nodes/${args.memoryId}`, 'DELETE')

        return {
          content: [
            {
              type: 'text',
              text: '✓ Memory deleted successfully.',
            },
          ],
        }
      }

      case 'recalculate_relationships': {
        const result = await callAPI('/graph/recalculate-relationships', 'POST')

        return {
          content: [
            {
              type: 'text',
              text: `✓ Relationships recalculated.\n\nScanned ${result.nodesScanned} memories, scored ${result.pairsScored} candidate pairs: ${result.created} new connection(s) created, ${result.updated} existing connection(s) refreshed, ${result.skipped} scored too low to link.`,
            },
          ],
        }
      }

      case 'add_wishlist_item': {
        let added
        try {
          added = await callAPI('/wishlist', 'POST', args)
        } catch (error) {
          if (error.status !== 409 || !error.data?.similar) throw error
          return {
            content: [
              {
                type: 'text',
                text: `Not added - "${args.name}" looks like it may already be on the wishlist:\n\n${error.data.similar.map(formatWishlistItem).join('\n\n')}\n\nIf it's the same thing, call add_wishlist_item again with that item's exact name (put the specific model in option). If it's genuinely different, call again with force: true.`,
              },
            ],
          }
        }
        const { created, item } = added
        return {
          content: [
            {
              type: 'text',
              text: `${created ? '✓ Added to wishlist' : `✓ Noted another mention (${item.mention_count}×)`}:\n${formatWishlistItem(item)}`,
            },
          ],
        }
      }

      case 'list_wishlist': {
        const { items } = await callAPI(`/wishlist${args.query ? `?q=${encodeURIComponent(args.query)}` : ''}`)
        const shown = args.status
          ? items.filter(i => i.status === args.status)
          : args.query ? items : items.filter(i => i.status !== 'bought' && i.status !== 'dropped')
        if (shown.length === 0) {
          const empty = args.query ? `Nothing on the wishlist matches "${args.query}".`
            : args.status ? `No wishlist items are ${args.status}.` : 'The wishlist is empty.'
          return { content: [{ type: 'text', text: empty }] }
        }
        return {
          content: [
            {
              type: 'text',
              text: `${shown.length} wishlist item(s):\n\n${shown.map(formatWishlistItem).join('\n\n')}`,
            },
          ],
        }
      }

      case 'update_wishlist_item': {
        const { id, ...changes } = args
        const { item } = await callAPI(`/wishlist/${encodeURIComponent(id)}`, 'PATCH', changes)
        return { content: [{ type: 'text', text: `✓ Wishlist item updated:\n${formatWishlistItem(item)}` }] }
      }

      case 'add_inbox_items': {
        const { created, existing, expired, repeats = [], over_cap: overCap = [] } = await callAPI('/inbox', 'POST', args)
        const parts = []
        if (created.length) parts.push(`✓ Added ${created.length} to the inbox:\n${created.map(formatInboxItem).join('\n')}`)
        if (existing.length) parts.push(`Already open (not added again):\n${existing.map(formatInboxItem).join('\n')}`)
        if (repeats.length) parts.push(`Blocked as repeats of an idea from the last 90 days (not added):\n${repeats.map(formatInboxItem).join('\n')}`)
        if (expired) parts.push(`Expired ${expired} unanswered option(s) from earlier days.`)
        if (overCap.length) parts.push(`Not added, today already has 3 ideas: ${overCap.join('; ')}`)
        return { content: [{ type: 'text', text: parts.join('\n\n') || 'Nothing added.' }] }
      }

      case 'list_inbox': {
        const status = args.scope === 'all' ? 'all' : args.scope === 'pending' ? 'pending' : 'recent'
        const { items, stats } = await callAPI(`/inbox?status=${status}`)
        const text = items.length
          ? `${items.length} inbox item(s):\n\n${items.map(formatInboxItem).join('\n\n')}`
          : 'The inbox is empty.'
        return { content: [{ type: 'text', text: `${text}\n\n${formatInboxStats(stats)}` }] }
      }

      case 'update_inbox_item': {
        const { id, ...changes } = args
        const { item, stats } = await callAPI(`/inbox/${encodeURIComponent(id)}`, 'PATCH', changes)
        return { content: [{ type: 'text', text: `✓ Inbox item updated:\n${formatInboxItem(item)}\n\n${formatInboxStats(stats)}` }] }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    }
  }
})

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('AI Brain MCP server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
