// Shared set-up for the smoke tests: starts the real API server on a spare
// port against a brand-new, empty database in a temp folder. BRAIN_ENV_FILE
// points at a file that doesn't exist and the API keys are blanked, so the
// tests never read or write the real brain and can't make paid calls.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export async function startServer() {
  const dataDir = mkdtempSync(join(tmpdir(), 'brain-smoke-'))
  const port = await freePort()
  const env = {
    ...process.env,
    PORT: String(port),
    BRAIN_DATA_DIR: dataDir,
    BRAIN_ENV_FILE: join(dataDir, 'no.env'),
    OPENAI_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    USER_NAME: ''
  }
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', d => { output += d })
  child.stderr.on('data', d => { output += d })

  const base = `http://localhost:${port}/api`
  const deadline = Date.now() + 15000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output}`)
    try {
      if ((await fetch(`${base}/health`)).ok) break
    } catch {}
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`Server didn't start within 15 s:\n${output}`)
    }
    await new Promise(r => setTimeout(r, 100))
  }

  return {
    base,
    output: () => output,
    async stop() {
      child.kill()
      await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r))
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

// fetch + JSON, failing loudly with the server's reply on an unexpected status.
export async function api(base, path, { method = 'GET', body, status = 200 } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (res.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}
