# Connecting Claude (MCP)

The `ai-brain` MCP server (`mcp-server/index.js`) lets Claude save and look
up memories while you chat. It's a thin wrapper: each tool call becomes an
HTTP request to the Neuroverse API on port 3001, so **the app must be
running** (`npm run dev`). The MCP server holds no API keys and no data;
those live in the main `.env` and `data/brain.db`.

```
Claude Desktop / Claude Code ──stdio──► mcp-server/index.js ──HTTP──► API :3001 ──► data/brain.db
```

## Setup

The easy way is `npm run setup` from the repo root, which does both of the
steps below for you. To do it by hand:

1. Install the MCP server's dependencies:
   ```bash
   cd mcp-server && npm install
   ```

2. **Claude Desktop:** add this to
   `~/Library/Application Support/Claude/claude_desktop_config.json`
   (Windows: `%APPDATA%/Claude/claude_desktop_config.json`), with the
   absolute path to your checkout. Use forward slashes, even on Windows.
   ```json
   {
     "mcpServers": {
       "ai-brain": {
         "command": "node",
         "args": ["/absolute/path/to/neuroverse/mcp-server/index.js"],
         "env": { "AI_BRAIN_API_URL": "http://localhost:3001/api" }
       }
     }
   }
   ```
   Then quit and reopen Claude Desktop.

3. **Claude Code:**
   ```bash
   claude mcp add ai-brain --scope user -e AI_BRAIN_API_URL=http://localhost:3001/api -- node /absolute/path/to/neuroverse/mcp-server/index.js
   ```

Check the API is up with `curl http://localhost:3001/api/health`, then tell Claude
"Remember that I prefer dark mode" and ask "What do you know about my
preferences?".

## Making saving automatic

When it connects, the server sends a short instruction (`INSTRUCTIONS` in
`mcp-server/index.js`, about 130 tokens): save durable facts and questions
that show what she's curious about, silently and without asking, one idea per
memory, `store_memories` for two or more, follow each tool's description, and
carry on if the brain is offline. Apps that support server instructions add it
to every conversation.

Not every app passes instructions on to the model, so each tool's description
carries the "how" itself (when to call it proactively, the category and
keyword guides, the wishlist and Axon inbox rules, what never to do). That is
the one place to update when a feature changes. A standing instruction in
claude.ai (**Settings → Profile → personal preferences**) only needs to say
*when* to save, and defers the rest to the tools, for example:

```
You have access to the ai-brain MCP tools. Save to them silently, without asking
and without announcing it, whenever I share anything durable about myself (a
preference, skill, project, goal, relationship, opinion or decision) or ask about
a topic, even in passing; a question alone shows what I'm curious about. Things I
mention wanting to buy go on the wishlist. If I ask you to catch up, save
everything worth keeping from the whole conversation so far. Follow the tool
descriptions for how.
```

Only change that text if *when* to save changes; new features and tool changes
don't touch it.

## Tools

