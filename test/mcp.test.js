// MCP server smoke tests: it starts, lists its tools, and its read tools
// reach the API. Plus the hand-kept copy of the category list still
// matches the server's (see "Keeping the MCP server in sync" in CLAUDE.md).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { startServer, ROOT } from './helpers.js'

// The SDK is a dependency of mcp-server/, not the app.
const require = createRequire(join(ROOT, 'mcp-server', 'package.json'))
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'))
const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'))

const EXPECTED_TOOLS = [
  'store_memory', 'store_memories', 'search_memories', 'get_related_memories',
  'get_brain_overview', 'update_memory', 'delete_memory', 'recalculate_relationships',
  'add_wishlist_item', 'list_wishlist', 'update_wishlist_item',
  'add_inbox_items', 'list_inbox', 'update_inbox_item'
]

let server, client
before(async () => {
  server = await startServer()
  client = new Client({ name: 'smoke-test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'mcp-server', 'index.js')],
    env: { ...process.env, AI_BRAIN_API_URL: server.base },
    stderr: 'ignore'
  }))
})
after(async () => {
  await client?.close()
  await server?.stop()
})

test('MCP server lists every tool', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(t => t.name).sort(), [...EXPECTED_TOOLS].sort())
})

test('MCP read tools reach the API', async () => {
  for (const name of ['get_brain_overview', 'list_wishlist', 'list_inbox']) {
    const result = await client.callTool({ name, arguments: {} })
    assert.notEqual(result.isError, true, `${name} failed: ${JSON.stringify(result.content)}`)
  }
})

test('MCP category list matches the server', () => {
  const list = (file, name) => {
    const src = readFileSync(join(ROOT, file), 'utf-8')
    const match = src.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))
    assert.ok(match, `${name} not found in ${file}`)
    return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  }
  assert.deepEqual(list('mcp-server/index.js', 'CATEGORIES'), list('server/services/db.js', 'CANONICAL_CATEGORIES'))
})
