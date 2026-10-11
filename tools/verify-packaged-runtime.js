#!/usr/bin/env node
/**
 * **打包版**运行时闸门：直接启动 `release/win-unpacked/SmartSCADA.exe`，
 * 用 CDP 探针断言页面真的挂载出来了。
 *
 * 为什么必须有它（2026-10-10 事故②的教训）
 * ----------------------------------------
 * `verify:dist-runtime` 测的是 `dist/`（源产物、开发上下文）——
 * 而事故②里：**同一份字节，闸门里通过、装出来后必崩**
 * （socket.io ⇄ vendor-other 的 chunk 循环 + 懒加载时序，打包版必现）。
 * 「dist 绿 + asar 绿 + 全部单测绿」仍然可以产出一个灰白屏的安装包。
 * 所以要有一道闸门，测的必须是**要发出去的那只 exe 本身**。
 *
 * 判据（fail-closed，任何一步测不出来都判负）
 * ------------------------------------------
 *   1. `release/win-unpacked/SmartSCADA.exe` 必须存在；
 *   2. 用**一次性 userData**（`.vitest_cache/` 下的独立目录）启动，
 *      绝不碰 `%APPDATA%` 里的真实用户数据；
 *   3. 探测调试端口 → 连 CDP → 断言 `#app` 挂载出子节点（>0）；
 *   4. 应用的 stderr 日志里不得出现渲染层致命错误
 *      （`[Renderer] ... Uncaught/TypeError/initialization/...`）；
 *   5. **产物目录不留运行期垃圾**：探针会真启动产物，而后端把自己的
 *      模拟库 / WAL / `runtime.json` 写在 **exe 旁边**
 *      （`release/win-unpacked/resources/backend/_internal/data/`）。
 *      该目录**会被打进安装包**（`extraResources` 的 filter 没排除它），
 *      所以跑完必须把它恢复到跑之前的样子；恢复不干净 → 判负（fail-closed）。
 *   6. 无论成败，结束后杀掉整棵进程树。
 *
 * 用法
 * ----
 *   node tools/verify-packaged-runtime.js [--exe <路径>] [--port <n>] [--wait <秒>]
 *                                         [--keep-artifacts]
 * 退出码：0 = 通过；1 = 不通过。
 *   `--keep-artifacts` 仅供排查：保留本次运行期数据不清理（默认永不保留）。
 */

'use strict'

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const net = require('net')

const REPO = process.cwd()
const DEFAULT_EXE = path.join(REPO, 'release', 'win-unpacked', 'SmartSCADA.exe')
const BASE_DIR = path.join(REPO, '.vitest_cache', 'packaged-runtime')

//: 后端在自己的 exe 旁边写运行期状态（`_internal/data/`：模拟库 / WAL / runtime.json）。
//: 这里必须与后端 `paths.py` 的口径一致 —— 见下方 `runtimeDataDir()` 的说明。
//: 打包后 exe 在 `<app>/resources/backend/`（extraResources `to: backend/`），
//: 所以完整相对路径是 `resources/backend/_internal/data`。
const BACKEND_DATA_REL = ['resources', 'backend', '_internal', 'data']

//: 清理复核的重试次数 / 退避间隔。理由同冒烟闸门：进程刚被杀时句柄可能还没释放。
const CLEANUP_ATTEMPTS = 3
const CLEANUP_DELAY_MS = 500

function parseArgs(argv) {
  let exe = DEFAULT_EXE
  let port = 0 // 0 = 自动选一个空闲端口（CI/本机都可能撞端口，实测踩过）
  let waitSec = 30
  let keepArtifacts = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exe' && argv[i + 1]) { exe = path.resolve(argv[i + 1]); i += 1 }
    else if (argv[i] === '--port' && argv[i + 1]) { port = Number(argv[i + 1]); i += 1 }
    else if (argv[i] === '--wait' && argv[i + 1]) { waitSec = Number(argv[i + 1]); i += 1 }
    // 排查用：保留本次运行產生的状态，不清理（默认永不保留 —— 见 main() 的清理段）
    else if (argv[i] === '--keep-artifacts') { keepArtifacts = true }
  }
  return { exe, port, waitSec, keepArtifacts }
}

