#!/usr/bin/env node
/**
 * 打包前闸门：本地 `backend/` 暂存目录必须是**本次源码的产物**。
 *
 * 为什么需要这道门
 * ----------------
 * `package.json` 的 `build.extraResources` 会把 `backend/` 整个塞进安装包的
 * `resources/backend/`。CI 在打包前有一道「暂存目录必须是本次构建产物」的清理与断言，
 * **而本地没有** —— 于是直接 `npm run electron:build` 会打出一个
 * **版本号是新的、内容是旧的** 的包。
 *
 * 这不是假设，是实测（2026-10-08）：
 *   `backend/scada-backend.exe` 的 mtime 是 **9 月 22 日**，
 *   而 HEAD 提交时间是 **10 月 8 日** —— 落后 16 天、2052 个文件。
 *   当时的 `electron:build` 只跑 `verify:dist`，而 `verify:dist` 只看 `dist/`，
 *   **根本不会看 `backend/`**。也就是说这个陈旧包会被打出来、且四道闸门一道都拦不住。
 *
 * 判据（与 `gen_release_manifest.py` 的 `stale` 同一口径）
 * ------------------------------------------------------
 *   暂存产物 mtime **早于 HEAD 提交时间** ⇒ 它不可能是本次源码的产物。
 * 用"早于 HEAD 提交时间"而不是"早于 N 小时"，是为了不依赖机器时钟的绝对时刻。
 *
 * 用法
 * ----
 *   node tools/verify-staging.js [--dir backend]
 * 退出码：0 = 通过；1 = 不通过（fail-closed，绝不"跳过"）。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const DEFAULT_DIR = 'backend'
const ENTRY = 'scada-backend.exe'

/**
 * HEAD 提交时间（epoch 秒）。非 git 仓库返回 null（调用方据此降级）。
 */
function headCommitTime() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const n = Number(String(out).trim())
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/**
 * 判定暂存目录是否"陈旧"。
 * @returns {{ok: boolean, reason?: string, entryMtime?: number, headTime?: number|null}}
 */
function assessStaging(dir = DEFAULT_DIR, headTime = headCommitTime()) {
  const entry = path.join(dir, ENTRY)
  if (!fs.existsSync(entry)) {
    return {
      ok: false,
      reason:
        `暂存目录里没有 ${entry} —— 安装包会缺后端。\n` +
        '  先把后端产物复制进来（CI 的 "Stage backend into extraResources dir" 那一步），\n' +
        `  例如：robocopy <industrial_scada>\\dist\\scada-backend ${dir} /E`,
    }
  }

  const mtimeMs = fs.statSync(entry).mtimeMs
  const mtimeSec = Math.floor(mtimeMs / 1000)

  if (headTime != null && mtimeSec < headTime) {
    const days = ((headTime - mtimeSec) / 86400).toFixed(1)
    return {
      ok: false,
      entryMtime: mtimeSec,
      headTime,
      reason:
        `${entry} 比 HEAD 提交时间还旧（落后约 ${days} 天）—— 它不可能是本次源码的产物。\n` +
        `  mtime    = ${new Date(mtimeMs).toISOString()}\n` +
        `  HEAD 提交 = ${new Date(headTime * 1000).toISOString()}\n` +
        '  直接打包会产出「版本号是新的、内容是旧的」安装包。\n' +
        '  请重新构建后端并重新暂存后再打包。',
    }
  }

  return { ok: true, entryMtime: mtimeSec, headTime }
}

function main(argv = process.argv.slice(2)) {
  let dir = DEFAULT_DIR
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir' && argv[i + 1]) {
      dir = argv[i + 1]
      i += 1
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('用法: node tools/verify-staging.js [--dir backend]')
      return 0
    }
  }

  const r = assessStaging(dir)
  if (!r.ok) {
    console.error(`[staging] 暂存目录不可用于打包：\n  ${r.reason}`)
    return 1
  }
  const head = r.headTime == null ? '（非 git 仓库，跳过新鲜度判据）' : new Date(r.headTime * 1000).toISOString()
  console.log(`[staging] OK：${path.join(dir, ENTRY)} 是本次源码之后的产物（HEAD=${head}）`)
  return 0
}

module.exports = { assessStaging, headCommitTime, DEFAULT_DIR, ENTRY }

if (require.main === module) {
  process.exit(main())
}
