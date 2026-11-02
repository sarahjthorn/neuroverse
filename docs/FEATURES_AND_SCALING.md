# Features & scaling to 10,000 memories

Written 2026-09-30, when the brain held 115 memories, 577 edges and 222
keywords. Two parts:

1. **What the app does**: every main feature, how it works under the hood, and
   what each one costs to run.
2. **What happens at 10,000 memories**: measured, not guessed, plus a
   prioritized list of what to change and when.

---

## Part 1 — Feature inventory

### Getting memories in

| Feature | What it does | How it works | Paid? |
|---|---|---|---|
| **Add conversation** (Home input) | Paste a conversation; the app pulls out memories | `POST /api/process-conversation` → `ingestConversation()` in `server/routes/conversation.js`: Claude (or GPT-4o) extracts memories, OpenAI embeds each one, categories/keywords are matched to the controlled vocabulary, then each new node is linked to its nearest neighbours | Yes, one extraction call plus one embedding per memory and per *new* keyword |
| **MCP `store_memory` / `store_memories`** | Claude sessions save memories automatically | `POST /api/memories/batch` → `storeWrittenMemories()`: stored as written (no extraction), then the same embed/tag/link steps, plus free review notes (`memoryReview.js`) | Embeddings only |
| **Answer a curious question** (Reflect) | Your answer to one of the brain's questions becomes new memories | `POST /api/questions/:id/answer` → `ingestConversation()` | Same as above |
| **Controlled vocabulary** | Keeps categories to the fixed 12 and merges near-identical keywords ("React" / "React.js") | `server/services/taxonomy.js`: exact match first, then an embedding match at ≥ 0.72 against **every** keyword | One embedding per new keyword term |

### Connecting memories

| Feature | What it does | How it works |
|---|---|---|
| **Automatic links** | Draws edges between related memories | For each new node: vec0 k-NN finds 30 candidates, then `computeCompositeScore()` (`server/services/scoring.js`) = embedding similarity + keyword Jaccard × 0.18 + category boost (≤ 0.25). An edge is created above 0.6 composite |
| **Recalculate relationships** | Re-scores the whole graph with the current weights | `server/services/rescoring.js`: k-NN for every node, one big transaction. Free, but runs only when you click it |
| **Manual edges** | First Light links its answers to your identity star | Stored with type `manual`. Rescoring never touches them |

### Finding and asking

| Feature | What it does | How it works | Paid? |
|---|---|---|---|
| **Search** (Home/Explore) | Instant title/keyword match plus semantic matches | Client-side text filter over all loaded nodes, plus `GET /api/search`: hybrid search - vec0 k-NN on the query embedding and BM25 keyword search (`node_fts`, FTS5), merged by reciprocal rank fusion | One embedding per search |
| **Ask** | Answers a question from your memories, with citations | `POST /api/ask`: top 8 memories by similarity (≥ 0.2) → Claude answers and cites ids, which light up in 3D | One Claude call |
| **MCP search / related / overview** | Lets Claude look things up | `search_memories` → `/api/search`. `get_related_memories` → `/api/nodes/:id/related` (edge indexes) and `get_brain_overview` → `/api/overview` (SQL counts); neither downloads the graph any more (2026-10-06) | — |

### Viewing

| View | What it shows | Notes |
|---|---|---|
| **Home** | Ask bar, recent memories, "new since last visit", Tidy up card | The 3D star map also renders **behind** Home, Memories and Stats as a backdrop (`stageMode = 'is-backdrop'`), so its cost applies on every page |
| **Explore** (3D) | `BrainGraph3D.jsx`: force-directed star map. Each memory is a striped planet with glow sprites, and categories are placed on a sphere | Filters: search, timeline scrubber, categories. Focus a star to see its details panel |
| **Memories** | `AllMemoriesView.jsx`: a sortable, filterable list of every memory | Renders every row (no virtualization) |
| **Stats** | Growth chart, week clock, category shares, trending keywords, hubs, weekly digest | All computed in the browser from the full node/edge arrays. The digest is one Claude call over ≤ 60 memories from the past week |
| **Reflect** | The brain's curious questions, "Connect two topics" | You pick a topic (category, keyword, typed text, or two categories to connect) or "Surprise me"; `server/services/curiosity.js` picks up to 12 matching memories, then one Claude call writes 3 questions |
| **Retired views** | 2D React Flow graph, Solar system, Organize tab | Removed 2026-10-07 |
| **Portfolio embed** | Static snapshot of the brain as a website background | `scripts/export-portfolio-snapshot.js`, no live API |

### Tidying

