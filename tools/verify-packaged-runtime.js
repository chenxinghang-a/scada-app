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
 *   5. 无论成败，结束后杀掉整棵进程树。
 *
 * 用法
 * ----
 *   node tools/verify-packaged-runtime.js [--exe <路径>] [--port <n>] [--wait <秒>]
 * 退出码：0 = 通过；1 = 不通过。
 */

'use strict'

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const net = require('net')

const REPO = process.cwd()
const DEFAULT_EXE = path.join(REPO, 'release', 'win-unpacked', 'SmartSCADA.exe')
const BASE_DIR = path.join(REPO, '.vitest_cache', 'packaged-runtime')

function parseArgs(argv) {
  let exe = DEFAULT_EXE
  let port = 0 // 0 = 自动选一个空闲端口（CI/本机都可能撞端口，实测踩过）
  let waitSec = 30
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exe' && argv[i + 1]) { exe = path.resolve(argv[i + 1]); i += 1 }
    else if (argv[i] === '--port' && argv[i + 1]) { port = Number(argv[i + 1]); i += 1 }
    else if (argv[i] === '--wait' && argv[i + 1]) { waitSec = Number(argv[i + 1]); i += 1 }
  }
  return { exe, port, waitSec }
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
  const { exe, port: wantPort, waitSec } = parseArgs(argv)

  if (!fs.existsSync(exe)) {
    console.error(`[packaged-runtime] 找不到打包产物：${exe} —— 先跑 electron-builder。`)
    return 1
  }
  const port = wantPort > 0 ? wantPort : await findFreePort()
  console.log(`[packaged-runtime] 调试端口：${port}${wantPort > 0 ? '（指定）' : '（自动空闲端口）'}`)

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

  const cleanup = () => {
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
    cleanup()
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

module.exports = { parseArgs }