/**
 * 本探针启动的 exe 会把自己的运行期状态写到哪里（**路径**，不管当下存不存在）。
 *
 * 为什么**不能**靠 `--user-data-dir` 隔离：那是 Electron 自己的口径，管的是
 * Chromium/应用的 userData；后端是**独立进程**，`electron/main.js` 用
 * `spawn(exe, [], { cwd: path.dirname(exe) })` 起它，后端 `paths.py` 取
 * `_BASE = exe_dir/_internal`，于是库 / WAL / `runtime.json` 一律落在
 * **exe 旁边**，也就是 `release/win-unpacked/resources/backend/_internal/data/`。
 *
 * 这个目录在 `extraResources` 的 `filter` 里**没有被排除**（只排了
 * `*.log` / `logs` / `exports` / `__pycache__` / `*.pyc`），所以它是
 * **会被 electron-builder 打进安装包的源目录**。探针每跑一次就往里灌一个
 * 模拟数据库；而「打包 → 探针」的顺序意味着**下一次打包会带上上一次探针的垃圾**。
 *
 * 2026-10-11 实测：删掉该目录后跑一次本探针，它会带着 `scada_simulated.db` +
 * WAL + `runtime.json` 原地重建 —— 这就是本清理段的直接动因。
 *
 * **返回值不判存在性**：干净产物里这个目录本就不该存在，而探针恰恰会把它
 * 建出来。要不要清理、清到什么程度，由调用方按「跑前是否存在」决定。
 *
 * @param {string} exe
 * @returns {string} 绝对路径
 */
function runtimeDataDir(exe) {
  // 传进来的是 **Electron 主程序**路径 `<app>/SmartSCADA.exe`（不是后端 exe）。
  // 后端 exe 在 `<app>/resources/backend/scada-backend.exe`，`_internal/` 与它同级。
  // 所以从 `<app>` 出发要拼 `resources/backend/_internal/data` 四段。
  //
  // 特别写明这一点：当年 `electron/main.js` 的 runtime.json 缺陷正是
  // 「少退/多退一级」—— 注释写着「与 paths.RUNTIME_JSON_PATH 对齐」，
  // 实际漏了 `_internal`，于是整个端口发现机制从未生效。
  return path.join(path.dirname(exe), ...BACKEND_DATA_REL)
}

/** 让操作系统给一个此刻空闲的端口（避免与既有监听/TIME_WAIT 撞车）。 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 记录一棵树下的 `{files:Set, dirs:Set}`（相对路径）。
 *
 * 与冒烟闸门 `tools/verify-backend-runtime.js` 的同名函数**刻意保持同形**：
 * 两边都在做「运行前后求差 → 只删本次新建的东西」，判据形状必须一致，
 * 否则同一类缺陷会在两个闸门里以不同方式漏掉。
 *
 * @param {string} root
 * @returns {{files:Set<string>, dirs:Set<string>}}
 */
function snapshotTree(root) {
  const files = new Set()
  const dirs = new Set()
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      let rel
      try {
        rel = path.relative(root, full)
      } catch (e) {
        continue
      }
      if (ent.isDirectory()) {
        dirs.add(rel)
        walk(full)
      } else if (ent.isFile()) {
        files.add(rel)
      }
    }
  }
  walk(root)
  return { files, dirs }
}

/**
 * 删掉本次探针在产物目录里**新建**的文件与空目录，返回删不掉的路径。
 *
 * 只删「相对 `before` 新增」的东西，不按名字硬删 —— 哪天打包配置真的开始
 * 随包携带 `data/` 预置内容（预置库 / 授权文件），按名字删会把产物自己的
 * 东西一起删掉。这条纪律与冒烟闸门完全一致。
 *
 * @param {string} root
 * @param {{files:Set<string>, dirs:Set<string>}} before
 * @returns {string[]} unlink 失败的相对路径
 */
function cleanupCreated(root, before) {
  const after = snapshotTree(root)
  const failed = []
  const depthDesc = (a, b) => b.split(path.sep).length - a.split(path.sep).length

  const newFiles = [...after.files].filter((f) => !before.files.has(f)).sort(depthDesc)
  for (const rel of newFiles) {
    try {
      fs.unlinkSync(path.join(root, rel))
    } catch (e) {
      failed.push(rel)
      if (process.env.VPR_DEBUG_CLEANUP) {
        console.error(`[cleanup-debug] 删不掉 ${rel}: ${(e && e.message) || e}`)
      }
    }
  }

  const newDirs = [...after.dirs].filter((d) => !before.dirs.has(d)).sort(depthDesc)
  for (const rel of newDirs) {
    try {
      fs.rmdirSync(path.join(root, rel))
    } catch (e) {
      // 非空（里面有删不掉的文件）或仍被占用：留着
    }
  }
  return failed
}

