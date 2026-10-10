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
 *   ① 暂存产物 mtime **早于 HEAD 提交时间** ⇒ 它不可能是本次源码的产物。
 *      用"早于 HEAD 提交时间"而不是"早于 N 小时"，是为了不依赖机器时钟的绝对时刻。
 *   ② 暂存后端自报的 `_internal/VERSION` **必须等于本仓库 `package.json` 的版本**。
 *
 * ⚠️ 判据 ② 是 2026-10-10 补的（round 208）。**只有判据 ① 的版本是 fail-open 的**：
 *   `cp -r` / `robocopy` 会把 mtime **刷新成复制那一刻**，于是
 *   「一份陈旧后端被复制进 backend/」就能满足「mtime 晚于 HEAD」而**过闸门**。
 *
 *   实测（2026-10-10）：
 *     * 仓库 `package.json` = `1.3.1081`；
 *     * `backend/_internal/VERSION` = **`1.3.1079`**（陈旧两个版本）；
 *     * `backend/scada-backend.exe` mtime = 11:58:57，HEAD 提交时间 = 11:58:02
 *       —— 只差 **55 秒**，闸门**放行**；
 *     * 结果打出的安装包是「前端 1.3.1081 + 后端 1.3.1079」，
 *       `/api/health/status` 自报 `1.3.1079`，而 UI 是 1.3.1081。
 *   **这就是「只断言时间、不断言内容」的典型 fail-open** ——
 *   判据与「产物能不能用」之间隔着一层，而那层正好被 `cp` 抹掉了。
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
//: 冻结产物里版本号的唯一真源（`scada-backend.spec` 的 `datas` 把仓库 `VERSION` 放到这里）。
const VERSION_REL = path.join('_internal', 'VERSION')

/**
 * 本仓库（前端）的版本号 —— lockstep 的参照物。
 * @returns {string|null}
 */
function repoVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    return pkg && pkg.version ? String(pkg.version) : null
  } catch {
    return null
  }
}

/**
 * 暂存后端自报的版本号。
 * @returns {string|null}
 */
function stagedVersion(dir = DEFAULT_DIR) {
  try {
    return fs.readFileSync(path.join(dir, VERSION_REL), 'utf8').trim() || null
  } catch {
    return null
  }
}

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
 * @returns {{ok: boolean, reason?: string, entryMtime?: number, headTime?: number|null,
 *            stagedVersion?: string|null, repoVersion?: string|null}}
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

  // ---- 判据 ②：版本一致性（fail-closed）----
  const want = repoVersion()
  const got = stagedVersion(dir)

  if (got == null) {
    return {
      ok: false,
      entryMtime: mtimeSec,
      headTime,
      stagedVersion: null,
      repoVersion: want,
      reason:
        `暂存产物里读不到 ${path.join(dir, VERSION_REL)} —— 冻结产物**缺版本号**，\n` +
        '  无法判断它与本仓库是不是同一个版本（也就无法保证安装包里前后端一致）。\n' +
        '  多半是 `scada-backend.spec` 的 `datas` 漏了 `VERSION`，或暂存目录不完整。',
    }
  }

  if (want != null && got !== want) {
    return {
      ok: false,
      entryMtime: mtimeSec,
      headTime,
      stagedVersion: got,
      repoVersion: want,
      reason:
        `暂存后端的版本与本仓库**不一致**：暂存 = ${got}，本仓库 package.json = ${want}。\n` +
        `  暂存后端自报版本：${path.join(dir, VERSION_REL)} = ${got}\n` +
        '  打包会产出「前端是 X、后端是 Y」的错版本安装包，\n' +
        '  且 `/api/health/status` 会自报错版本（UI 与后端版本对不上）。\n' +
        '  ⚠️ 光靠 mtime 判据拦不住这种情况：`cp -r` / `robocopy` 会把 mtime\n' +
        '     刷新成复制那一刻，一份**陈旧后端**复制进来照样满足「mtime 晚于 HEAD」。\n' +
        '  请用当前 HEAD 重新构建后端（`python -m PyInstaller scada-backend.spec --noconfirm`）\n' +
        '  并重新暂存后再打包。',
    }
  }

  return { ok: true, entryMtime: mtimeSec, headTime, stagedVersion: got, repoVersion: want }
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
  console.log(
    `[staging] OK：${path.join(dir, ENTRY)} 是本次源码之后的产物（HEAD=${head}），` +
    `版本一致 = ${r.stagedVersion}`,
  )
  return 0
}

module.exports = {
  assessStaging, headCommitTime, repoVersion, stagedVersion,
  DEFAULT_DIR, ENTRY, VERSION_REL,
}

if (require.main === module) {
  process.exit(main())
}
