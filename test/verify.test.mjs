import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { pack } from '../lib/core/pack.mjs'
import { nodeRequirementFor, readManifest, runtimeReport, VerifyError, verifyArchive } from '../lib/core/verify.mjs'
import { ZipWriter, extractZip, listZip } from '../lib/core/zip.mjs'

let root
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-migrate-verify-'))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})

async function buildHome(name) {
  const home = join(root, name)
  const put = async (relative, content) => {
    const path = join(home, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  await put('AGENTS.md', '# instructions\n')
  await put('plugins/dsh-demo/entry.js', 'export function apply() {}\n')
  await put('plugins/dsh-demo/runtime/linux-x64/worker', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
  await put('profiles/web/package.json', '{"name":"dsh-profile-web"}\n')
  await put('artifacts/dsh-ops-0.3.1-linux-x64.tgz', 'tarball')
  return home
}

async function packFixture(name) {
  const home = await buildHome(name)
  const outPath = join(root, `${name}.zip`)
  await pack({ home, outPath, generator: { name: 'dsh-migrate', version: 'test' } })
  return outPath
}

/** Rebuild an archive with a mutated manifest (or extra payload files). */
async function repack(zipPath, name, { mutate = () => {}, extraFiles = {} } = {}) {
  const temp = await mkdtemp(join(root, `repack-${name}-`))
  await extractZip(zipPath, temp)
  const manifest = JSON.parse(await readFile(join(temp, 'manifest.json'), 'utf8'))
  mutate(manifest)
  const outPath = join(root, `${name}-tampered.zip`)
  const zip = await ZipWriter.create(outPath)
  await zip.add({ name: 'manifest.json', type: 'file', content: Buffer.from(JSON.stringify(manifest, null, 2)) })
  await zip.addTree(temp, { prefix: '', filter: (relative) => relative !== 'manifest.json' })
  for (const [relative, content] of Object.entries(extraFiles)) {
    await zip.add({ name: relative, type: 'file', content })
  }
  await zip.close()
  return outPath
}

test('verifyArchive accepts a freshly packed archive', async () => {
  const zipPath = await packFixture('good')
  const report = await verifyArchive(zipPath, { targetPlatform: `${process.platform}-${process.arch}` })
  assert.deepEqual(report.errors, [])
  assert.equal(report.ok, true)
  assert.equal(report.hashed, report.manifest.entries.filter((entry) => entry.type === 'file').length)
  assert.equal(report.archive.payloadFiles, report.hashed)
})

test('platformReport flags payloads that will not work here', async () => {
  const zipPath = await packFixture('platform')
  const onWindows = await verifyArchive(zipPath, { targetPlatform: 'win32-x64', hash: false })
  assert.ok(onWindows.platform.incompatible.length >= 1)
  assert.ok(onWindows.warnings.some((warning) => warning.includes('不适用')))
  assert.equal(onWindows.platform.compatible.length, 0)

  const onLinux = await verifyArchive(zipPath, { targetPlatform: 'linux-x64', hash: false })
  assert.equal(onLinux.platform.incompatible.length, 0)
  assert.equal(onLinux.platform.compatible.length, 2, 'ELF worker + linux-x64 tarball are usable on linux-x64')
})

test('a tampered payload hash is reported', async () => {
  const zipPath = await packFixture('hash')
  const tampered = await repack(zipPath, 'hash', {
    mutate: (manifest) => {
      manifest.entries.find((entry) => entry.path === 'AGENTS.md').sha256 = '0'.repeat(64)
    },
  })
  const report = await verifyArchive(tampered, { hash: true })
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((error) => error.includes('sha256 不一致')))
})

test('missing and extra payload files are both reported', async () => {
  const zipPath = await packFixture('missing')
  const missing = await repack(zipPath, 'missing', {
    mutate: (manifest) => {
      manifest.entries = manifest.entries.filter((entry) => entry.path !== 'AGENTS.md')
    },
  })
  const missingReport = await verifyArchive(missing, { hash: false })
  assert.equal(missingReport.ok, false)
  assert.ok(missingReport.errors.some((error) => error.includes('manifest 未声明的文件')))

  const extra = await repack(zipPath, 'extra', { extraFiles: { 'sneaky.txt': 'not in the manifest' } })
  const extraReport = await verifyArchive(extra, { hash: false })
  assert.equal(extraReport.ok, false)
  assert.ok(extraReport.errors.some((error) => error.includes('manifest 未声明的文件')))
})

test('a manifest that is absent or has a future schema is rejected', async () => {
  const bare = join(root, 'no-manifest.zip')
  const zip = await ZipWriter.create(bare)
  await zip.add({ name: 'plugins/a.js', type: 'file', content: 'x' })
  await zip.close()
  await assert.rejects(() => readManifest(bare), (error) => error instanceof VerifyError && error.code === 'MANIFEST_MISSING')

  const zipPath = await packFixture('schema')
  const patched = await repack(zipPath, 'schema', { mutate: (manifest) => { manifest.schemaVersion = 999 } })
  const report = await verifyArchive(patched, { hash: false })
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((error) => error.includes('schemaVersion')))
})

test('runtime drift is reported as warning or info', async () => {
  // Pin the recorded runtimes: on a CI runner there may be no dsh/pnpm on PATH at
  // all, and the comparison must not depend on the packing host.
  const zipPath = await repack(await packFixture('runtime'), 'runtime', {
    mutate: (manifest) => {
      manifest.source.dsh = '0.2.0-rc.2'
      manifest.source.node = '20.11.0'
      manifest.source.pnpm = '9.0.0'
    },
  })
  const report = await verifyArchive(zipPath, {
    hash: false,
    local: { dsh: '9.9.9-alpha', node: '18.0.0', pnpm: '1.0.0' },
  })
  assert.ok(report.warnings.some((warning) => warning.includes('DSH 版本不同')))
  assert.ok(report.warnings.some((warning) => warning.includes('Node 主版本不同')))
  assert.ok(report.info.some((entry) => entry.includes('pnpm 版本不同')))
})

test('the Node floor follows the target DSH version (#57)', () => {
  assert.equal(nodeRequirementFor('0.2.2-rc.1').minimum, '24.9.0')
  assert.equal(nodeRequirementFor('0.2.1-rc.2').minimum, '22.19.0')
  assert.equal(nodeRequirementFor('0.2.0-rc.2').minimum, '22.19.0')
  assert.equal(nodeRequirementFor('0.3.0').minimum, '24.9.0', 'an unknown newer line keeps the newest known floor')
  assert.equal(nodeRequirementFor('not-a-version'), undefined)

  const at = (dsh, node) => runtimeReport({ source: { dsh } }, { node })

  // The bug this fixes: 24.8 vs 24.9 share a major version, so a major-only
  // comparison stayed silent.
  assert.ok(at('0.2.2-rc.1', '24.8.0').warnings.some((warning) => warning.includes('Node 版本过低') && warning.includes('24.9.0')))
  assert.deepEqual(at('0.2.2-rc.1', '24.9.0').warnings, [])
  assert.deepEqual(at('0.2.2-rc.1', '25.0.0').warnings, [])
  assert.ok(at('0.2.1-rc.2', '22.18.9').warnings.some((warning) => warning.includes('Node 版本过低')))
  assert.deepEqual(at('0.2.1-rc.2', '22.19.0').warnings, [])
  // `node -v` prints a v prefix; that must not defeat the check.
  assert.deepEqual(at('0.2.2-rc.1', 'v24.9.0').warnings, [])

  // A detected local dsh decides the floor; the archive only supplies the
  // fallback when the target machine has no dsh yet.
  const localWins = runtimeReport({ source: { dsh: '0.2.1-rc.2' } }, { dsh: '0.2.2-rc.1', node: '24.8.0' })
  assert.ok(localWins.warnings.some((warning) => warning.includes('Node 版本过低')))

  // Without any target dsh version there is no floor to enforce.
  assert.deepEqual(runtimeReport({ source: {} }, { node: '18.0.0' }).warnings, [])
})

test('verifyArchive checks Node against the target DSH version', async () => {
  const zipPath = await repack(await packFixture('node-floor'), 'node-floor', {
    mutate: (manifest) => { manifest.source.dsh = '0.2.2-rc.1' },
  })
  const tooOld = await verifyArchive(zipPath, { hash: false, local: { node: '24.8.0' } })
  assert.ok(tooOld.warnings.some((warning) => warning.includes('Node 版本过低')))
  const fine = await verifyArchive(zipPath, { hash: false, local: { node: '24.9.0' } })
  assert.ok(!fine.warnings.some((warning) => warning.includes('Node 版本过低')))
})
