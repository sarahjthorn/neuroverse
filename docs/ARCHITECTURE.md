# How Neuroverse works

How the pieces fit together, and the design decisions that still hold.
Rewritten 2026-10-07 from the old architecture, project-summary,
design-decisions, relatedness, hierarchy and UI-roadmap docs, which
described the first JSON/React Flow version or were finished plans. Their
full text is in git history (`git log --diff-filter=D -- docs/`).

For the step-by-step path of one memory, see
[MEMORY_PIPELINE.md](MEMORY_PIPELINE.md). For speed at 10,000 memories, see
[FEATURES_AND_SCALING.md](FEATURES_AND_SCALING.md). For what costs money,
see [COST.md](../COST.md).

## The pieces

```
Claude (Desktop, Code, claude.ai)          Browser
        │ MCP over stdio                      │ http://localhost:3000
        ▼                                     ▼
mcp-server/index.js  ── HTTP ──►  Express API (server/, port 3001)  ◄── Vite + React (src/)
                                         │
                     ┌───────────────────┼────────────────────┐
                     ▼                   ▼                    ▼
              Anthropic API         OpenAI API          SQLite data/brain.db
          (extraction, Ask,      (embeddings only)     + sqlite-vec (vec0)
           questions, digest)                          + FTS5 keyword index
```

- **Frontend** (`src/`): React + Vite. The Explore view is a 3D force graph
  (`BrainGraph3D.jsx`, three.js via `3d-force-graph`) that also sits
  behind Home and Memories as a backdrop. Tabs are listed in `src/tabs.js`:
  Home, Explore, Memories and Reflect always, others (Wishlist and Axon today) are
  switched on from the "+" in the nav. The About page (`AboutView.jsx`,
  words in `src/about.js`) isn't a tab: it opens from the ⓘ button next to
  the theme toggle, and links each of its questions to the memories tagged
  with that question's keywords.
- **Server** (`server/`): Express. Routes in `server/routes/`, logic in
  `server/services/`. Settings come from `.env` (`server/config.js`).
- **MCP server** (`mcp-server/index.js`): a thin wrapper that turns Claude's
  tool calls into HTTP calls to the API. It holds no keys and no data. Its
  `INSTRUCTIONS` string tells every connected Claude to save proactively.
- **Storage**: one SQLite file, `data/brain.db` (WAL mode, better-sqlite3).
  `BRAIN_DATA_DIR` moves the data folder and `BRAIN_ENV_FILE` swaps the
  `.env`; the smoke tests (`npm test`) use both to run against an empty
  database with no API keys.

## Data model

| Table | Holds |
|---|---|
| `nodes` | One row per memory: title, content, timestamp (UTC, set at creation, never changed by edits), embedding |
| `edges` | Links between memories: `strength` (composite score), raw `embedding_similarity`, `type` (`strong` / `moderate` / `manual`) |
| `categories`, `node_categories` | The fixed 12 categories (`CANONICAL_CATEGORIES` in `db.js`); a memory can have several |
| `category_adjacency` | Hand-set boosts for pairs of categories that are close (e.g. Career–Project) |
| `keywords`, `node_keywords`, `keyword_aliases` | The keyword vocabulary, with an entity `kind` (person / place / organisation / project) and old names that map to a keyword |
| `node_embeddings` | sqlite-vec `vec0` index for nearest-neighbour search |
| `node_fts` | FTS5 index for exact keyword (BM25) search, kept in sync by triggers |
| `duplicate_reviews` | Claude's verdicts on possible duplicate pairs |
| `digests`, questions tables | Reflect's catch-up digests and the brain's curious questions |
| `wishlist_items` | The Wishlist tab |
| `inbox_items`, `xp_events` | Axon's daily options and ideas on the Axon tab (impact / effort / minutes, one-click start link, done / later / rejected with notes) and one XP row per thing done (`server/routes/inbox.js`) |
| `settings` | Owner name, identity star, enabled tabs, intro completed |

