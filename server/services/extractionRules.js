// Shared "what is one memory" rules for both extraction prompts
// (anthropic.js and openai.js), so the two can't drift apart. Sarah wants
// many small one-idea nodes rather than one big multi-topic paragraph: a
// node's size in the 3D view is its connection count, so a node covering
// several topics links to all of them and looks important for the wrong
// reason. See docs/MEMORY_PIPELINE.md.
export const EXTRACTION_RULES = `Extract distinct, atomic pieces of information - ONE idea per memory.
People often pack several ideas into a single sentence ("X, and Y, because
Z"); split those into separate memories. Always prefer several small
memories over one memory that covers several things. If the input already
looks like a single saved memory, keep it as one unless it clearly contains
more than one idea.

Each memory should be:
- A single fact, preference, interest, decision, or piece of context
- Clear and specific
- Standalone (makes sense without reading any other memory)

Example input:
"I just started as a PM at Acme, and I've been learning Rust on weekends
because I want to build a CLI tool for my side project."

Good - three memories, one short sentence each:
- "Started a new job as a product manager at Acme."
- "Learning Rust on weekends."
- "Building a command-line tool in Rust as a side project."

Bad - one memory covering everything:
- "Recently started as a PM at Acme. Outside work, has been learning Rust on
  weekends, motivated by wanting to build a CLI tool for a side project."

For each memory, provide:
1. A short title (2-5 words)
2. A description that is ONE plain sentence, ideally under 25 words. Use a
   second sentence only if the first can't be understood without it. No
   padding, no commentary on why it matters. The person the memories are
   about can stay implicit ("Learning Rust on weekends."), but name any
   other subject explicitly ("The AI Brain project uses SQLite.", not "It
   uses SQLite.") so the memory stands alone.`

// Item 5 of both extraction prompts: which keywords are entities. Costs a
// few output tokens per memory, no extra call. See ENTITY_KINDS in
// taxonomy.js and docs/MEMORY_PIPELINE.md.
export const ENTITY_RULE = `5. "entities": the keywords from item 4 that name one specific, real thing,
   each with its kind:
   - "person": a named person ("Maya", "Priya")
   - "place": a named place ("London", "Mexico", "Leeds")
   - "organisation": a company, employer, university, club or platform
     ("Acme Bank", "Leeds University", "Etsy")
   - "project": something the person themselves builds or runs, like their
     own app, shop or side project ("Neuroverse", "my-print-shop")
   Generic concepts are NOT entities, even when capitalised: "UI design",
   "AI", "machine learning", "best friend", "travel photography". Nor are
   tools, programming languages, books or podcasts ("Python", "Docker",
   "East of Eden"). Leave
   "entities" empty when no keyword names a specific thing. Every entity
   name must exactly match one of that memory's keywords.`

export const ENTITY_JSON_EXAMPLE = `"entities": [{ "name": "keyword1", "kind": "organisation" }]`
