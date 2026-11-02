# AI Brain — Claude Code instructions

This project has its own MCP server (`ai-brain`, in `mcp-server/index.js`) already
connected to Claude Code sessions here. It exposes `store_memory`,
`store_memories`, `search_memories`, `get_related_memories`, `get_brain_overview`, `update_memory`,
and `delete_memory`, calling the local Express API on port 3001 — which must be
running (`npm run dev`) for these to work.

## Proactive memory storage

Whenever Sarah shares a durable fact about herself in conversation — a
preference, skill, project, goal, relationship, or opinion — call `store_memory`
immediately, without asking permission first. Don't narrate that you're storing
it unless she asks; just do it and continue the conversation.

A fact doesn't have to be an explicit "I like/am/do X" statement. A single
targeted question can itself be the durable signal — it reveals what she's
curious about or dealing with, even with no personal statement attached.

**Default to saving, not skipping.** Sarah wants this brain to capture pretty
much anything and everything she asks Claude about — treat "does this count?"
as a low bar, not a high one. Almost any question she asks fits some category
(Research/Interests at minimum) even with zero personal statement attached.
Skip storage only for information that's clearly trivial, one-off, or already
stored this conversation — not because a fact "might not be durable enough."
When in doubt, store it.

**If she explicitly invokes `/auto-save-memories` mid-conversation**, treat it
as a request to catch up, not just a switch for going forward: scan back over
the whole conversation so far (not just messages after the invocation) for
anything worth storing, store it immediately, and only then continue. Don't
report "nothing to save yet" if something earlier in the conversation
qualifies — the fact that she had to ask for it to be saved after the fact is
exactly the failure mode to avoid next time.

The category enum (`CANONICAL_CATEGORIES` in `server/services/db.js`) has 12
values. Cover all of them when relevant, not just the obvious ones:

- **Career** — job, employer, role, job search, promotions. "I just started as
  a PM at Acme," "I'm interviewing for a new role."
- **Personal** — name, location, family, life events. "I moved to Austin last
  month."
- **Health** — the body: conditions, fitness goals, sleep, diet, skincare.
  "I'm training for a marathon," "I'm cutting back on caffeine."
- **Mind** — mood, stress, confidence, feelings, mental health, beliefs,
  self-image. "I always feel busy," "I get annoyed when I feel behind."
- **Research** — topics she's actively curious about, even from one question,
  especially news/current-events. Asking about the Hugging Face/OpenAI hack →
  interest in AI supply-chain security; asking about Fed interest rate hikes →
  interest in monetary policy. Store the underlying topic, not the news event
  itself as a "fact" about her.
- **Travel** — trips planned/taken, travel habits. "We're going to Japan in
  October."
- **Financial** — money goals, budgeting/investing habits, financial
  decisions — and questions revealing a financial concern, like asking about
  rate hikes because of a mortgage. "I'm saving for a house down payment."
- **Project** — what she's building or shipping. "I'm adding duplicate-merging
  to the AI Brain graph."
- **Interests** — hobbies and recurring topics she follows, even without an
  explicit "I like X." Regularly asking about AI industry news.
- **Technical** — skills, tools/languages, stack choices, technical opinions.
  "I prefer Postgres over Mongo for this."
- **Relationships** — people, teams, orgs mentioned repeatedly. "My manager
  Priya wants this by Friday."
- **Preferences** — general likes/dislikes, working style. "I prefer terse
  responses."

Opinions (strong recurring views) and decisions (choosing between options,
committing to a plan) are cross-cutting, not categories of their own — file
them under whichever topical category above fits.

- Tag every category from the tool's enum that genuinely applies. Three or
  more is fine; don't stop at one or two out of habit (skincare is Health,
  anything about cost is Financial, trips and travel photos are Travel).
- Reuse existing keywords where they clearly apply (check with
  `get_brain_overview` or `search_memories` if unsure) instead of minting
  near-duplicate variants of the same concept.
- If the conversation is happening inside a specific project's working
  directory, use that project's name as a keyword so related memories cluster
  together (e.g. work happening in this repo gets tagged `sarahs-brain`).
- One idea per memory, stated in one plain sentence (ideally under 25
  words). If a message contains several ideas, call `store_memory` once per
  idea rather than combining them — many small memories beat one long
  paragraph. Name any subject other than Sarah explicitly (e.g. the project
  name) so each memory stands alone.
- When there are two or more memories to save at once (several ideas in one
  message, or a `/auto-save-memories` catch-up), send them in **one
  `store_memories` call** rather than repeated `store_memory` calls - much
  faster. Before a catch-up, check `search_memories` so nothing already
  saved gets saved twice.
- Memories are stored exactly as written (no model re-splits them), so get
  the one-idea rule right, mark entity keywords in `entities`, and fix
  anything the reply lists under "Please check".

## Wishlist

