/**
 * Guard for the CI trigger policy (#59).
 *
 * The project rule is "run CI at the build stage, not on every PR": pull
 * requests must not trigger the workflow, while merges to `main` and manual
 * dispatch must. This test fails if someone re-adds a PR trigger or drops the
 * build-stage hook — the branch protection no longer requires PR checks, so
 * this file is the only guard against silent policy drift.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Extract the top-level `on:` block (up to the next top-level key). */
function triggerBlock(workflow) {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => line === 'on:')
  assert.notEqual(start, -1, 'ci.yml must declare a top-level `on:` trigger block')
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') continue
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

test('ci.yml is not triggered by pull requests', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  const block = triggerBlock(workflow)
  assert.doesNotMatch(block, /^\s+pull_request:/m, 'PRs must not trigger CI (build-stage rule)')
})

test('ci.yml still runs after merge and on manual dispatch', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  const block = triggerBlock(workflow)
  assert.match(block, /^\s+push:/m, 'merges to main must still run CI')
  assert.match(block, /^\s+branches:\s*\[main\]$/m, 'the push trigger must stay limited to main')
  assert.match(block, /^\s+workflow_dispatch:/m, 'manual dispatch is the build-stage hook')
})

test('the compat-next channel job survives the trigger change', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(workflow, /^ {2}compat-next:$/m, 'compat-next must remain a top-level job')
  assert.match(workflow, /bash scripts\/compat-check\.sh/, 'compat-next must keep using the shared script')
})

test('the platform matrix keeps all three OSes and enables Windows long paths (#18)', async () => {
  const workflow = await readFile(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
    assert.ok(workflow.includes(os), `the matrix must keep ${os}`)
  }
  assert.match(workflow, /if: matrix\.name == 'windows'/, 'the Windows job must gate the long-path step')
  assert.match(workflow, /LongPathsEnabled/, 'the Windows job must enable >260 character paths')
})