/**
 * 相对 `before` 快照，当前**仍存在**的运行期新文件（排序后）。
 *
 * 这是「清理是否真的生效」的**唯一可信判据** —— 不能只看 `unlink` 有没有抛异常。
 * Windows 上删除一个仍被句柄占用的文件时 `DeleteFile` 会成功返回，但目录项要等
 * 最后一个句柄关闭才消失；「删了」与「还在」可以同时为真。理由与冒烟闸门同。
 *
 * @param {string} root
 * @param {{files:Set<string>, dirs:Set<string>}} before
 * @returns {string[]}
 */
function runtimeNewFiles(root, before) {
  const after = snapshotTree(root)
  return [...after.files].filter((f) => !before.files.has(f)).sort()
}

/**
 * 反复清理直到「复核确认干净」或次数用尽。
 *
 * @param {string} root
 * @param {{files:Set<string>, dirs:Set<string>}} before
 * @returns {Promise<{failed: string[], leftover: string[]}>}
 */
async function cleanupUntilClean(root, before) {
  let failed = cleanupCreated(root, before)
  let leftover = runtimeNewFiles(root, before)
  for (let i = 1; i < CLEANUP_ATTEMPTS && leftover.length; i += 1) {
    await sleep(CLEANUP_DELAY_MS)
    failed = failed.concat(cleanupCreated(root, before))
    leftover = runtimeNewFiles(root, before)
  }
  return { failed, leftover }
}

/** 轮询调试端口直到 /json 可用（或超时）。 */
async function waitForTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      if (res.ok) {
        const list = await res.json()
        const page = list.find((t) => t.type === 'page' && String(t.url).includes('index.html'))
        if (page) return page
      }
    } catch (e) { /* 端口未就绪，继续等 */ }
    await sleep(700)
  }
  return null
}

/** 通过 CDP 轮询 #app 挂载状态，直到挂上或超时。 */
function probeMount(page, timeoutMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; try { ws.close() } catch (e) {} resolve(value) } }
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      if (Date.now() > deadline) { finish({ mounted: -1, reason: 'timeout' }); return }
      try {
        ws.send(JSON.stringify({
          id: Math.floor(Math.random() * 1e9), method: 'Runtime.evaluate', params: {
            expression: '(() => { const el = document.getElementById("app"); return el ? el.children.length : -1 })()',
            returnByValue: true,
          },
        }))
      } catch (e) { finish({ mounted: -1, reason: 'send-failed ' + e.message }); return }
      setTimeout(tick, 900)
    }
    ws.onopen = () => tick()
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.result && msg.result.result && typeof msg.result.result.value === 'number') {
        if (msg.result.result.value > 0) finish({ mounted: msg.result.result.value, reason: 'ok' })
      }
    }
    ws.onerror = () => finish({ mounted: -1, reason: 'ws-error' })
  })
}

/**
 * **仪表盘导航烟测**（2026-10-10 事故③加的，必须有）：
 * 往 localStorage 塞一个**假会话**（路由守卫只看存在性与角色，不看后端），
 * 然后真的导航到 `#/dashboard` —— 这会触发仪表盘视图的**懒加载 chunk**，
 * 而事故③的崩溃（懒加载链里的第三条循环 → `__extends` 基类 undefined）
 * 恰好只在"这一步"爆发：登录页好好的，一点登录进仪表盘，导航就被静默中止，
 * 用户永远进不去系统。只测登录页的闸门对这类问题**完全瞎**。
 *
 * 判据（注意假会话的 401 不是缺陷）：
 *   - 导航期间出现 `Class extends / Uncaught / before initialization` → **FAIL**（事故③签名）；
 *   - 页面文本出现「仪表盘」**或**日志出现 `[Dashboard]`（证明路由+组件真的跑起来了）
 *     → **PASS**。⚠️ 假令牌会让仪表盘的 API 调用 401、拦截器随后按设计清会话弹回
 *     登录页 —— 那是**正确行为**、不是产品缺陷；所以必须用「150ms 快轮询」抓住
 *     仪表盘渲染过的那一瞬间，并接受随后的弹回。
 */
