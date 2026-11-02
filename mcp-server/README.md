# ai-brain MCP server

Lets Claude Desktop and Claude Code save and look up Neuroverse memories.
Each tool call becomes an HTTP request to the Neuroverse API
(`AI_BRAIN_API_URL`, default `http://localhost:3001/api`), so the app must be
running (`npm run dev` in the repo root).

```bash
npm install                                # once
curl http://localhost:3001/api/health      # checks the API is reachable
```

Setup, the full tool list and troubleshooting are in
[../docs/MCP_SETUP.md](../docs/MCP_SETUP.md). The quickest setup is
`npm run setup` from the repo root.

| File | What it is |
|---|---|
| `index.js` | The server: tool definitions, tool handlers and the `INSTRUCTIONS` sent to Claude |
| `claude_desktop_config.example.json` | Example Claude Desktop config |