The brain also keeps a wishlist of things Sarah is thinking about buying
(`wishlist_items` table, `server/routes/wishlist.js`, the Wishlist page, and
the MCP tools `add_wishlist_item` / `list_wishlist` / `update_wishlist_item`).
Items are tagged like memories: one or more of the 12 categories plus
keywords, which are matched onto the brain's existing keywords (never minting
new keyword rows) and are what link an item to related memories. When she
mentions wanting, considering or comparing something to buy, call
`add_wishlist_item` (reuse the existing name so repeat mentions are counted;
the server pushes back on likely duplicates) as well as `store_memory` if the
reason says something about her. She likes to
take her time before buying, so never nudge her to buy; just keep the list
accurate. Items can have a photo (downloaded into `data/wishlist-images/`
from a product page's preview image - see `server/services/wishlistPhotos.js`,
no paid APIs) and a shop `link`. The page only shows the photo for Ready-to-buy
items with a link (`showsPhoto` in `src/components/wishlistUtils.js`); the rest
are coloured name tiles. Pass `link` once she's settled on a specific product.
Specific products she's weighing up are the item's options, each with pros,
cons, price and link (`optionDetails` on the wishlist tools); the page shows
them side by side as a decision tool (`WishlistCompare.jsx`), and
`chooseOption` picks the winner and moves the item to Ready.

## Optional tabs

Only Home, Explore, Memories and Reflect are always shown. Every other tab
(Wishlist and Axon today; Finance, Routines, Calendar and Reading planned) is optional and
switched on from the "+" at the end of the nav - list in `src/tabs.js`,
on/off state in the `enabled_tabs` setting via `server/routes/tabs.js`. New
tabs go in as optional, and should cross-connect with the others and the
memory graph as much as possible.
A hidden tab still keeps and collects its data, but Axon's scheduled
jobs leave it out: every recipe and task checks `GET /api/tabs` first
(and stops if Axon itself is off). New recipes must do the same.

Name items after the need, not the brand she happens to be looking at
("Fitness watch" while she compares Garmin and Apple Watch, with the models as
options), unless she's set on that exact thing ("a ticket to that one festival").
The test: would a different brand or model still count as getting it?
Statuses go idea → researching (comparing) → ready (decided; she'll buy it
when she's ready) → bought, or dropped. When an item moves to ready,
rename it to the exact model she chose.

## Keeping the MCP server in sync

The MCP server (`mcp-server/index.js`) is how Claude Chat, Cowork and Code
see the brain. Its tool descriptions carry the "how" of saving, and a short
`INSTRUCTIONS` string points at them. It has to be updated by hand. Whenever a change touches any
of these, update the MCP server in the same change:

- API routes or response shapes it calls (`/process-conversation`, `/search`,
  `/nodes`, `/overview`, `/wishlist`, ...)
- the category list (`CANONICAL_CATEGORIES` in `server/services/db.js`, which is
  copied into `CATEGORIES` in the MCP server)
- what Claude should save or how (this file's saving rules, which the tool
  descriptions restate)
- new features Claude should be able to read or write from chat (add a tool)

Not every Claude app shows `INSTRUCTIONS`, but every app sends the tool
descriptions, so each tool's description has to carry its own essentials
(when to call it proactively, the category guide, what never to do); keep
`INSTRUCTIONS` a short pointer, not a second copy. Her claude.ai profile
preferences now hold only "when to save" (topic triggers, passing remarks and
questions count, silent, catch-up) and defer "how" to the tool descriptions,
so neither the profile nor a skill needs updating when features change. The
old auto-save-memories skill and `/prototype-auto-save-memory` are being
retired.

Also tell Sarah, in one line at the end, only when a change affects *when* to
save, in which case her claude.ai **profile preferences** text is out of date
(give her the replacement text). Since the MCP server runs from the main
checkout, remind her that Claude apps pick up MCP server changes only after
they're merged to main and the app is restarted (and `npm install` in
`mcp-server/` if its dependencies changed).

## Docs

Keep the doc set small and current; it was cut down on 2026-10-07.
`docs/ARCHITECTURE.md` (how it fits together and the design decisions),
`docs/MEMORY_PIPELINE.md` (one memory's path, Tidy up), `docs/MCP_SETUP.md`
(setup and every MCP tool), `COST.md` and `docs/FEATURES_AND_SCALING.md`. Update the relevant one in
the same change instead of starting a new doc. When an MCP tool changes, update its row in
`docs/MCP_SETUP.md` too.

## Costs — keep COST.md up to date

`COST.md` (repo root) is Sarah's live source of truth for everything in this
repo that costs money: paid API calls (Anthropic, OpenAI), token estimates,
and a cost model ("1,000 of these ≈ $X"). Whenever a change adds, removes or
alters anything that spends money — a new Claude/OpenAI call, a different
model, a bigger prompt, something running more often, a new external paid
service — update `COST.md` in the same change (the table, the call-site
section, and the changelog). Prefer paid features that run only when Sarah
clicks a button over ones that run automatically.