`nodes.thread` only marks the memories First Light created; the old
`parent_node_id` hierarchy column was dropped on 2026-10-07 (see "Removed"
below).

## How memories get linked

For each new memory, the 30 nearest neighbours by embedding are scored by
`computeCompositeScore()` in `server/services/scoring.js`:

- **Embedding similarity** is the base. Below `MIN_EMBEDDING_FLOOR` (0.35)
  the pair is never linked, however many tags it shares.
- **Keyword overlap** adds up to `KEYWORD_BOOST_WEIGHT` (0.18) × Jaccard.
- **Shared or adjacent categories** add up to `CATEGORY_BOOST_CAP` (0.25).
- An edge is saved when the score is above **0.6**.

The "Recalculate relationships" button re-runs this over the whole graph on
click (`server/services/rescoring.js`). It's free but slow at large sizes.

## Search and Ask

`GET /api/search` runs a vec0 nearest-neighbour search and an FTS5 keyword
search, merged by reciprocal rank fusion (`hybridSearch()` in
`server/routes/search.js`). Exact keyword hits are never dropped for low
similarity, and if embedding fails it falls back to keyword-only. Ask
(Enter on Home) sends the top 8 matches to Claude, which answers with
citations that light up in 3D.

## Design decisions that still hold

- **One idea per memory, one sentence.** A star's size is its number of
  links, so a memory covering four topics would look important for the
  wrong reason. Enforced in the extraction prompt, the MCP schema and
  CLAUDE.md, and checked for free on memories Claude writes itself (see
  MEMORY_PIPELINE.md).
- **A fixed list of 12 categories.** Career, Personal, Health, Research,
  Travel, Financial, Project, Interests, Technical, Relationships,
  Preferences, Mind (added 2026-10-07 for mood and headspace, so Health is
  just the body). New ones go at the end of `CANONICAL_CATEGORIES` and are
  added to existing brains on the next start. New categories the model proposes go to review, never
  straight in. Projects are keywords (`sarahs-brain`), not categories, and
  there's no "Future" category (that's a timeframe, not a topic).
- **Keywords are cheap, categories are structural.** A new keyword is added
  automatically unless it matches an existing one at embedding similarity
  ≥ 0.72 (`KEYWORD_MATCH_THRESHOLD`, measured on real data: true
  near-duplicates scored 0.75–0.86, different terms 0.67 and below).
- **Shared categories nudge, never force.** The category boost is capped so
  it can't link two otherwise unrelated memories. Orphans are fine.
- **Suggest, always confirm.** Nothing merges, deletes or re-parents on its
  own. Tidy up suggests duplicates; you click to merge.
- **What you set by hand is ground truth.** Automated passes never change or
  delete a `manual` edge or anything else set by hand (e.g. a keyword's
  entity kind).
- **Duplicates use raw similarity, not the composite score.** The composite
  saturates at 1.0 for any two memories on the same topic. ≥ 0.85 raw
  similarity is flagged, and "Check with Claude" judges subtler pairs.
- **Paid calls run on a button where possible**, and every model input has a
  fixed maximum size, so cost grows with how much you add, not with how big
  the brain is.
- **Timestamps mean "when it was recorded"**, not when the event happened.
  "Went to Japan last October" gets today's date.

## Removed

The big ones:

- **2D graph, solar-system view and Organize tab**: deleted 2026-10-07. They
  held the earlier sidebar tools (node tree, drag-to-reparent,
  drag-to-connect, bulk re-tag, orphan finder, keyword browser, timeline
  list).
- **Parent/child hierarchy**: built 2026-09-17 (single parent per node, cycle
  guard, similarity between a parent and its descendants dampened × 0.5),
  its UI removed 2026-09-30, and the column and dampening code deleted
  2026-10-07.
- **Threads**: a free-text "thread" per memory, removed from the UI the same
  day.
- **Prompt caching**: `cache_control` is set on the extraction system
  prompt, but it never activates. Claude only caches blocks over 1,024–4,096
  tokens depending on the model, and the prompt is far shorter. Padding it to
  qualify isn't worth it.