function probeDashboard(page, timeoutMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    const errs = []
    let sawDashboard = false
    let seq = 1
    let settled = false
    let lastHash = ''
    let lastText = ''
    const finish = (v) => { if (!settled) { settled = true; try { ws.close() } catch (e) {} resolve(v) } }
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      if (Date.now() > deadline) {
        finish({ ok: false, reason: 'timeout', hash: lastHash, text: lastText, sawDashboard })
        return
      }
      try {
        ws.send(JSON.stringify({
          id: 1000 + (seq++), method: 'Runtime.evaluate', params: {
            expression: 'JSON.stringify({hash: location.hash, text: (document.body.innerText||"").replace(/\\s+/g," ").slice(0,140)})',
            returnByValue: true,
          },
        }))
      } catch (e) { finish({ ok: false, reason: 'send-failed' }); return }
      setTimeout(tick, 150)
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
      ws.send(JSON.stringify({
        id: 2, method: 'Runtime.evaluate', params: {
          expression: `(() => {
            localStorage.setItem('auth_token', 'gate.test.token');
            localStorage.setItem('scada_user', JSON.stringify({ username: 'gate', role: 'admin' }));
            location.hash = '#/dashboard';
            return 'navigating';
          })()`,
          returnByValue: true,
        },
      }))
      tick()
    }
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const t = (msg.params.args || []).map((a) => String(a.value || a.description || '')).join(' ')
        if (/Class extends|Uncaught|before initialization/.test(t) && msg.params.type === 'error') {
          errs.push(t.slice(0, 140))
        }
        // 仪表盘组件跑起来的直接证据（其自身日志），假会话下很常见
        if (/\[Dashboard\]/.test(t)) sawDashboard = true
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const t = String((msg.params.exceptionDetails && msg.params.exceptionDetails.text) || '')
        if (/Class extends|Uncaught|before initialization/.test(t)) errs.push(t.slice(0, 140))
      }
      if (msg.result && msg.result.result && typeof msg.result.result.value === 'string' && msg.result.result.value.startsWith('{')) {
        try { const st = JSON.parse(msg.result.result.value); lastHash = st.hash; lastText = st.text } catch (e) {}
        if (errs.length > 0) { finish({ ok: false, reason: 'fatal-during-nav: ' + errs[0], hash: lastHash }); return }
        if (sawDashboard || lastText.includes('仪表盘')) {
          finish({ ok: true, hash: lastHash, text: lastText, sawDashboard })
          return
        }
      }
    }
    ws.onerror = () => finish({ ok: false, reason: 'ws-error' })
  })
}

