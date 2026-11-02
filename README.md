# Neuroverse

<img src="assets/brand/neuroverse-mark.svg" width="72" alt="Neuroverse logo">

A personal memory for your AI conversations. While you chat with Claude,
the things worth remembering about you (projects, preferences, goals, the
people you mention) are saved as short memories. Neuroverse links related
ones together and shows them as a 3D star map you can explore, search and
ask questions of.

Everything runs on your own computer. Your memories live in one SQLite file
(`data/brain.db`) and are only sent to Anthropic and OpenAI to be processed.

_Formerly "AI Brain". The repo, the `ai-brain` MCP server and the database
still use that name._

## What it does

- **Saves memories as you chat.** Claude Desktop and Claude Code connect
  through an MCP server and save facts in the background, without being
  asked each time. You can also paste a conversation from any AI on
  the Home page.
- **Links related memories.** Each memory is one sentence. It's embedded,
  given categories and keywords, and linked to the memories it relates to.
- **Explore** shows the brain as a 3D star map. Bigger stars have more
  links, and a timeline replays the brain growing.
- **Ask** answers a question from your memories, with citations, and
  lights up the memories it used.
- **Reflect** has the brain ask you questions about the gaps in what it
  knows, plus stats and a weekly catch-up digest.
- **Axon** (an optional tab) lists a few small actions towards your
  goals, put there by Claude through the MCP server (e.g. a scheduled
  morning plan), with a little creature, also called Axon, that highlights the tab you're on and, on the Axon page, whatever you select.
  Sort them by impact, effort or time, open each with one click, and mark
  them done for XP. Below them, a few ideas Claude found worth your time
  (at most 3 a day, never a repeat), to say yes, park or drop to.
- **Tidy up** suggests likely duplicates for you to merge. Nothing is ever
  merged or deleted automatically.
- **Optional tabs** switch on from the "+" in the nav. Wishlist is the first:
  things you're thinking of buying, with options compared side by side.

## What you need

- **Node.js 20 or newer**
- **An Anthropic API key** ([console.anthropic.com](https://console.anthropic.com/)).
  Claude pulls memories out of text, answers Ask questions and writes the
  brain's questions.
- **An OpenAI API key** ([platform.openai.com](https://platform.openai.com/api-keys)).
  Used only for embeddings, which let memories be compared by meaning.
- Optional: **Claude Desktop** or **Claude Code**, so memories save
  automatically.

**Cost:** typical personal use is about a dollar a month, nearly all of it
Ask questions (about $0.007 each). Memories Claude saves and searching are
effectively free; pasting a conversation in is about $0.002. [COST.md](COST.md) lists every paid call.

## Quick start

From the repo folder:

```bash
npm run setup
```

This installs dependencies, asks for your two API keys (and checks they
work), connects Neuroverse to Claude Desktop and Claude Code, and offers to
start the app. It's safe to re-run: it keeps what's already set up and
backs up your Claude Desktop config before changing it.

Then open http://localhost:3000. The first visit plays a short intro that
asks your name and starts the brain.

### Manual setup

```bash
npm install
cp .env.example .env    # then add your keys
npm run dev
```

`npm run dev` starts the web app on port 3000 and the API on port 3001.
If either is down or stuck, `npm run restart` kills both and starts them
again in the background (logs in `~/Library/Logs/neuroverse-*.log`).
The settings in `.env`:

| Setting | Default | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Required |
| `OPENAI_API_KEY` | | Required (embeddings) |
| `EXTRACTION_MODEL` | `claude-haiku` | Model that splits text into memories. `claude-sonnet` or `gpt-4o` also work, but Haiku is the cheapest |
| `ANSWER_MODEL` | `claude-sonnet-5-5` | Answers Ask questions and writes digests |
| `QUESTION_MODEL` | `claude-sonnet-5-5` | Writes the brain's questions |
| `PORT` | `3001` | API port |
| `VITE_PORTFOLIO_URL` | | Optional link on Home (see [docs/PORTFOLIO.md](docs/PORTFOLIO.md)) |

To connect Claude by hand instead of through `npm run setup`, see
[docs/MCP_SETUP.md](docs/MCP_SETUP.md).

## Your data

- Everything is in `data/brain.db`. Back it up by copying `data/brain.db`
  (plus `brain.db-wal` and `brain.db-shm` if they exist).
- To start again, stop the app and delete `data/brain.db*`. A fresh brain is
  created on the next start.
- You can inspect it with `sqlite3 data/brain.db` or any SQLite browser.

## Troubleshooting

- **The app shows nothing / "connection refused":** check the API is up
  with `curl http://localhost:3001/api/health`. If port 3001 is taken, see
  what's using it with `lsof -i :3001`.
- **Claude isn't saving memories:** the API must be running (`npm run dev`)
  for the MCP server to reach it. After changing the MCP setup, restart the
  Claude app completely.
- **API errors when adding memories:** check both keys in `.env` and that
  the accounts have credit, then restart `npm run dev`.

## Tests

```
npm test
```

Smoke tests (`test/`, Node's built-in test runner) start the API and the MCP
server against a throwaway empty database with no API keys, so they never
touch your brain and cost nothing. They check that every page's API routes
answer, the wishlist/tabs/intro writes work, the MCP server lists its tools
and its category list matches the server's, the "two ideas in one" split finder behaves, and the frontend builds.
Run `npm install` in `mcp-server/` first. Takes about 10 seconds.

## How it's built

React + Vite and three.js on the front end; Node + Express, SQLite with
[`sqlite-vec`](https://github.com/asg017/sqlite-vec) for vector search and
FTS5 for keyword search on the back end; an MCP server for Claude.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, the data model, how linking and search work, and the design decisions |
| [docs/MEMORY_PIPELINE.md](docs/MEMORY_PIPELINE.md) | The path a memory takes from Claude to a star, and how Tidy up works |
| [docs/MCP_SETUP.md](docs/MCP_SETUP.md) | Connecting Claude, and every MCP tool |
| [COST.md](COST.md) | Every paid API call and what it costs |
| [docs/FEATURES_AND_SCALING.md](docs/FEATURES_AND_SCALING.md) | Feature list, and what happens at 10,000 memories |
| [docs/PORTFOLIO.md](docs/PORTFOLIO.md) | Using the brain as a portfolio-site background |
| [assets/brand/README.md](assets/brand/README.md) | Logo files and colours |