| Feature | How it works | Paid? |
|---|---|---|
| **Duplicate suggestions** | `detectDuplicates()`: every edge with raw similarity ≥ 0.85, or that Claude judged "same". Recomputed on **every** `GET /api/graph` | No |
| **Check with Claude** | Sends the 10 most similar unreviewed pairs (≥ 0.6) in one call and stores verdicts with a content signature | Yes, one call per click |
| **Merge** | Folds tags and edges onto the older memory, then deletes the duplicate | No |
| **Edit / bulk re-tag / delete** | `PATCH/DELETE /api/nodes/:id` | New keywords cost an embedding |

### Storage

SQLite (`data/brain.db`, WAL mode) via better-sqlite3, with a `sqlite-vec`
`vec0` table for vector search. Each memory's embedding is stored **twice**:
once as JSON text in `nodes.embedding`, and once in `node_embeddings`.
Keyword embeddings are JSON text in `keywords.embedding`.

---

## Part 2 — What happens at 10,000 memories

### How this was measured

I copied the server and the real DB into a scratch directory (your data
wasn't touched), then grew the copy to **10,000 memories, 50,000 edges and
3,000 keywords**. Each synthetic memory is a real memory with its embedding
nudged slightly, so vector search sees realistic clusters. That's about
5 edges per memory, the same ratio you have today. Then I timed the real
server functions on a Mac.

| Operation | At 10k | When it runs | Verdict |
|---|---|---|---|
| `loadGraph()` | **1,330 ms** | Every `GET /api/graph`, **and after every write**: ingest calls it twice, and delete calls it and throws the result away | 🔴 |
| `detectDuplicates()` | **590 ms** | Every `GET /api/graph` and every Tidy-up action | 🔴 |
| `GET /api/graph` payload | **18 MB** | Every page load, and every MCP `get_all`, `get_related` and `store_memory` | 🔴 |
| Keyword fuzzy match | **400 ms per new keyword** | Ingest (3–5 keywords per memory, run one after another) and edits | 🔴 |
| Recalculate relationships | **~5.5 minutes**, in one transaction that blocks the server | On click | 🔴 |
| `findGaps()` (curiosity) | **7.2 s** | Generate questions | 🟠 |
| `findWeakBridges()` | 420 ms | Every `GET /api/questions` (Reflect load) | 🟠 |
| Vector k-NN (vec0, k=30) | 31 ms | Search, Ask, ingest linking | 🟢 |
| Semantic search end-to-end (local part) | 38 ms | Search, Ask | 🟢 |
| Linking one new memory | 34 ms | Ingest | 🟢 |
| Orphan query | 7 ms | Curiosity | 🟢 |
| DB file size | **515 MB** (326 MB of it is JSON embedding text in `nodes`, 97 MB in `keywords`) | — | 🟠 |
| Server memory | 780 MB RSS | — | 🟠 |

Estimated, not measured:

- ~~**MCP `get_all_memories`** would return ~**530,000 tokens**.~~ Fixed
  2026-10-06: replaced by `get_brain_overview`, a fixed-size map (~650
  tokens) built from SQL counts.
- **The 3D star map** builds, for each memory, its own `SphereGeometry`, its
  own `ShaderMaterial` and 1–4 glow sprites. At 10k that's roughly **30–40k
  draw calls per frame**, plus a 10k-node / 50k-link force simulation that
  runs 250 warm-up ticks on the main thread. Three.js stays smooth at a
  couple of thousand draw calls, so expect a frozen tab on load and single-digit
  frame rates after. And because the map is also the backdrop on Home,
  Memories and Stats, **every page** would feel slow.
- **Memories list, Tidy up and Stats** render or compute over every node in
  the browser. That's fine at 1k, but at 10k the list DOM gets sluggish and Tidy up
  could show thousands of suggestions. (My synthetic edges produced 7,143
  suggestions. That number is inflated by how I faked edges, but the point stands:
  the suggestion count grows with the graph and nothing pages it.)

**What already scales well:** vector search, linking one new memory at a
time, Ask (always 8 memories), the weekly digest (capped at 60), curiosity
probes (sampled), and the Check-with-Claude batch (10). **Cost scales with
how many memories you add, not with how big the brain is.** Every paid call
has a fixed-size input, so 10k memories doesn't make any single click more
expensive.

### The core pattern to fix

Almost every 🔴 comes from one habit that's harmless at 100 memories: **"send
the whole graph, recompute everything, every time."** The fixes all have
the same shape: send deltas instead of the whole graph, index instead of
scanning, and cache work instead of recomputing it on every read.

---

## Recommendations, in priority order

### Tier 1: do now (cheap, and they set the right patterns)

1. **Stop returning the whole graph from writes.** Take `loadGraph()` out of
   `addToGraph()` and `deleteNode()`. Have ingest return
   `{ newNodes, newEdges }`, have delete return `{ deletedId }`, and patch client
   state from that. That saves ~2.7 s per `store_memory` at 10k and stops
   sending 18 MB back through MCP.
2. **Fix the N+1 in `loadGraph()`.** `rowToNode()` runs two queries per node
   (20,000 queries at 10k). Instead, load `node_categories` and `node_keywords` once
   each (two queries total), group them in JS, and select explicit columns so
   the `embedding` column is never read. Expect 1.3 s → ~100 ms.
3. **Take duplicates out of `/api/graph`.** Give them their own
   `GET /api/graph/duplicates`, filter in SQL (`embedding_similarity >= 0.85
   OR` has a "same" review), add an index on `edges(embedding_similarity)`,
   and page the results.
4. **Make the MCP tools safe at any size.**
   - ~~`get_all_memories`~~ → done 2026-10-06: `get_brain_overview`
     (`GET /api/overview`).
   - ~~`get_related_memories`~~ → done 2026-10-06: a new server route (`GET /api/nodes/:id/related`)
     that uses the edge indexes instead of downloading the graph.
   - ~~Update the CLAUDE.md guidance~~ done: it points at
     `get_brain_overview` / `search_memories`.
5. **Put keyword embeddings in a vec0 table** (`keyword_embeddings`). Fuzzy
   matching then becomes one k=1 query (~ms) instead of JSON-parsing 3,000
   embeddings. That's 400 ms → a few ms per keyword.
6. **Store each embedding once, as binary.** Drop the reads of
   `nodes.embedding` and `keywords.embedding` JSON text. Read vectors from vec0
   (or store Float32 blobs). That's ~420 MB less at 10k and no more `JSON.parse` of
   1,536-number arrays in hot loops.

### Tier 2: before ~2,000–3,000 memories

7. **Rebuild the 3D map for scale.**
   - Draw stars as one `InstancedMesh` (or `Points` with a custom shader)
     instead of one mesh per star. Draw calls go from ~40k to a handful.
   - Level of detail: show glow sprites and labels only for the focused
     star, search hits and nearby stars.
   - Don't draw all 50k edges. Show each node's top few edges, or only the
     edges of the focused or matched stars.
   - Precompute layout positions on the server and store them (`position_x/y`
     already exist; add `z`) instead of simulating on every load. Or run the
     simulation in a Web Worker.
   - As a backdrop (Home/Memories/Stats), render a lighter version (a static
     snapshot or a sample) rather than the full interactive graph.
8. **Virtualize long lists** (Memories, Tidy up) so only the visible rows
   render.
9. **Make "Recalculate relationships" incremental and non-blocking.** Keep a
   `needs_rescore` flag set when a memory or the scoring weights change, and
   rescore only flagged nodes. Process them in chunks (yield between chunks
   with `setImmediate`) and report progress, so the server still answers
   while it runs.
10. **Cache the Reflect aggregates.** Category counts and category-pair link
    counts only change on writes. Cache them and invalidate on write, or keep
    a small summary table. That covers `findWeakBridges` and most of `findGaps`.
11. **Move Stats aggregates to the server** (one `GET /api/stats` with counts,
    series and hubs) instead of shipping every node to compute in the browser.

### Tier 3: quality problems that only show up at scale

These aren't about speed. They're about the brain staying *useful*.

- **Edge explosion and hubs.** The category boost (up to +0.25) matters a lot
  when most memories share Research + Interests. At 10k, dense topics will
  put 30 neighbours above threshold for many nodes. Consider capping edges at
  the top-k per node, and watch average degree as the graph grows. It's
  ~5 today.
- **Keyword chaining.** With thousands of keywords, the 0.72 fuzzy match gets
  more chances to merge terms that are only loosely related. Keep an eye on
  the keyword count vs memory count, and consider a keyword review screen.
- **Ask on broad questions.** Top 8 by similarity is right for "what did I
  say about X", but wrong for "what do I care about most?" when there are
  10k memories. Plan for rollups: periodic per-category summaries, generated
  on click (paid, so a button), that Ask can pull from.
- **Staleness.** The archival idea (old, unconnected memories drift to the
  outskirts) becomes important at this size. It keeps the default view
  focused on what's current.
- **Brute-force vector search** grows linearly. 31 ms at 10k means about 300 ms
  at 100k. That's fine for this target. Past ~50k, look at sqlite-vec's
  int8/bit quantization or an ANN index.
- **Backups.** Every `pre-wipe` / `pre-taxonomy` backup is a full DB copy
  (500 MB each at 10k with today's storage). Tier-1 item 6 shrinks this a
  lot. Also consider `VACUUM INTO` with rotation.

### Build these habits in from the start

- **Keep a benchmark around.** The seed-and-time scripts used here (in the
  session scratchpad) can live in `scripts/` as `npm run bench`, so any
  change can be checked against a 10k brain in seconds.
- **No endpoint returns "everything."** Every list endpoint takes a limit
  and a cursor, and every write returns only what changed.
- **Nothing synchronous over all nodes on a request path.** If it touches
  every node, it's either cached, incremental, or a background job.
- **Nothing sends the whole brain to Claude.** Every model input stays
  bounded, as it is today. That's what keeps cost flat.