| Tool | What it does | API route |
|---|---|---|
| `store_memory` | Saves one memory (`title`, `content`, `categories`, `keywords`, optional `entities`) exactly as written - no extraction call. The reply lists any free review notes ("looks like 2 separate ideas", too long, unknown category) under "Please check" | `POST /memories/batch` |
| `store_memories` | Same for 1–100 memories in one call - much faster than one `store_memory` each, so Claude uses it whenever it has two or more | `POST /memories/batch` |
| `search_memories` | Hybrid meaning + keyword search (`query`, optional `limit`, `category`) | `GET /search` |
| `get_related_memories` | The memories linked to one memory (`memoryId`, `limit`) | `GET /nodes/:id/related` |
| `get_brain_overview` | A compact map: counts, main people/places/organisations/projects, and top keywords and latest titles per category (optional `category`). About 650 tokens however big the brain gets | `GET /overview` |
| `update_memory` | Edits a memory (`memoryId`, plus `title`, `content`, `categories`, `keywords`; lists replace the full set) | `PATCH /nodes/:id` |
| `delete_memory` | Deletes a memory | `DELETE /nodes/:id` |
| `recalculate_relationships` | Re-scores every link with the current formula. Free, local only | `POST /graph/recalculate-relationships` |
| `add_wishlist_item` | Adds something you're thinking of buying, or records another mention of it | `POST /wishlist` |
| `list_wishlist` | Lists the wishlist (optional `query`, `status`). Bought and dropped items are left out unless asked for | `GET /wishlist` |
| `update_wishlist_item` | Moves an item along or edits it | `PATCH /wishlist/:id` |
| `add_inbox_items` | Adds options to Axon's inbox (the Axon tab): each with impact, effort, minutes and a one-click start link. `expireOld` replaces earlier unanswered options from the same source. `kind: idea` adds an idea the critic said "do" to (why = the reason); the server keeps at most 3 a day and blocks repeats of an idea from the last 90 days (embedding similarity ≥ 0.7, ≥ 0.6 against rejected ones) | `POST /inbox` |
| `list_inbox` | Lists open options plus the last week's done and rejected ones, with notes, reasons and XP / level / discipline (`scope`: recent, pending, all) | `GET /inbox` |
| `update_inbox_item` | Records done (with a note - required for series steps), later ("not today") or rejected ("not for me"). For ideas: done = yes, do it; later = park; rejected = drop. Done adds XP, except for ideas. `why` replaces an idea's recommendation text (deep-think reruns). A note `next (<date time>): <keep going | a decision>` on a deep-think idea, with no status, steers the next night's deep think | `PATCH /inbox/:id` |

### Wishlist rules

- **Name the need, not the brand** ("Fitness watch" while comparing Garmin
  and Apple Watch), unless you're set on one exact thing ("a ticket to that one festival
  ticket"). The test: would a different brand or model still count?
- **Same name = same item.** A repeat mention raises its count and keeps the
  note. A new name that looks like an existing item (a shared name word or
  two shared keywords) is refused with the lookalikes listed, so Claude can
  reuse the name or re-send with `force: true`.
- **Statuses:** idea → researching (comparing) → ready (decided, buying with
  the next paycheck; the item is renamed to the exact model) → bought, or
  dropped.
- **Options** (`optionDetails`) are the specific products being weighed,
  each with `text`, `summary`, `price`, `link`, `pros`, `cons`, `ruledOut`.
  The Wishlist page shows them side by side. `chooseOption` picks the winner
  and moves the item to ready; `removeOption` deletes one.
- **Photos** (`link`, `imageUrl`) are downloaded from the product page's
  preview image. The page only shows them for ready items with a link.
- Keywords are matched onto the brain's existing keywords and never create
  new ones, so the wishlist costs nothing.

## Troubleshooting

- **"Connection refused":** the API isn't running. Start it with
  `npm run dev` (or `npm run restart` to restart it in the background) and
  check `curl http://localhost:3001/api/health`.
- **Server not found in Claude Desktop:** check the absolute path in the
  config and that the JSON is valid, then fully quit and reopen the app.
- **Claude doesn't use the tools:** add the standing instruction above, or
  be explicit ("Use ai-brain to remember…").
- **API or embedding errors:** check the keys in the main `.env`, not the
  MCP config.
- **Debugging:** run `node mcp-server/index.js` directly to see its output.

## Changing the server

- Add a tool in two places in `index.js`: the `ListToolsRequestSchema`
  handler (definition) and the `CallToolRequestSchema` handler (what it
  does).
- Claude apps run the MCP server from the **main checkout**. They pick up
  changes only after they're merged to main and the app is restarted (and
  after `npm install` in `mcp-server/` if its dependencies changed).
- `CLAUDE.md` lists what else must stay in sync with the server.

## Removing it

Delete the `ai-brain` entry from the Claude Desktop config (or run
`claude mcp remove ai-brain --scope user`) and restart. Your memories stay in
`data/brain.db`.
