/**
 * 释放前的校验 — verify a 大肥鱼 archive before anything is written to disk.
 *
 * Checks, in order: zip structure, manifest presence + schema, payload/manifest
 * agreement, per-file sha256, policy compliance, and what will *not* work on this
 * machine (platform-bound binaries, runtime version drift).
 *
 * @module dsh-migrate/core/verify
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sha256File } from './manifest.mjs'
import { MANIFEST_ENTRY, validateManifest } from './manifest.mjs'
import { assertArchiveIsClean, isToolingPath } from './policy.mjs'
import { extractZip, listZip } from './zip.mjs'

/** Error thrown when an archive cannot be trusted. */
export class VerifyError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'VerifyError'
    this.code = code
    Object.assign(this, details)
  }
}

/**
 * Read and parse the manifest out of an archive.
 *
 * @param {string} zipPath
 * @returns {Promise<{manifest: object, entry: object}>}
 */
export async function readManifest(zipPath) {
  const { entries } = await listZip(zipPath)
  const entry = entries.find((item) => item.name === MANIFEST_ENTRY)
  if (!entry) throw new VerifyError('MANIFEST_MISSING', `archive has no ${MANIFEST_ENTRY}: ${zipPath}`)
  const temp = await mkdtemp(join(tmpdir(), 'dsh-migrate-manifest-'))
  try {
    await extractZip(zipPath, temp, { entries: [entry] })
    const text = await readFile(join(temp, MANIFEST_ENTRY), 'utf8')
    let manifest
    try {
      manifest = JSON.parse(text)
    } catch (error) {
      throw new VerifyError('MANIFEST_INVALID', `${MANIFEST_ENTRY} is not valid JSON: ${error.message}`)
    }
    return { manifest, entry }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

/**
 * Describe what a manifest's platform-bound payloads mean for the current machine.
 *
 * @param {object} manifest
 * @param {string} targetPlatform e.g. \`win32-x64\`
 */
export function platformReport(manifest, targetPlatform = `${process.platform}-${process.arch}`) {
  const targetFamily = targetPlatform.split('-')[0]
  const compatible = []
  const incompatible = []
  for (const item of manifest.platformBound ?? []) {
    const families = item.platforms.map((value) => String(value).toLowerCase())
    const exact = families.includes(targetPlatform.toLowerCase())
    const family = families.includes(targetFamily.toLowerCase())
    if (exact || family) compatible.push(item)
    else incompatible.push({ ...item, target: targetPlatform })
  }
  return { target: targetPlatform, compatible, incompatible }
}

// ---------------------------------------------------------------------------
// Node.js floor per target DSH line (#57)
// ---------------------------------------------------------------------------

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * Node.js floors for the DSH lines this plugin supports, newest first.
 *
 * The floor follows the *target* dsh version, not the packing host: `0.2.2`
 * declares `engines.node: ">=24.9.0"` in `apps/cli/package.json@dsh-v0.2.2-rc.1`,
 * while the `0.2.0` / `0.2.1` lines declare no `engines.node` and run on the
 * same floor this package declares. Source of truth: docs/upstream-compat.md.
 *
 * @type {ReadonlyArray<{since: string, minimum: string, range: string, source: string}>}
 */
const NODE_REQUIREMENTS = [
  {
    since: '0.2.2-rc.1',
    minimum: '24.9.0',
    range: '>=24.9.0',
    source: 'apps/cli/package.json@dsh-v0.2.2-rc.1 的 engines.node',
  },
  {
    since: '0.2.0-rc.2',
    minimum: '22.19.0',
    range: '^22.19.0 || >=24.0.0',
    source: '本包 engines.node（0.2.0 / 0.2.1 未声明 engines.node）',
  },
]

/**
 * Parse `24.9.0`, `v24.9.0` or `0.2.2-rc.1`; returns `undefined` for anything else.
 *
 * @param {unknown} text
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}|undefined}
 */
function parseVersion(text) {
  const match = VERSION_RE.exec(String(text ?? '').trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/** semver §11: release > prerelease, numeric identifiers < alphanumeric ones. */
function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1
      continue
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

function compareParsed(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * Node.js floor implied by a target DSH version, or `undefined` when unknown.
 *
 * Versions above the newest known line keep the newest known floor: it is a
 * conservative lower bound, not a claim about an unreleased dsh.
 *
 * @param {string} dshVersion e.g. `0.2.2-rc.1`
 * @returns {{since: string, minimum: string, range: string, source: string}|undefined}
 */
export function nodeRequirementFor(dshVersion) {
  const version = parseVersion(dshVersion)
  if (!version) return undefined
  for (const entry of NODE_REQUIREMENTS) {
    if (compareParsed(version, parseVersion(entry.since)) >= 0) return entry
  }
  return undefined
}

/**
 * Compare the runtimes recorded in the manifest with this machine.
 *
 * `local.node` is required for the Node check; `verifyArchive` fills it from the
 * running process so a release report always carries it. The Node floor comes
 * from the target DSH version (local `dsh` when detected, else the archive's
 * `source.dsh`), so `24.8.0` vs a `24.9.0` floor is caught even though both
 * share the same major version.
 *
 * @param {object} manifest
 * @param {{dsh?: string|null, pnpm?: string|null, node?: string}} [local]
 */
export function runtimeReport(manifest, local = {}) {
  const source = manifest.source ?? {}
  const warnings = []
  const info = []
  if (local.dsh && source.dsh && local.dsh !== source.dsh) {
    warnings.push(`DSH 版本不同：归档来自 ${source.dsh}，本机是 ${local.dsh}；请先安装 ${source.dsh} 或自行承担差异`)
  }
  if (!local.dsh && source.dsh) info.push(`归档记录的 DSH 版本：${source.dsh}（本机未检测到 dsh）`)
  const targetDsh = local.dsh || source.dsh
  const requirement = nodeRequirementFor(targetDsh)
  const localNode = parseVersion(local.node)
  if (localNode && requirement && compareParsed(localNode, parseVersion(requirement.minimum)) < 0) {
    warnings.push(`Node 版本过低：目标 DSH ${targetDsh} 要求 Node ${requirement.range}（来源：${requirement.source}），本机是 ${local.node}；请先升级 Node 再安装 dsh`)
  }
  const sourceNode = parseVersion(source.node)
  if (localNode && sourceNode && localNode.major !== sourceNode.major) {
    warnings.push(`Node 主版本不同：归档来自 ${source.node}，本机是 ${local.node}`)
  }
  if (local.pnpm && source.pnpm && local.pnpm !== source.pnpm) {
    info.push(`pnpm 版本不同：归档来自 ${source.pnpm}，本机是 ${local.pnpm}`)
  }
  return { warnings, info }
}

/**
 * Verify an archive end to end.
 *
 * @param {string} zipPath
 * @param {{ targetPlatform?: string, local?: object, hash?: boolean, extractDir?: string, onProgress?: (event: object) => void }} [options]
 * @returns {Promise<object>} verification report; throws only for unreadable archives
 */
export async function verifyArchive(zipPath, options = {}) {
  const {
    targetPlatform = `${process.platform}-${process.arch}`,
    local = {},
    hash = true,
    onProgress,
  } = options

  const errors = []
  const warnings = []

  const { entries } = await listZip(zipPath)
  const { manifest } = await readManifest(zipPath)

  const structure = validateManifest(manifest)
  errors.push(...structure.errors)

  const allowOptional = manifest.scope?.includeModels === true
  try {
    assertArchiveIsClean(entries, { allowOptional })
  } catch (error) {
    errors.push(error.message)
  }

  const payloadNames = entries
    .filter((entry) => !entry.isDirectory && entry.name !== MANIFEST_ENTRY && !isToolingPath(entry.name))
    .map((entry) => entry.name)
    .sort()
  const manifestNames = (manifest.entries ?? []).filter((entry) => entry.type === 'file').map((entry) => entry.path).sort()
  const missing = manifestNames.filter((name) => !payloadNames.includes(name))
  const extra = payloadNames.filter((name) => !manifestNames.includes(name))
  if (missing.length > 0) errors.push(`归档缺少 manifest 声明的文件：${missing.slice(0, 5).join(', ')}`)
  if (extra.length > 0) errors.push(`归档存在 manifest 未声明的文件：${extra.slice(0, 5).join(', ')}`)

  let hashed = 0
  let hashErrors = 0
  if (hash && structure.ok && missing.length === 0) {
    const workdir = options.extractDir ?? (await mkdtemp(join(tmpdir(), 'dsh-migrate-verify-')))
    const temporary = options.extractDir === undefined
    try {
      await extractZip(zipPath, workdir, {
        entries: entries.filter((entry) => !entry.isDirectory && entry.name !== MANIFEST_ENTRY),
      })
      const toHash = [
        ...(manifest.entries ?? []).filter((entry) => entry.type === 'file'),
        ...(manifest.tooling ?? []),
      ]
      for (const entry of toHash) {
        const actual = await sha256File(join(workdir, entry.path))
        hashed++
        if (actual !== entry.sha256) {
          hashErrors++
          if (hashErrors <= 5) errors.push(`sha256 不一致：${entry.path}`)
        }
        onProgress?.({ phase: 'hash', done: hashed, total: toHash.length, current: entry.path })
      }
    } finally {
      if (temporary) await rm(workdir, { recursive: true, force: true })
    }
  }

  const platform = platformReport(manifest, targetPlatform)
  // A release report always knows its own Node version; callers that pin the
  // whole runtime triple (tests) still override it.
  const runtime = runtimeReport(manifest, { node: process.versions.node, ...local })
  warnings.push(...runtime.warnings)
  if (platform.incompatible.length > 0) {
    warnings.push(`${platform.incompatible.length} 个平台绑定项在本机（${targetPlatform}）不适用，需要重建：${platform.incompatible.slice(0, 5).map((item) => item.path).join(', ')}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info: runtime.info,
    manifest,
    archive: { path: zipPath, entries: entries.length, payloadFiles: payloadNames.length },
    hashed,
    platform,
    runtime,
  }
}
