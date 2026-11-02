#!/usr/bin/env node

/**
 * One-command setup for Neuroverse: `npm run setup`
 *
 * 1. Checks Node is new enough
 * 2. Installs dependencies (app + MCP server)
 * 3. Writes .env, asking only for the keys that are missing
 * 4. Connects the ai-brain MCP server to Claude Desktop and/or Claude Code
 * 5. Offers to start the app
 *
 * Built-ins only, so it runs on a fresh clone before `npm install`. Safe to
 * re-run: existing .env values and MCP entries are kept, and the Claude
 * Desktop config is backed up before it's changed.
 *
 * Flags: --skip-install  skip npm install
 *        --no-start      don't offer to start the app at the end
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir, platform } from 'os'
import { spawnSync, spawn } from 'child_process'
import readline from 'readline'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = join(ROOT, '.env')
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example')
const MCP_ENTRY = join(ROOT, 'mcp-server', 'index.js')
const MIN_NODE_MAJOR = 20

const args = new Set(process.argv.slice(2))
const isWindows = platform() === 'win32'
const npm = isWindows ? 'npm.cmd' : 'npm'

const bold = s => `\x1b[1m${s}\x1b[0m`
const dim = s => `\x1b[2m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const red = s => `\x1b[31m${s}\x1b[0m`
const ok = msg => console.log(`  ${green('✓')} ${msg}`)
const warn = msg => console.log(`  ${yellow('!')} ${msg}`)
const step = (n, title) => console.log(`\n${bold(`${n}. ${title}`)}`)

// --- prompts --------------------------------------------------------------

function ask(question, { secret = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (secret) {
      // Echo the prompt, then mask everything typed after it
      let prompted = false
      rl._writeToOutput = str => {
        if (!prompted) { rl.output.write(str); prompted = true }
        else if (str.includes('\n') || str.includes('\r')) rl.output.write('\n')
        else rl.output.write('*'.repeat(str.length))
      }
    }
    rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
  })
}

async function confirm(question, defaultYes = true) {
  const answer = (await ask(`${question} ${dim(defaultYes ? '[Y/n]' : '[y/N]')} `)).toLowerCase()
  if (!answer) return defaultYes
  return answer.startsWith('y')
}

// --- .env -----------------------------------------------------------------

// Same parsing rules as server/config.js
function parseEnv(text) {
  const env = {}
  for (let line of text.split('\n')) {
    line = line.trim()
    if (!line || line.startsWith('#')) continue
    const [key, ...values] = line.split('=')
    env[key.trim()] = values.join('=').trim()
  }
  return env
}

// Replace a key's line in place, or append it, so comments and order survive
function setEnvValue(text, key, value) {
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm')
  if (re.test(text)) return text.replace(re, `${key}=${value}`)
  return `${text.replace(/\n*$/, '\n')}${key}=${value}\n`
}

const isPlaceholder = v => !v || v.startsWith('your_') || v.includes('your-key')

// Free endpoints - listing models doesn't spend tokens
async function checkKey(name, value) {
  const req = name === 'OPENAI_API_KEY'
    ? ['https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${value}` } }]
    : ['https://api.anthropic.com/v1/models', { headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01' } }]
  try {
    const res = await fetch(...req, { signal: AbortSignal.timeout(8000) })
    if (res.ok) return 'valid'
    if (res.status === 401 || res.status === 403) return 'invalid'
    return 'unknown'
  } catch {
    return 'unknown' // offline, firewall, etc. - don't block setup on it
  }
}

const KEYS = [
  {
    name: 'OPENAI_API_KEY',
    label: 'OpenAI API key',
    why: 'used for embeddings (search and layout) - fractions of a cent per memory',
    url: 'https://platform.openai.com/api-keys',
    prefix: 'sk-',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API key',
    why: 'Claude reads conversations and answers questions about your memories',
    url: 'https://console.anthropic.com/settings/keys',
    prefix: 'sk-ant-',
  },
]

async function setupEnv() {
  let text
  if (existsSync(ENV_PATH)) {
    text = readFileSync(ENV_PATH, 'utf-8')
    ok('Found existing .env - keeping what\'s already set')
  } else {
    text = readFileSync(ENV_EXAMPLE_PATH, 'utf-8')
  }
  const env = parseEnv(text)

  // Your name isn't asked here any more - the First Light intro asks for it
  // the first time you open the app, and saves it in the database.

  for (const key of KEYS) {
    if (!isPlaceholder(env[key.name])) {
      ok(`${key.label} already set`)
      continue
    }
    console.log(`\n  ${bold(key.label)} ${dim(`- ${key.why}`)}`)
    console.log(`  ${dim(`Get one at ${key.url}`)}`)
    let value = ''
    while (!value) {
      value = await ask('  Paste it here: ', { secret: true })
      if (!value) { warn('A key is required to continue (Ctrl+C to quit)'); continue }
      if (!value.startsWith(key.prefix)) {
        warn(`That doesn't look like an ${key.label} (expected it to start with "${key.prefix}")`)
        if (!(await confirm('  Use it anyway?', false))) { value = ''; continue }
      }
      const status = await checkKey(key.name, value)
      if (status === 'valid') ok('Key works')
      else if (status === 'invalid') {
        warn(`${key.label.split(' ')[0]} rejected that key`)
        if (!(await confirm('  Use it anyway?', false))) value = ''
      } else warn('Couldn\'t check the key right now (offline?) - saving it anyway')
    }
    text = setEnvValue(text, key.name, value)
  }

  writeFileSync(ENV_PATH, text, { mode: 0o600 })
  ok(`Saved ${dim('.env')} (only readable by you, ignored by git)`)
  return parseEnv(text)
}

// --- MCP ------------------------------------------------------------------

function claudeDesktopConfigPath() {
  const home = homedir()
  if (platform() === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  if (isWindows) return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  return join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

// Absolute path to node: Claude Desktop launches servers with a bare PATH, so
// plain "node" often isn't found (nvm, fnm, Homebrew, ...). Prefer the PATH's
// node over process.execPath - Homebrew's execPath is a versioned Cellar path
// that breaks on the next `brew upgrade`, while /usr/local/bin/node survives.
function nodePath() {
  const which = spawnSync(isWindows ? 'where' : 'which', ['node'], { encoding: 'utf-8' })
  const found = which.status === 0 && which.stdout.split(/\r?\n/)[0].trim()
  return found && existsSync(found) ? found : process.execPath
}

function mcpServerEntry(apiUrl) {
  return {
    command: nodePath(),
    args: [MCP_ENTRY],
    env: { AI_BRAIN_API_URL: apiUrl },
  }
}

async function setupClaudeDesktop(apiUrl) {
  const configPath = claudeDesktopConfigPath()
  const appInstalled = existsSync(dirname(configPath))
  if (!appInstalled) {
    warn(`Claude Desktop not found ${dim('(get it at https://claude.ai/download, then re-run setup)')}`)
    return false
  }

  let config = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      warn(`Couldn't read ${configPath} (invalid JSON) - leaving it alone`)
      warn('Fix the file or add the server by hand: see docs/MCP_SETUP.md')
      return false
    }
  }

  const desired = mcpServerEntry(apiUrl)
  const existing = config.mcpServers?.['ai-brain']
  if (existing && JSON.stringify(existing) === JSON.stringify(desired)) {
    ok('Claude Desktop is already connected')
    return true
  }

  const prompt = existing
    ? 'Claude Desktop already has an "ai-brain" server pointing somewhere else. Update it to this folder?'
    : 'Connect Neuroverse to Claude Desktop?'
  if (!(await confirm(`  ${prompt}`))) return false

  if (existsSync(configPath)) {
    const backup = `${configPath}.backup-${Date.now()}`
    copyFileSync(configPath, backup)
    console.log(`  ${dim(`Backed up the old config to ${backup}`)}`)
  } else {
    mkdirSync(dirname(configPath), { recursive: true })
  }

  config.mcpServers = { ...config.mcpServers, 'ai-brain': desired }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  ok('Connected to Claude Desktop - quit and reopen it to pick up the change')
  return true
}

async function setupClaudeCode(apiUrl) {
  const which = spawnSync(isWindows ? 'where' : 'which', ['claude'], { encoding: 'utf-8' })
  if (which.status !== 0) {
    console.log(`  ${dim('Claude Code CLI not found - skipping')}`)
    return false
  }

  const existing = spawnSync('claude', ['mcp', 'get', 'ai-brain'], { encoding: 'utf-8' })
  if (existing.status === 0) {
    ok('Claude Code already has an "ai-brain" server')
    return true
  }
  if (!(await confirm('  Connect Neuroverse to Claude Code (all projects)?'))) return false

  const result = spawnSync('claude', [
    'mcp', 'add', 'ai-brain', '--scope', 'user',
    '-e', `AI_BRAIN_API_URL=${apiUrl}`,
    '--', nodePath(), MCP_ENTRY,
  ], { encoding: 'utf-8' })
  if (result.status === 0) {
    ok('Connected to Claude Code')
    return true
  }
  warn(`Couldn't add it automatically: ${(result.stderr || result.stdout).trim()}`)
  return false
}

// --- main -----------------------------------------------------------------

function run(cmd, cmdArgs, cwd) {
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: isWindows })
  if (result.status !== 0) {
    console.error(red(`\n  "${cmd} ${cmdArgs.join(' ')}" failed in ${cwd}`))
    process.exit(1)
  }
}

async function main() {
  console.log(`\n${bold('🧠 Neuroverse setup')}`)

  step(1, 'Checking Node')
  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE_MAJOR) {
    console.error(red(`  Node ${MIN_NODE_MAJOR}+ is required (you have ${process.versions.node}). Get it at https://nodejs.org`))
    process.exit(1)
  }
  ok(`Node ${process.versions.node}`)

  step(2, 'Installing dependencies')
  if (args.has('--skip-install')) {
    console.log(`  ${dim('Skipped (--skip-install)')}`)
  } else {
    run(npm, ['install', '--no-fund', '--no-audit'], ROOT)
    run(npm, ['install', '--no-fund', '--no-audit'], join(ROOT, 'mcp-server'))
    ok('Dependencies installed')
  }

  step(3, 'Your name and API keys')
  const env = await setupEnv()
  const apiUrl = `http://localhost:${env.PORT || 3001}/api`

  step(4, 'Connecting to Claude')
  const desktop = await setupClaudeDesktop(apiUrl)
  const code = await setupClaudeCode(apiUrl)

  console.log(`\n${green(bold('✨ Setup complete'))}`)
  if (desktop || code) {
    console.log(`\n  ${bold('Tip:')} to have Claude save memories without being asked, add this to`)
    console.log(`  Claude's custom instructions ${dim('(Settings → Profile)')}:\n`)
    console.log(dim('    Whenever I share something durable about myself - a preference, skill,'))
    console.log(dim('    project, goal, relationship, or opinion - call the ai-brain store_memory'))
    console.log(dim('    tool right away without asking, and carry on the conversation.'))
  }
  console.log(`\n  Start Neuroverse any time with ${bold('npm run dev')}, then open ${bold('http://localhost:3000')}`)
  console.log(`  ${dim('Claude can only reach your memories while it\'s running.')}\n`)

  if (!args.has('--no-start') && process.stdin.isTTY && await confirm('Start it now?')) {
    spawn(npm, ['run', 'dev'], { cwd: ROOT, stdio: 'inherit', shell: isWindows })
  }
}

main().catch(err => {
  console.error(red(`\nSetup failed: ${err.message}`))
  process.exit(1)
})
