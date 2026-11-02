// Frontend smoke test: the app bundles, which catches broken imports and
// syntax errors in any component, including ones on tabs that are switched off.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './helpers.js'

test('frontend builds', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'brain-build-'))
  try {
    execFileSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'pipe' })
    assert.ok(existsSync(join(outDir, 'index.html')))
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
