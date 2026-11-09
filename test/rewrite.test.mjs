import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import {
  applyRewritePlan, buildRewriteRules, findResiduals, normalizePrefix, rewriteText, ruleVariants, toPosixPath,
} from '../lib/core/rewrite.mjs'

let root
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-migrate-rewrite-'))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const put = async (relative, content) => {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
  return path
}

test('toPosixPath / normalizePrefix', () => {
  assert.equal(toPosixPath(String.raw`C:\Users\old\.dsh`), 'C:/Users/old/.dsh')
  assert.equal(normalizePrefix('/home/old/.dsh/'), '/home/old/.dsh')
  assert.equal(normalizePrefix(String.raw`C:\Users\old\.dsh\\`), 'C:/Users/old/.dsh')
  assert.equal(normalizePrefix('C:\\Users\\old\\.dsh\\'), 'C:/Users/old/.dsh', 'a trailing backslash must not break the prefix')
})

test('buildRewriteRules: longest first, deduped, no-ops dropped', () => {
  const rules = buildRewriteRules({
    from: '/home/old/.dsh',
    to: '/home/new/.dsh',
    extras: [
      { from: '/home/old/.dsh/profiles/web', to: '/srv/dsh/profiles/web' },
      { from: '/home/old/.dsh', to: '/home/new/.dsh' },
      { from: '/same', to: '/same' },
      { from: '', to: '/x' },
    ],
  })
  assert.equal(rules.length, 2)
  assert.equal(rules[0].from, '/home/old/.dsh/profiles/web', 'nested root wins over parent')
  assert.equal(rules[1].from, '/home/old/.dsh')
})

test('rewriteText covers POSIX, backslash and JSON-escaped spellings', () => {
  const rules = buildRewriteRules({
    from: '/home/old/.dsh',
    to: '/home/new/.dsh',
    extras: [{ from: String.raw`C:\Users\old\.dsh`, to: String.raw`C:\Users\new\.dsh` }],
  })

  const posix = rewriteText('"dsh-ops": "file:/home/old/.dsh/artifacts/dsh-ops.tgz"', rules)
  assert.equal(posix.text, '"dsh-ops": "file:/home/new/.dsh/artifacts/dsh-ops.tgz"')
  assert.equal(posix.hits, 1)

  const backslash = rewriteText(String.raw`path: C:\Users\old\.dsh\plugins`, rules)
  assert.equal(backslash.text, String.raw`path: C:\Users\new\.dsh\plugins`)

  const jsonEscaped = rewriteText(String.raw`"file:C:\\Users\\old\\.dsh\\a.tgz"`, rules)
  assert.equal(jsonEscaped.text, String.raw`"file:C:\\Users\\new\\.dsh\\a.tgz"`)

  const untouched = rewriteText('"unrelated": "/opt/other"', rules)
  assert.equal(untouched.hits, 0)
  assert.equal(untouched.text, '"unrelated": "/opt/other"')

  assert.ok(ruleVariants(rules[0]).length >= 3)
})

test('applyRewritePlan rewrites a tree; findResiduals then reports nothing', async () => {
  const tree = join(root, 'tree')
  const profile = await put('tree/profiles/web/package.json', JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { 'dsh-ops': 'file:/home/old/.dsh/artifacts/dsh-ops-0.3.1-linux-x64.tgz' },
  }, null, 2))
  await put('tree/profiles/web/cordis.patch.yml', 'config:\n  root: /home/old/.dsh/plugins\n')
  await put('tree/unrelated.md', 'nothing to do here\n')

  const before = await findResiduals(tree, ['/home/old/.dsh'])
  assert.equal(before.length, 2, JSON.stringify(before))

  const rules = buildRewriteRules({ from: '/home/old/.dsh', to: '/home/new/.dsh' })
  const result = await applyRewritePlan(tree, rules)
  assert.equal(result.files.length, 2)
  assert.ok(result.hits >= 2)

  const updated = await readFile(profile, 'utf8')
  assert.ok(updated.includes('file:/home/new/.dsh/artifacts/dsh-ops-0.3.1-linux-x64.tgz'))
  assert.equal((await findResiduals(tree, ['/home/old/.dsh'])).length, 0)

  // dry run must not write
  await put('tree/again.json', '{"p":"/home/old/.dsh/x"}')
  const dry = await applyRewritePlan(tree, rules, { dryRun: true })
  assert.equal(dry.files.length, 1)
  assert.ok((await readFile(join(tree, 'again.json'), 'utf8')).includes('/home/old/.dsh/x'))
})

