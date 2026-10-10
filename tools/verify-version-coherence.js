#!/usr/bin/env node
/**
 * 打包**产物**侧的版本一致性闸门（round 208）。
 *
 * 为什么需要它
 * ------------
 * `verify-staging.js` 管的是**源**（`backend/`），而用户装到机器上的是**产物**
 * （`release/win-unpacked/resources/**`）。两者之间隔着 electron-builder 的复制
 * 与 `extraResources` 过滤 —— 源目录版本对了，产物照样可能是别的版本。
 * （同一族教训见 skill `ci-gate-hardening` 的「3b 源 vs 产物：链上每一步都要单独验」。）
 *
 * 实测（2026-10-10）：打出来的安装包是「前端 `1.3.1081` + 后端 `1.3.1079`」，
 * 而当时的 `verify-staging.js` **只查 mtime、完全不查版本** ——
 * `cp -r` 会把 mtime 刷新成复制那一刻，一份陈旧后端复制进来就能过闸门。
 * 后果：`/api/health/status` 自报 `1.3.1079`，UI 却是 `1.3.1081`。
 *
 * 判据（fail-closed）
 * ------------------
 * 以本仓库 `package.json` 的 `version` 为**唯一参照物**（前后端 lockstep 是项目铁律），
 * 逐个断言下列位置与之相等：
 *   1. `<packaged>/resources/backend/_internal/VERSION`（产物里的后端自报版本）
 *   2. `<packaged>/resources/app.asar` 内 `package.json` 的 `version`（产物里的前端版本）
 *   3. 可选 `--require-source` 时，`backend/_internal/VERSION`（暂存源）
 *
 * 任何一项读不到 / 对不上 → 退出码 1。**没有「跳过」分支** ——
 * 读不到就是读不到，不能当成通过。
 *
 * 用法
 * ----
 *   node tools/verify-version-coherence.js [--packaged <dir>] [--source <dir>] [--require-source]
 * 默认 `--packaged release/win-unpacked`、`--source backend`。
 * 退出码：0 = 通过；1 = 不通过；2 = 用法错误。
 */

'use strict'

const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const DEFAULT_PACKAGED = 'release/win-unpacked'
const DEFAULT_SOURCE = 'backend'
const BACKEND_VERSION_REL = path.join('_internal', 'VERSION')

function repoVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  if (!pkg || !pkg.version) throw new Error('package.json 里没有 version')
  return String(pkg.version)
}

/**
 * 从 asar 里按路径读出文件内容（不落盘）。
 * 与 `verify-asar.js` 同一姿势：用 `@electron/asar` 的 `getRawHeader` 自己下钻，
 * 规避 Windows 上 `path.sep` 导致的 `statFile` 误报。
 */
function readFromAsar(asarPath, relPath) {
  let getRawHeader
  try {
    ({ getRawHeader } = require('@electron/asar'))
  } catch {
    getRawHeader = require(path.join(REPO, 'node_modules', '@electron/asar')).getRawHeader
  }
  const raw = getRawHeader(asarPath)
  const header = raw.header
  const fileDataBase = 8 + raw.headerSize

  let node = { files: header.files }
  for (const part of relPath.split('/').filter(Boolean)) {
    if (!node || !node.files || !node.files[part]) return null
    node = node.files[part]
  }
  if (node.offset === undefined) return null

  const offset = fileDataBase + Number(node.offset)
  const buf = Buffer.alloc(Number(node.size))
  const fd = fs.openSync(asarPath, 'r')
  try {
    fs.readSync(fd, buf, 0, buf.length, offset)
  } finally {
    fs.closeSync(fd)
  }
  return buf.toString('utf8')
}

function readVersionFile(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim() || null
  } catch {
    return null
  }
}

function collectChecks(packagedDir, sourceDir, requireSource) {
  const checks = []

  checks.push({
    label: '产物后端 <packaged>/resources/backend/_internal/VERSION',
    where: path.join(packagedDir, 'resources', 'backend', BACKEND_VERSION_REL),
    required: true,
    read: () => readVersionFile(path.join(packagedDir, 'resources', 'backend', BACKEND_VERSION_REL)),
  })

  checks.push({
    label: '产物前端 <packaged>/resources/app.asar → package.json',
    where: path.join(packagedDir, 'resources', 'app.asar') + '!package.json',
    required: true,
    read: () => {
      const asarPath = path.join(packagedDir, 'resources', 'app.asar')
      if (!fs.existsSync(asarPath)) return null
      const text = readFromAsar(asarPath, 'package.json')
      if (text == null) return null
      try {
        return String(JSON.parse(text).version || '') || null
      } catch {
        return null
      }
    },
  })

  if (requireSource) {
    checks.push({
      label: '暂存源 <source>/_internal/VERSION',
      where: path.join(sourceDir, BACKEND_VERSION_REL),
      required: true,
      read: () => readVersionFile(path.join(sourceDir, BACKEND_VERSION_REL)),
    })
  }

  return checks
}

function main(argv = process.argv.slice(2)) {
  let packagedDir = DEFAULT_PACKAGED
  let sourceDir = DEFAULT_SOURCE
  let requireSource = false

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--packaged') {
      packagedDir = argv[i + 1]
      if (!packagedDir) { console.error('[用法错误] --packaged 缺少取值'); return 2 }
      i += 1
    } else if (a === '--source') {
      sourceDir = argv[i + 1]
      if (!sourceDir) { console.error('[用法错误] --source 缺少取值'); return 2 }
      i += 1
    } else if (a === '--require-source') {
      requireSource = true
    } else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/verify-version-coherence.js [--packaged <dir>] [--source <dir>] [--require-source]')
      return 0
    } else {
      console.error(`[用法错误] 未知参数: ${a}`)
      return 2
    }
  }

  let want
  try {
    want = repoVersion()
  } catch (e) {
    console.error(`[version] 读不到本仓库版本号：${e.message}`)
    return 1
  }

  const checks = collectChecks(packagedDir, sourceDir, requireSource)
  const bad = []

  console.log(`[version] 参照物：package.json version = ${want}`)
  for (const c of checks) {
    const got = c.read()
    if (got == null) {
      bad.push(`  ✗ ${c.label}\n      读不到：${c.where}`)
      console.log(`  ✗ ${c.label} → 读不到`)
    } else if (got !== want) {
      bad.push(`  ✗ ${c.label}\n      期望 ${want}，实际 ${got}（${c.where}）`)
      console.log(`  ✗ ${c.label} → ${got}（期望 ${want}）`)
    } else {
      console.log(`  ✓ ${c.label} → ${got}`)
    }
  }

  if (bad.length) {
    console.error(
      '\n[version] 打包产物版本**不自洽** —— 用户装到机器上的那份前后端版本对不上：\n' +
      bad.join('\n') +
      '\n\n  修法：用当前 HEAD 重新构建后端 → 重新暂存到 backend/ → 重新打包。\n' +
      '  （只查 mtime 的判据挡不住这种：cp -r 会把 mtime 刷新，\n' +
      '    一份陈旧后端复制进来照样「看着很新」。）',
    )
    return 1
  }

  console.log('\n[version] OK：产物里的前端与后端版本一致，且等于本仓库 package.json。')
  return 0
}

module.exports = { main, repoVersion, collectChecks, readFromAsar, DEFAULT_PACKAGED, DEFAULT_SOURCE }

if (require.main === module) {
  process.exit(main())
}
