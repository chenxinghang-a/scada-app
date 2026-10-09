#!/usr/bin/env node
/**
 * 打包产物**运行时**闸门：`dist/` 必须在真实 Chromium（Electron）里**真的把页面挂载出来**。
 *
 * 为什么需要它（2026-10-09 实测缺陷）
 * ----------------------------------
 * 已有的闸门全部只看**静态**：`verify-dist`（index.html 引用的资源在不在）、
 * `verify-asar`（asar 里资源在不在）、单元测试（jsdom 里跑组件）。
 * 它们全绿的同时，**页面可以是白的** —— 实测到的原话：
 *
 *     [Renderer] Uncaught ReferenceError: Cannot access '$' before initialization
 *                （vendor-vue-*.js —— chunk 初始化顺序 / 循环依赖）
 *
 * → Vue 应用在初始化期抛异常 → `#app` 永远挂不上 → 用户看到**白屏**。
 * 这类缺陷「所有静态闸门 + 所有单测」都拦不住，**只有真的把页面跑起来才知道**。
 *
 * 判据（fail-closed）
 * ------------------
 *   1. `dist/index.html` 必须存在（否则 exit 1）；
 *   2. 加载完成后 `#app` 必须挂载出子节点（> 0）—— Vue mount 成功的硬证据；
 *   3. 期间不得出现「未捕获异常 / 渲染进程崩溃 / 加载失败」三类信号；
 *   4. 任何一步测不出来（超时、连不上、脚本错）一律 exit 1，没有静默放行分支。
 *
 * 用法
 * ----
 *   node tools/verify-dist-runtime.js [--dist <dir>] [--wait <秒>]
 * 退出码：0 = 通过；1 = 不通过。
 *
 * ⚠️ 这个工具会**真的启动一个 Electron 进程**（无窗口模式）来跑页面。
 * 用到的运行时：仓库自己的 devDependency `electron`（与打包用的是同一份 Chromium）。
 */

'use strict'

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const REPO = process.cwd()
// 检查脚本写到 .vitest_cache/（已 gitignore；环境对删除有批量保护，本工具不做删除）
const SCRIPTS_DIR = path.join(REPO, '.vitest_cache', 'dist-runtime')
const CHECK_SCRIPT = path.join(SCRIPTS_DIR, 'check-main.js')

function parseArgs(argv) {
  let dist = path.join(REPO, 'dist')
  let waitSec = 12
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dist' && argv[i + 1]) { dist = path.resolve(argv[i + 1]); i += 1 }
    else if (argv[i] === '--wait' && argv[i + 1]) { waitSec = Number(argv[i + 1]); i += 1 }
  }
  return { dist, waitSec }
}

/** Electron 侧的检查脚本（作为子进程的 main 跑）。 */
const ELECTRON_CHECK = `
'use strict'
const { app, BrowserWindow } = require('electron')
const path = require('path')

const DIST = process.env.VDR_DIST
const WAIT_MS = Number(process.env.VDR_WAIT_MS || 12000)
const signals = []

for (const sw of ['disable-gpu', 'disable-gpu-sandbox', 'no-sandbox']) {
  app.commandLine.appendSwitch(sw)
}
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  const wc = win.webContents

  wc.on('console-message', (_e, level, msg, line, sourceId) => {
    if (level >= 2) signals.push('console[' + level + '] ' + msg + ' (' + sourceId + ':' + line + ')')
  })
  wc.on('render-process-gone', (_e, d) => { signals.push('renderer-gone ' + d.reason + ' ' + d.exitCode) })
  wc.on('did-fail-load', (_e, code, desc, url) => { signals.push('did-fail-load ' + code + ' ' + desc + ' ' + url) })

  try {
    await win.loadFile(path.join(DIST, 'index.html'))
  } catch (e) {
    console.log('VDR_RESULT ' + JSON.stringify({ mounted: -2, title: '', fatal: String(e && e.message) }))
    app.exit(1)
    return
  }

  await new Promise(r => setTimeout(r, WAIT_MS))

  let mounted = -1
  let title = ''
  try {
    mounted = await wc.executeJavaScript(
      '(() => { const el = document.getElementById("app"); return el ? el.children.length : -1 })()'
    )
    title = await wc.executeJavaScript('document.title')
  } catch (e) {
    signals.push('eval-failed ' + String(e && e.message))
  }

  console.log('VDR_RESULT ' + JSON.stringify({ mounted, title }))
  for (const s of signals.slice(0, 20)) console.log('VDR_SIGNAL ' + s)

  const bad = signals.some(s => /Uncaught|before initialization|renderer-gone|did-fail-load|eval-failed/.test(s))
  const ok = mounted > 0 && !bad
  app.exit(ok ? 0 : 1)
})
`