test('binary payloads are never rewritten', async () => {
  const tree = join(root, 'binary-tree')
  const path = join(tree, 'blob.bin')
  await mkdir(tree, { recursive: true })
  await writeFile(path, Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from('/home/old/.dsh/plugins')]))
  const rules = buildRewriteRules({ from: '/home/old/.dsh', to: '/home/new/.dsh' })
  const result = await applyRewritePlan(tree, rules, { extensions: new Set(['.bin']) })
  assert.equal(result.files.length, 0)
  assert.ok((await readFile(path)).includes(Buffer.from('/home/old/.dsh/plugins')))
})

test('drive-letter rules rewrite forward, backslash and JSON-escaped spellings (#18)', () => {
  const rules = buildRewriteRules({ from: String.raw`C:\Users\old\.dsh`, to: String.raw`D:\Data\new\.dsh` })
  assert.equal(rules.length, 1)
  assert.equal(rules[0].from, 'C:/Users/old/.dsh', 'rules are normalized to POSIX separators')

  const yaml = rewriteText(String.raw`root: C:\Users\old\.dsh\plugins`, rules)
  assert.equal(yaml.text, String.raw`root: D:\Data\new\.dsh\plugins`)

  const forward = rewriteText('"file:C:/Users/old/.dsh/artifacts/dsh-ops.tgz"', rules)
  assert.equal(forward.text, '"file:D:/Data/new/.dsh/artifacts/dsh-ops.tgz"')

  const escaped = rewriteText(String.raw`{"p":"C:\\Users\\old\\.dsh\\plugins"}`, rules)
  assert.equal(escaped.text, String.raw`{"p":"D:\\Data\\new\\.dsh\\plugins"}`)
  assert.equal(escaped.hits, 1)
})

test('applyRewritePlan rewrites a Windows-spelled home inside a tree, then residuals are clean (#18)', async () => {
  const tree = join(root, 'drive-tree')
  await put('drive-tree/profiles/web/package.json', JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { 'dsh-ops': String.raw`file:C:\Users\old\.dsh\artifacts\dsh-ops.tgz` },
  }, null, 2))
  await put('drive-tree/config/paths.yml', String.raw`plugins: C:\Users\old\.dsh\plugins` + '\n')
  await put('drive-tree/config/posix.yml', 'plugins: C:/Users/old/.dsh/plugins\n')

  const rules = buildRewriteRules({ from: String.raw`C:\Users\old\.dsh`, to: String.raw`D:\Data\new\.dsh` })
  const needles = [String.raw`C:\Users\old\.dsh`, 'C:/Users/old/.dsh', String.raw`C:\\Users\\old\\.dsh`]
  const before = await findResiduals(tree, needles)
  assert.equal(before.length, 3, JSON.stringify(before))

  const result = await applyRewritePlan(tree, rules)
  assert.equal(result.files.length, 3)

  const pkg = JSON.parse(await readFile(join(tree, 'profiles/web/package.json'), 'utf8'))
  assert.equal(pkg.dependencies['dsh-ops'], String.raw`file:D:\Data\new\.dsh\artifacts\dsh-ops.tgz`)
  assert.equal((await readFile(join(tree, 'config/paths.yml'), 'utf8')).trim(), String.raw`plugins: D:\Data\new\.dsh\plugins`)
  assert.equal((await readFile(join(tree, 'config/posix.yml'), 'utf8')).trim(), 'plugins: D:/Data/new/.dsh/plugins')

  // The release residual scan is a plain substring search: pass both spellings.
  assert.deepEqual(await findResiduals(tree, needles), [])
})
