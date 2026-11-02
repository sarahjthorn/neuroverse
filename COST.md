# COST — what in AI Brain costs money

**This is the living source of truth for anything in this repo that spends
tokens, makes a paid API call, or otherwise costs money.** If you add or
change a feature that calls a paid API (or change a model, prompt size, or
how often something runs), update this file in the same change. See the
rule in `CLAUDE.md`.

_Last reviewed: 2026-10-07 (cost audit: memories Claude writes are stored without an extraction call)._

## TL;DR

| Thing you do | Paid API call(s) | Rough cost each | 1,000 of them ≈ |
|---|---|---|---|
| Claude stores a memory (MCP `store_memory` / `store_memories`) | OpenAI embeddings only (stored as written, plus a free split check) | **~$0.000003** | **~$0.003** |
| Paste a conversation on Home ("Add a conversation manually") | Haiku extraction + embeddings | ~$0.005–0.02 (depends on length) | ~$5–20 |
| **Ask your brain** (press Enter in Home search) | OpenAI embedding + **Claude Sonnet 5.5** answer | **~$0.007** (up to ~$0.01) | **~$7–10** |
| **Catch-up digest** button (Reflect page) | Claude Sonnet 5.5 | **~$0.01–0.02** | ~$10–20 |
| **Check with Claude** button (Home › Tidy up) | Claude Sonnet 5.5 | **~$0.008** | ~$8 |
| **Ask me about…** picker (Home's curious card, or Reflect) - writes 3 questions on the topic you pick, or Surprise me | Claude Sonnet 5.5 (+ OpenAI embeddings of the new questions, for the repeat check) | **~$0.009** | ~$9 |
| Answering one of those questions | Haiku extraction + embeddings (same as `store_memory`) | ~$0.002 | ~$2 |
| Answering a search the brain couldn't ("I don't know that yet. Want to tell me?") | Haiku extraction + embeddings (same as above) | ~$0.002 | ~$2 |
| **First Light** intro (once, on a new brain; or "Replay intro" on Home) | OpenAI embeddings for the name star + Haiku extraction for the "curious" answer | **~$0.002** per run | ~$2 |
| Typing in a search box (Home, Explore, MCP `search_memories`) | OpenAI embedding only | ~$0.000001 | ~$0.001 |
| Axon's explore or deep-think task adds an idea to the inbox (MCP `add_inbox_items`, kind idea; at most 3 a day between them) | OpenAI embedding only, for the 90-day repeat check. The task itself runs on her Claude plan, not the API | ~$0.0000002 | ~$0.0002 |
| Editing a memory's keywords (a brand-new keyword) | OpenAI embedding only | ~$0.000001 | ~$0.001 |
| Everything else (see "Free" below) | none | $0 | $0 |

**Rule of thumb:** $5 buys roughly **700 Ask questions**, **or ~350
digests**. Saving memories from Claude and searching are effectively free.

**Typical month** (20 memories stored a day, 5 Ask questions a day, 4
digests): 600 × $0.000003 + 150 × $0.007 + 4 × $0.015 ≈ **$1.10/month**,
almost all of it Ask. (Before the 2026-10-07 audit saving alone was
≈ $1.20-2.40 of that; at Sarah's real October rate of ~55 memories a day,
≈ $1-3.50/month.)

## Prices used

| Model | Used for | Input | Output | Source |
|---|---|---|---|---|
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Memory extraction (default `EXTRACTION_MODEL=claude-haiku`); the brain's questions only if `QUESTION_MODEL=claude-haiku-4-5` | $1 / M tokens | $5 / M tokens | Anthropic pricing |
| Claude Sonnet 5 (`claude-sonnet-5`) | Extraction, only if `EXTRACTION_MODEL=claude-sonnet` | $2 / M | $10 / M | Anthropic pricing |
| GPT-4o | Extraction, only if `EXTRACTION_MODEL=gpt-4o` | $2.50 / M | $10 / M | OpenAI pricing |
| **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | Ask answers, weekly digest, duplicate check (default `ANSWER_MODEL`) and the brain's questions (default `QUESTION_MODEL`) | $2 / M | $10 / M | Anthropic pricing |
| Claude Opus 5.5 (`claude-opus-5-5`) | Only if you set `ANSWER_MODEL=claude-opus-5-5` (~2× the Ask/digest cost) | $4 / M | $20 / M | Anthropic pricing |
| OpenAI `text-embedding-3-small` | Every embedding (memories, keywords, search queries) | $0.02 / M | — | OpenAI pricing |

Prices change - re-check them when you review this file.

## Every paid call site in the code

### 1. Memory extraction — `POST /api/process-conversation`
- **Code:** `server/routes/conversation.js` → `extractMemoriesWithClaude()` in
  `server/services/anthropic.js` (or `extractMemories()` in
  `server/services/openai.js` when `EXTRACTION_MODEL=gpt-4o`).
- **Triggered by:** text nobody has split into memories yet: "Add a
  conversation manually" on Home, answering one of the brain's questions
  or a missed search (#6), and First Light's "curious" answer (#7).
  **Not** MCP `store_memory` / `store_memories` any more - see "Memories
  Claude writes" below. Before 2026-10-07 every MCP save ran through
  here, which made this the app's main recurring cost.
- **Tokens:** system prompt ≈ 800 tokens (the shared one-idea-per-memory
  rules + worked example in `server/services/extractionRules.js`, plus the
  category list) + the text being processed (a `store_memory` call sends
  ~100–200 tokens) → output ≈ 70–90 tokens per extracted memory (one
  sentence each; one input is often split into 2–4 memories),
  `max_tokens: 2000`. Measured 2026-09-30: 870–930 input, 84–262 output.
  Since 2026-10-02 the prompt also asks which keywords are entities
  (`ENTITY_RULE` in `extractionRules.js`): ≈ +200 input tokens and ≈ +15
  output tokens per memory, so ≈ +$0.0003 per `store_memory` - still
  ≈ $0.002.
- **Cost:** `store_memory` ≈ 900 in × $1/M + 200 out × $5/M ≈ **$0.002**.
  A pasted 3,000-token conversation that yields 5 memories ≈ $0.004 + $0.006
  ≈ **$0.01**.
- **Prompt caching:** wired up but doesn't activate. Claude only caches a
  block of at least 1,024–4,096 tokens (4,096 for Haiku 4.5), and the
  extraction system prompt is shorter, so `cache_creation` and `cache_read`
  are always 0 in the `📊 Token usage` log. Padding the prompt to qualify
  isn't worth it.
- **Memories Claude writes** (`POST /api/memories/batch`, MCP
  `store_memory` and `store_memories`, since 2026-10-07):
  `storeWrittenMemories()` in `server/routes/conversation.js` stores them
  exactly as sent - Claude already wrote the title, sentence, categories,
  keywords and (optionally) entities, on Sarah's Claude plan rather than
  these API keys. No extraction call; only #2's embeddings (~$0.000002)
  plus the split check in `server/services/memoryReview.js`: one embedding
  call for the parts of a sentence that has a place it could split
  (≈ $0.0000002, most memories have none). Before this, each `store_memory`
  was a ≈ $0.002 Haiku call (≈ $0.0005 per memory batched).

### 2. Embeddings — `generateEmbedding()` in `server/services/openai.js`
- **Model:** `text-embedding-3-small`, $0.02 per million tokens.
- **Triggered by:**
  - every extracted memory (title + content + keywords, ~100 tokens) - part
    of #1;
  - every brand-new keyword (`findOrCreateKeyword()` in
    `server/services/taxonomy.js`, a few tokens) - during extraction and when
    you edit keywords;
  - every semantic search query: Home's "Related by meaning" (debounced,
    fires ~0.4 s after you stop typing, 3+ characters), Explore's search box
    (shares the same query), MCP `search_memories`, and the retrieval step of
    Ask;
  - server boot: `backfillKeywordEmbeddings()` embeds any keyword that's
    missing one (normally zero; a one-off after migrations);
  - every Axon idea added to the inbox (title + why, ~20 tokens), so a
    repeat of an idea from the last 90 days is blocked
    (`server/routes/inbox.js`). Options don't get one.
- **Cost:** ~$0.000002 per memory; ~$0.0000002 per search. **A million
  searches ≈ $0.20.** Not worth optimising.

### 3. Ask your brain — `POST /api/ask`
- **Code:** `server/routes/search.js` → `answerFromMemories()` in
  `server/services/anthropic.js`.
- **Triggered by:** pressing Enter (or "Ask ↵") in Home's search bar. Never
  automatic.
- **Tokens:** 1 embedding for retrieval, then Sonnet 5.5 at `effort: low`
  with the top ≤ 8 memories: ≈ 1,000–1,200 input tokens; output ≈ 150 answer
  tokens + some thinking (≈ 200–600), `max_tokens: 2000`.
- **Cost:** ≈ 1,100 × $2/M + ~450 × $10/M ≈ **$0.007** (range ~$0.004–0.01).
- **Refusal fallback:** `fallbacks: "default"` - if the model declines, the
  API re-runs the request on a fallback model inside the same call, billed
  at that model's rates. Rare.
- **Why Sonnet, not Opus:** answering from ≤ 8 retrieved memories is short
  summarising, not deep reasoning - Opus 5.5 would cost ~2× for no visible
  gain. `claude-haiku-4-5` ($1/$5) would be ~2× cheaper again but writes
  flatter prose.
- **Asking back:** when the memories don't fully answer, the model ends
  with an `ASK_BACK:` line - a short follow-up question for Sarah (≈ 15
  output tokens, no extra call) - and Home asks it under the (partial)
  answer. Showing that card, "Never mind" and "Remind me later" are
  free; only "Save answer" spends money (#6's answer path, ≈ $0.002).

### 4. Catch-up digest — `POST /api/stats/digest`
- **Code:** `server/routes/stats.js` → `writeWeeklyDigest()` in
  `server/services/anthropic.js`.
- **Triggered by:** the "Catch me up" button on Reflect. **Manual
  only** - by design, nothing calls it on a schedule. Nothing new since
  the last digest → no call at all.
- **Tokens:** memories since the last digest, never older than 7 days,
  capped at 60 (≈ 90 tokens each) →
  ≈ 1,000–5,500 input tokens; output ≈ 250 + thinking, `max_tokens: 2000`,
  `effort: low`.
- **Cost:** ≈ **$0.01–0.02** per click on Sonnet 5.5 (39 memories ≈ $0.015).
- Same `ANSWER_MODEL` and refusal fallback as Ask.
- Every digest is saved (dated) in the `digests` table and listed on Reflect
  under "Past digests" - loading and reading saved ones is free
  (`GET /api/stats/digests`); only writing a new one costs.

### 5. Duplicate check — `POST /api/graph/duplicates/check`
- **Code:** `server/routes/graph.js` → `checkDuplicatesWithClaude()` in
  `server/services/duplicates.js` → `judgeDuplicatePairs()` in
  `server/services/anthropic.js`.
- **Triggered by:** the "Check with Claude" button on Home's Tidy up card.
  **Manual only** - the automatic duplicate suggestions are free maths.
- **Tokens:** one request with the 10 most similar pairs that don't already
  have a verdict (raw similarity ≥ 0.6), `effort: low`, structured JSON
  output, `max_tokens: 4000`. Measured 2026-09-30 (10 pairs): 1,466 input,
  542 output.
- **Cost:** ≈ 1,466 × $2/M + 542 × $10/M ≈ **$0.008** per click. Verdicts
  are saved (`duplicate_reviews` table), so clicking again moves on to the
  next 10 pairs rather than re-asking. Once every similar pair is judged a
  click makes no API call. Editing a memory makes its pairs eligible again.
- Same `ANSWER_MODEL` and refusal fallback as Ask.

### 6. Curious questions — `POST /api/questions/generate`
- **Code:** `server/routes/questions.js` → `generateQuestions()` in
  `server/services/curiosity.js` → `writeCuriousQuestions()` in
  `server/services/anthropic.js`.
- **Triggered by:** the "What should I ask you about?" picker on Home's
  "Your brain is curious" card (only shown when no questions are open) or
  Reflect's "It's wondering" card: **Surprise me**, a category (a chip on
  Home, the "Ask" on a Your mix bar on Reflect), a keyword chip, or a
  typed topic. (Reflect's "Connect two topics" bridge pairs were removed
  2026-10-06, and the server side on 2026-10-07.)
  One click = one call. **Manual only.**
- **Model:** `QUESTION_MODEL`, default **Claude Sonnet 5.5** (back from
  Haiku 4.5 on 2026-10-05: on the same prompt Haiku kept writing
  "You do X and Y - is it A, or B?" questions and gluing unrelated topics;
  Sonnet followed the one-topic, one-question rules). `effort: low` and
  the server-side refusal fallback are sent to non-Haiku models only.
  `QUESTION_MODEL=claude-haiku-4-5` switches back (~half the cost).
- **What's sent - picked locally for free, 12 memories at most:**
  - a chosen category or keyword: a random 12 of its memories;
  - typed text: one embedding of the text (≈ $0.0000002), then the up-to-12
    memories closest in meaning (similarity ≥ 0.3);
  - Surprise me: 3 different categories, picked at random but leaning away
    from ones asked about lately (skips count triple), 4 memories each;
  - Connect two topics: 6 memories from each of the two categories.
  Cleaning: near-repeats (cosine ≥ 0.8) are skipped, as are memories behind
  the last 9 questions (let back in if a topic would otherwise be half
  empty) and behind a skipped/dismissed question in the last 30. At most 4
  memories (1 for Surprise me) carrying a saturated keyword like
  Neuroverse, unless that keyword is the topic. Content trimmed to 160
  characters, titles dropped, node ids swapped for short `m1`… ids. Plus
  up to 15 past questions on the same topic and 5 others, with status.
  About 1 Surprise batch in 3 swaps a question for a random "wildcard".
- **Repeat check:** Claude writes 6 questions (3 + 3 spares); all are
  embedded in one OpenAI call and any too similar to a past question
  (cosine ≥ 0.7, or ≥ 0.6 against skipped/dismissed ones) is dropped. If
  fewer than 3 survive, the least-similar dropped ones under 0.8 top the
  batch back up, so a click gives 3. Past questions are embedded once,
  lazily, and stored (`questions.embedding`).
- **Tokens:** measured 2026-10-05 on Sonnet 5.5 (360 memories, 12 sent),
  after the prompt was rewritten shorter: 1,410-2,050 input, 440-510
  output.
- **Cost:** ≈ 1,700 × $2/M + 480 × $10/M ≈ **$0.008-0.009** per click (Haiku on
  the same prompt measured ≈ 1,800 in / 440 out ≈ $0.004). The question
  embeddings are ≈ $0.00002.
- **Answering** (`POST /api/questions/:id/answer`) runs the answer, with
  its question for context, through the normal extraction pipeline (#1 + #2):
  ≈ **$0.002** per answer. Skip / Not relevant are free. Answering a missed
  search (`POST /api/questions/from-search` with an answer) is the same
  call and cost; without an answer ("Remind me later") it's free.

### 7. First Light intro — `POST /api/intro/name`, `POST /api/intro/curious`
- **Code:** `server/routes/intro.js`, driven by `src/components/FirstLight.jsx`.
- **Triggered by:** opening a brand-new, empty brain (once), or "Replay
  intro" on Home. Never automatic after it's been completed or skipped.
- **Name** (`/intro/name`): stores the owner's star directly through
  `storeMemories()` - no extraction call - so only embeddings (#2): the
  memory, plus the name as a new keyword ≈ $0.000002. Replaying with the
  same name reuses the star and costs nothing.
- **Curious answer** (`/intro/curious`): the normal extraction pipeline
  (#1 + #2) on a one-line answer ≈ **$0.002**.
- **Cost:** ≈ **$0.002 per run**.

## Free (no API calls)

These run entirely locally and cost nothing, however often you use them:

- Live arrivals: while the app is open it polls `GET /api/graph/signature`
  (one COUNT/MAX query) every 5 s, and fetches the graph only when it
  changed - so memories from Claude burst into the 3D view with no reload

- Loading the graph, Home's recent-memories feed, exact-match search
- The 3D view (Explore), the timeline scrubber, the colour key, the card
- Home's recent feed and the All memories page (filtering, sorting)
- The Reflect page (everything except the digest button and asking for
  questions): growth, tiles, Your mix, keywords, trending, hubs, rhythm,
  answer history, past digests, and Skip / Not relevant on any question
- Recalculate relationships and the automatic duplicate suggestions
  (`server/services/rescoring.js`, `detectDuplicates()` in `duplicates.js` -
  pure maths on stored embeddings)
- Editing a memory's title/content/categories (note: content edits
  don't re-embed, so the stored embedding keeps describing the old text)
- MCP `get_brain_overview` (a few SQL counts), `get_related_memories`, `update_memory` (except new
  keywords, see #2), `delete_memory`, `recalculate_relationships`
- **The portfolio snapshot** (`npm run export:portfolio`) - reads the local
  database only; the portfolio then serves static files with no API behind it

## Not in this repo, but related

- **Claude Code sessions** that work on this repo use your Claude plan, not
  these API keys. Since 2026-10-07 the `store_memory` calls they make only
  cost embeddings (#2), so proactive saving is effectively free on the API
  keys; Ask (#3) is now the biggest driver of API spend.

## Changelog

- 2026-10-28 - `deep-think` v0.2 adds a search-helper subagent (up to 13
  subagent runs a night with the specialists, devil's advocate and round
  2). Still Sarah's plan allowance only, no API spend; the 50% start rule
  still protects her window.

- 2026-10-28 - `deep-think` v0.1 goes deeper: two rounds of stances plus
  a devil's advocate, so up to 11 subagent runs a night. Still all on
  Sarah's plan allowance (using spare allowance is the point), no API
  spend. It now fires hourly 01:00-06:00 and only runs when the 5-hour
  window is under 50% and the week is on pace for under 80%; a skipped
  hour costs a little allowance, nothing on the API.

- 2026-10-27 - Axon's `deep-think` task (nightly, one decision, five
  stance subagents, a Claude Doc) runs on Sarah's plan allowance, not the
  API. Its one inbox idea a night costs one embedding (~$0.0000002) and
  shares explore's cap of 3 ideas a day, so no change to API spend.

- 2026-10-20 - Axon ideas (`kind: idea` in the inbox) are embedded once
  each for the repeat check: ~$0.0000002 per idea, at most 3 a day. The
  `explore` task that writes them is a Claude desktop scheduled task on
  Sarah's plan allowance, so it adds no API spend.

- 2026-10-07 - New Mind category (12 categories). The extraction prompt's
  category list is one word longer; no cost change.

- 2026-10-07 - Cost audit. MCP `store_memory` and
  `store_memories` no longer call Haiku: memories Claude writes are stored
  as written, with a free review (`memoryReview.js`: a split check using one
  ≈ $0.0000002 embedding call, plus length/category/keyword checks) whose
  notes go back to Claude to fix. Saving drops from ≈ $0.002 (≈ $0.0005
  batched) to ≈ $0.000003 per memory - about $1-3.50/month at Sarah's
  current rate, to under a cent. Entities now come from Claude's optional
  `entities` field instead of the extraction call. Audited and kept as they
  are: Ask and questions stay on Sonnet 5.5 (Haiku answers read flatter;
  Haiku questions were tried on 2026-10-05 and were worse), digest and
  Check with Claude are button-only and already skip the call when there's
  nothing new, embeddings are too cheap to matter. Pasted conversations,
  question answers and First Light still use extraction (≈ $0.002 each).

- 2026-10-07 - Extraction prompt (`anthropic.js`, `openai.js`) now asks
  for every category that genuinely applies (three or more is fine), about
  40 input tokens longer per `store_memory` call plus a token or two of
  output - well under $0.0001 each, so the cost model is unchanged.
- 2026-10-07 - Unused code removed. The only cost
  effect: the extraction prompt no longer offers a `suggestedNewCategory`
  field (category approval was retired), about 60 input tokens shorter per
  `store_memory` call - a rounding error at ~$0.00006 each, still ≈ $0.002.
  `GET /api/config`, which listed model prices, is gone; this file is the
  only price list.

- 2026-10-07 - MCP `store_memories` (`POST /api/memories/batch`): several
  memories in one tool call, extracted 10 per Haiku call instead of one call
  each. Same model and prompt, ~3x cheaper per memory (~$0.0005 vs ~$0.0016
  measured) and ~4x faster; Claude is told to use it whenever it has two or
  more memories to save. The wishlist (same day) added no paid calls - its
  keywords are matched against existing ones, never embedded.

- 2026-10-06 - Stats merged into Reflect. The weekly digest became a
  "Catch me up" digest covering only what's new since the last one (still
  capped at 7 days and 60 memories), so repeat clicks read less and cost
  the same or less; with nothing new it makes no call. Same question
  call as before, now also reachable from Your mix's "Ask".

- 2026-10-06 - MCP `get_all_memories` replaced by `get_brain_overview`. No
  API cost either way, but it cuts what Claude reads into its context from
  every memory in full (~16k tokens at 413 memories, ~530k at 10k) to a
  fixed-size map (~650 tokens), which saves Claude-plan usage.

- 2026-10-05 - First Light intro (new brains only, plus "Replay intro"):
  ≈ $0.002 per run, see #7. The open app now polls for memories stored
  from elsewhere (free, local query only).

- 2026-10-05 - Reflect's "Connect two topics" card asks bridge questions
  about the category pair you pick (same call and cost as the picker).
  Question prompt rewritten shorter; no change to the per-click cost.
- 2026-10-05 - The brain's questions: a "What would you like to be asked
  about today?" picker (Surprise me / category / keyword / typed topic)
  replaces the self-chosen gaps and bridges. 12 memories sent instead of
  20, 6 questions written instead of 5, and `QUESTION_MODEL` back to
  Sonnet 5.5: ≈ $0.006 → **≈ $0.009** per click (measured). Typed topics
  add one embedding (≈ $0.0000002). Still manual only.
- 2026-10-02 - Search asks back: when Ask can't fully answer, Claude adds a
  follow-up question and Home offers to save Sarah's answer (~$0.002, the
  normal extraction path) or park it for later (free). Answer prompt
  ≈ +80 input / +15 output tokens - still ~$0.007 per ask.

- 2026-10-02 - Entities and aliases: the extraction prompt also tags which
  keywords are people, places, organisations or projects (≈ +200
  input / +15 output tokens per call, ≈ +$0.0003; no new calls). Keyword
  merges/aliases and the one-off `scripts/tag-entities.js` are free. Hybrid
  BM25 search (SQLite FTS5) is free too.

- 2026-10-02 - Curious questions: bridge questions only when a cross-category
  memory pair is genuinely similar (≥0.4), "thin" categories are now relative
  to the median, and over-represented keywords (AI Brain, quantum computing…)
  are capped and listed for Claude to steer away from. Prompt ~+80 input
  tokens (≈$0.0001 more per click); the saturated-keyword lookup is a free
  local query. Still ~$0.006 per click.
- 2026-09-30 - Curious questions stop circling skipped topics: 40 past
  questions sent (was 15), Claude writes 2 spare questions, and a batched
  embedding check drops rephrased repeats. Estimated ≈ **$0.006** per click
  (was $0.004); embeddings negligible.
- 2026-09-30 - Curious questions moved to Haiku 4.5 (`QUESTION_MODEL`) with a
  smaller, cleaner sample (≤ 20 memories: thin categories and their nearest
  memories, the weakest bridge's closest pairs, then round-robin breadth;
  near-repeats and memories behind recent questions dropped). Re-measured ~2,150 in /
  ~330 out ≈ **$0.004** per click (was $0.015, about 4× cheaper). Added
  occasional wildcard questions (no extra cost).
- 2026-09-30 - Curious questions now also target the least-linked category
  pairs (bridge questions), sending a few memories from each side.
  Re-measured: 5,480 in / 430 out, ≈ $0.015 per click (was $0.013).
- 2026-09-30 - Curious questions now always include 1-2 about thin
  categories (+~120 prompt tokens, still ≈ $0.013 per click). The new
  Reflect page is free; its "Ask me something" is the same call.
- 2026-09-30 - Added the "Your brain is curious" card (#6): ~$0.013 per
  "Ask me something" click (3 questions), ~$0.002 per answer. Manual only.
- 2026-09-30 - Duplicate-check prompt gained a "named specifics stay
  separate" rule (+~30 tokens; re-measured 1,497 in / 521 out, still ≈ $0.008).
- 2026-09-30 - Added the "Check with Claude" duplicate check (#5), about
  $0.008 per click and manual only. Cluster and hierarchy suggestions were
  removed; they were free, so costs don't change.

- 2026-09-30 - Extraction prompt now asks for one idea per memory in one
  sentence, with a worked example (+~200 input tokens per call). Output per
  memory is shorter but inputs get split into more memories, so the total
  cost per call stays about $0.002. Extra memories mean a few more embedding
  calls, which cost next to nothing.

- 2026-09-29 - Ask + weekly digest default switched from Opus 5.5 to
  Sonnet 5.5 (`ANSWER_MODEL`), roughly halving both.
- 2026-09-29 - Digests are now stored and browsable (free); no new paid calls.
- 2026-09-29 - Created. Added Ask (#3) and the weekly digest (#4); documented
  extraction, embeddings, and the free paths; portfolio snapshot is free.