function main(argv) {
  const { dist, waitSec } = parseArgs(argv)
  const indexPath = path.join(dist, 'index.html')
  if (!fs.existsSync(indexPath)) {
    console.error(`[dist-runtime] 找不到 ${indexPath} —— 先跑 \`npm run build\`。`)
    return 1
  }

  let electronPath
  try {
    electronPath = require('electron') // 在 node 里 require 得到 exe 路径
  } catch (e) {
    console.error('[dist-runtime] 拿不到 electron 路径（devDependency 缺失？）：', e && e.message)
    return 1
  }
  if (typeof electronPath !== 'string' || !fs.existsSync(electronPath)) {
    console.error('[dist-runtime] electron 路径无效：', electronPath)
    return 1
  }

  fs.mkdirSync(SCRIPTS_DIR, { recursive: true })
  fs.writeFileSync(CHECK_SCRIPT, ELECTRON_CHECK, 'utf-8')

  console.log(`[dist-runtime] 用 Electron 真跑 ${indexPath}（等待 ${waitSec}s）…`)
  // 兼容开关走**命令行**（进程启动即生效）——受限环境里在 JS 里 appendSwitch
  // 可能来不及（GPU 进程初始化早于脚本），实测过「什么都不打印就死」的形态。
  //
  // 输出走**文件重定向**而不是管道：实测（2026-10-09）Windows 上 Electron 的
  // console 输出经管道会丢（stdout=0B），写文件则稳定可见。
  //
  // 子进程环境必须清掉两个会「把 Electron 变成无头 Node」的变量：
  // `ELECTRON_RUN_AS_NODE`（本仓库工具链的 shell 里默认就有！）与 `NODE_OPTIONS`
  // （可能注入 --require shim）。不清的话这个工具自己会被静默毒死。
  const childEnv = { ...process.env, VDR_DIST: dist, VDR_WAIT_MS: String(waitSec * 1000) }
  delete childEnv.ELECTRON_RUN_AS_NODE
  delete childEnv.NODE_OPTIONS

  const runLog = path.join(SCRIPTS_DIR, 'run.log')
  const fd = fs.openSync(runLog, 'w')
  const r = spawnSync(electronPath, [
    '--no-sandbox', '--disable-gpu-sandbox', '--disable-gpu',
    CHECK_SCRIPT,
  ], {
    stdio: ['ignore', fd, fd],
    timeout: (waitSec + 60) * 1000,
    env: childEnv,
  })
  fs.closeSync(fd)

  const out = fs.readFileSync(runLog, 'utf8')
  for (const line of out.split('\n')) if (line.startsWith('VDR_')) console.log(line)

  const m = out.match(/VDR_RESULT (\{.*\})/)
  if (!m) {
    console.error(
      `[dist-runtime] 没拿到结果行（Electron 可能没起来 / 被超时杀掉）—— fail-closed。\n` +
      `  exitCode=${r.status} signal=${r.signal} spawnError=${r.error ? r.error.message : 'none'} 输出=${out.length}B`
    )
    if (out.trim()) console.error('--- 原始输出 ---\n' + out.slice(0, 4000))
    return 1
  }
  let result
  try { result = JSON.parse(m[1]) } catch (e) { console.error('[dist-runtime] 结果行解析失败：', m[1]); return 1 }

  const badSignal = out.split('\n').some(l => l.startsWith('VDR_SIGNAL') && /Uncaught|before initialization|renderer-gone|did-fail-load|eval-failed/.test(l))
  const ok = result.mounted > 0 && !badSignal
  if (ok) {
    console.log(`[dist-runtime] PASS：页面挂载成功（#app 子节点=${result.mounted}，title=${JSON.stringify(result.title)}）`)
    return 0
  }
  console.error(
    '[dist-runtime] FAIL：页面没有在真实 Chromium 里挂载出来 —— 用户看到的就是**白屏**。\n' +
    `  #app 子节点 = ${result.mounted}（>0 才算挂载成功）\n` +
    '  上面 VDR_SIGNAL 行是浏览器侧收集到的异常/崩溃信号（第一嫌疑：初始化期未捕获异常）。'
  )
  return 1
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)))
}

module.exports = { parseArgs }