async function main(argv) {
  const { exe, port: wantPort, waitSec, keepArtifacts } = parseArgs(argv)

  if (!fs.existsSync(exe)) {
    console.error(`[packaged-runtime] 找不到打包产物：${exe} —— 先跑 electron-builder。`)
    return 1
  }
  const port = wantPort > 0 ? wantPort : await findFreePort()
  console.log(`[packaged-runtime] 调试端口：${port}${wantPort > 0 ? '（指定）' : '（自动空闲端口）'}`)

  // 后端 exe 旁边的运行期数据目录（`resources/backend/_internal/data/`）。
  // 它会被打进安装包，所以探针跑完必须把它恢复到跑之前的样子 —— 见 runtimeDataDir()。
  const dataDir = runtimeDataDir(exe)
  const dataExistedBefore = fs.existsSync(dataDir)
  const dataBefore = dataExistedBefore ? snapshotTree(dataDir) : { files: new Set(), dirs: new Set() }
  console.log(
    `[packaged-runtime] 运行期数据目录：${dataDir}` +
    (dataExistedBefore
      ? `（跑前 ${dataBefore.files.size} 文件 / ${dataBefore.dirs.size} 目录）`
      : '（跑前不存在 —— 跑完必须原样消失）')
  )

  // 一次性 userData：绝不碰 %APPDATA% 的真实用户数据（唯一的例外是主人在用 app 时不可测）
  fs.mkdirSync(BASE_DIR, { recursive: true })
  const userDataDir = path.join(BASE_DIR, `userdata-${Date.now()}-${process.pid}`)
  fs.mkdirSync(userDataDir, { recursive: true })
  const appLog = path.join(BASE_DIR, `app-stderr-${Date.now()}.log`)
  const fd = fs.openSync(appLog, 'w')

  const childEnv = { ...process.env }
  delete childEnv.ELECTRON_RUN_AS_NODE // 本仓库工具链 shell 里默认有它 —— 不清会变无头 Node
  delete childEnv.NODE_OPTIONS

  console.log(`[packaged-runtime] 启动打包版：${exe}（一次性 userData：${userDataDir}）`)
  const child = spawn(exe, [
    '--no-sandbox', '--disable-gpu-sandbox',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
  ], { env: childEnv, stdio: ['ignore', fd, fd] })

  const killTree = () => {
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) {}
  }

  try {
    const page = await waitForTargets(port, Math.min(40000, waitSec * 1000))
    if (!page) {
      console.error(`[packaged-runtime] ${waitSec}s 内没等到调试端口/页面目标 —— fail-closed。`)
      console.error('--- 应用日志（尾 2000 字节）---\n' + readTail(appLog, 2000))
      return 1
    }
    console.log(`[packaged-runtime] 页面目标：${page.url}`)

    const result = await probeMount(page, Math.max(15000, waitSec * 1000))
    const dash = result.mounted > 0
      ? await probeDashboard(page, 25000)
      : { ok: false, reason: 'mount-failed', hash: '' }
    const logText = readTail(appLog, 200000)
    const fatalLines = logText.split('\n').filter((l) =>
      /\[Renderer\].*(Uncaught|TypeError|before initialization|Class extends|Failed to fetch dynamically)/.test(l)
    )

    const ok = result.mounted > 0 && dash.ok && fatalLines.length === 0
    if (ok) {
      console.log(`[packaged-runtime] PASS：页面挂载成功（#app 子节点=${result.mounted}），仪表盘导航烟测通过（hash=${dash.hash}），无渲染层致命错误。`)
      return 0
    }
    console.error(
      '[packaged-runtime] FAIL：打包版页面未通过运行时验收 —— 用户看到的就是**打不开/进不去**。\n' +
      `  #app 子节点 = ${result.mounted}（挂载：${result.reason}）\n` +
      `  仪表盘导航：ok=${dash.ok} reason=${dash.reason || ''} ${dash.hash ? 'hash=' + dash.hash : ''}\n` +
      (fatalLines.length ? '  渲染层致命错误：\n' + fatalLines.slice(0, 8).map((l) => '    ' + l).join('\n') + '\n' : '')
    )
    return 1
  } finally {
    killTree()
    // 等端口关闭后清，理由同冒烟闸门：根进程退出 ≠ 子进程释放了句柄。
    // 注意顺序：`killTree()` 用的是 `/T`（整棵树），但释放仍是异步的，
    // 所以清理靠「删 → 复核 → 退避 → 再删」而不是一次删干净。
    if (!keepArtifacts) {
      // 跑前不存在 → 跑完必须整个目录都消失（连空壳都不留）。
      // 只靠 cleanupUntilClean 是不够的：它的 `before` 是空快照，会把
      // `data/` 本身当成「本次新建的目录」删掉 —— 这一点**依赖** `snapshotTree`
      // 把根目录下的第一层子目录也收进 `dirs`。为空快照时它确实会删。
      // 但若目录被删后又因退避重试之外的时序问题重新出现，这里再兜一次底。
      const { leftover } = await cleanupUntilClean(dataDir, dataBefore)
      if (!dataExistedBefore) {
        try { fs.rmdirSync(dataDir) } catch (e) { /* 非空/占用 → 交给下面的 leftover 判据 */ }
      }
      const residue = leftover.length ? leftover : (fs.existsSync(dataDir) && !dataExistedBefore ? ['(整个目录)'] : [])
      if (residue.length) {
        console.error(
          '[packaged-runtime] 产物目录清理不干净（这是**发布缺陷**，不是环境噪声）：\n' +
          residue.slice(0, 20).map((p) => '    ' + p).join('\n') +
          '\n  这些文件位于 `resources/backend/_internal/data/`，而该目录会被 electron-builder\n' +
          '  打进安装包 —— 留着就会**装到用户机器上**。'
        )
        // fail-closed：清理不干净等于这次探针把产物弄脏了，不允许静默放过。
        process.exitCode = 1
      } else {
        console.log('[packaged-runtime] 产物目录已恢复到跑之前的状态（无残留）。')
      }
    } else {
      console.log('[packaged-runtime] --keep-artifacts：保留本次运行期数据，未清理。')
    }
  }
}

function readTail(file, bytes) {
  try {
    const size = fs.statSync(file).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    const f = fs.openSync(file, 'r')
    fs.readSync(f, buf, 0, buf.length, start)
    fs.closeSync(f)
    return buf.toString('utf8')
  } catch (e) {
    return '(读取日志失败: ' + e.message + ')'
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error('[packaged-runtime] 工具自身异常（fail-closed）：', e && e.message)
    process.exit(1)
  })
}

module.exports = { parseArgs, runtimeDataDir, snapshotTree, cleanupCreated, runtimeNewFiles, cleanupUntilClean }
