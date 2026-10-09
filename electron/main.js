const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, session } = require('electron')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const net = require('net')
const fs = require('fs')
// updater 可选 —— 但**加载失败必须出声**。
// 原先写的是 `catch {}`：updater.js 一旦加载失败，setupUpdater/checkForUpdates
// 会静默保持 null，自动更新就悄悄没了、且没有任何痕迹 ——
// 正是本项目 round 161 花力气消除的那类「静默失效」。
let setupUpdater = null, checkForUpdates = null
try {
  const u = require('./updater')
  setupUpdater = u.setupUpdater
  checkForUpdates = u.checkForUpdates
} catch (e) {
  console.error('[updater] 模块加载失败，自动更新将不可用：', e && e.message)
}
const { isFirstRun, markComplete } = require('./first-run')
// 后端 exe / 运行时端口文件的定位口径（可单测，且被 CI 闸门共用）。
const backendPaths = require('./backend-paths')
// GPU / 沙箱降级阶梯的**纯决策层**（级别怎么升、粘性成功级别怎么算；可单测）。
const gpuPolicy = require('./gpu-policy')

// ============ 常量 ============
// 端口默认回退到 5000（向后兼容 / 模拟模式）。真实模式下后端监听 5001，
// 实际端口以运行时文件 runtime.json 为准（见 syncBackendPort / resolveBackendPort）。
let BACKEND_PORT = 5000
const BACKEND_HOST = '127.0.0.1'
const HEALTH_ENDPOINT = '/api/health/status'
const isDev = !app.isPackaged
const MAX_BACKEND_RESTARTS = 5

// ============ GPU / 沙箱兜底（round 197c） ============
// 症状：GPU 进程起不来时 Electron 会**直接 FATAL 退出** ——
//     FATAL:gpu_data_manager_impl_private.cc(423)] GPU process isn't usable. Goodbye.
// 表现：双击图标**完全没反应**（进程秒退、无窗口、无提示、无日志）。
//
// 实测（2026-10-09）：
//   * 连崩 9 次 GPU 进程后放弃；
//   * 命令行 `--disable-gpu` **压不住**；
//   * `app.disableHardwareAcceleration()` **也不够**（仍崩）；
//   * ✅ 有效的是 **`--disable-gpu-sandbox`** —— 只关 **GPU 进程的沙箱**
//     （`--no-sandbox` / `--in-process-gpu` 同样有效，但前者把整个 Chromium 沙箱
//      都关了，范围过大，所以选最窄的这个）。
//   根因是 **GPU 进程的沙箱在该环境里起不来**（受限会话 / 安全策略拦子进程）。
//
// 策略：**自愈式降级阶梯**（0 → 1 → 2 级，逐级升级）
//   L0 默认；
//   L1 = `--disable-gpu-sandbox` + 软渲染；
//   L2 = L1 + `--no-sandbox`（实测：受限环境里连**渲染进程**的沙箱也起不来，
//        只到 L1 的话 GPU 不崩了、窗口却是死的 —— 白窗，仍然「打不开」）。
//
//   1. 每次启动在 userData 写一个 `launch-attempt.json` 标记（含本次级别）；
//   2. 启动**成功**后把它删掉。⚠️ 成功的判据 = 窗口建好 + 稳定运行 + **渲染进程
//      没有死在启动阶段**（「窗口建出来」不等于能用）；
//   3. 下次启动若发现标记**还在**（且是 24 小时内的）→ 说明上一次**没走完正常流程**
//      → 在它用的级别上**加一级**重试；
//   4. 某级别成功过一次 → 记进 `gpu-state.json`（粘性）→ 之后的启动**直接从该级起**，
//      不再重复「先崩一轮」。
//   → 用户**不需要知道任何开关**：崩过的机器，最多经历「崩→白窗→成功」一轮，
//     之后每次双击都能直接打开。
//
// 手动覆盖：环境变量 `SCADA_DISABLE_GPU=1` 或 userData 下的 `disable-gpu.flag`（≥L1）。
// 想回到默认（L0）重新验证：删掉 userData 下的 `gpu-state.json` 与 `launch-attempt.json`。
//
// ⚠️ 必须在 `app.whenReady()` **之前**调用才生效，所以放在模块顶层。
// 默认（无标记、无开关）行为**完全不变**。
const LAUNCH_MARKER = (() => {
  try { return path.join(app.getPath('userData'), 'launch-attempt.json') }
  catch (e) { return null }
})()

//: 判定「上次没干净退出」的**最长回溯窗口**。
//: 取 24 小时而不是几十秒 —— 用户两次双击之间可能隔很久，
//: 窗口太窄会让自愈**在最需要它的时候失效**（实测过 60 秒版本的这个缺口）。
//: 正常退出会清掉标记（见 markLaunchSucceeded 与 before-quit），
//: 所以「标记还在」确实意味着上次没走完正常流程。
//
// ⚠️ 必须声明在**使用它之前** —— 第一版把它放在下面，`const` 的暂时性死区
// 会让启动直接抛 ReferenceError（比 GPU 崩溃还早，整个应用起不来）。
const LAUNCH_MARKER_STALE_MS = 24 * 60 * 60 * 1000

let prevLaunchCrashed = false
let prevLaunchLevel = 0
try {
  if (LAUNCH_MARKER && fs.existsSync(LAUNCH_MARKER)) {
    const prev = JSON.parse(fs.readFileSync(LAUNCH_MARKER, 'utf-8'))
    if (prev && typeof prev.at === 'number' && Date.now() - prev.at < LAUNCH_MARKER_STALE_MS) {
      prevLaunchCrashed = true
      // 旧版标记没有 level 字段 → normalizeLevel 返回 0（等价于「从 L0 崩的」），
      // 升级到 L1 —— 与旧版的两级自愈行为逐位兼容。
      prevLaunchLevel = gpuPolicy.normalizeLevel(prev.level)
    }
  }
} catch (e) {
  console.error('[gpu] 读取上次启动标记失败（忽略）：', e && e.message)
}

// 「上次成功用过的兜底级别」（粘性）。见 gpu-policy.js 顶部说明：
// 受限环境里若每次冷启动都从 L0 试起，用户会经历「崩→白窗→成功」的循环，
// 体感还是「打不开」。成功过一次 L≥1 → 之后的启动直接从这里起。
let stickyGoodLevel = 0
try {
  const statePath = LAUNCH_MARKER ? path.join(path.dirname(LAUNCH_MARKER), 'gpu-state.json') : null
  if (statePath && fs.existsSync(statePath)) {
    const st = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    stickyGoodLevel = gpuPolicy.normalizeLevel(st && st.goodLevel)
  }
} catch (e) {
  console.error('[gpu] 读取历史成功级别失败（忽略）：', e && e.message)
}

const forcedFallback = (() => {
  try {
    if (process.env.SCADA_DISABLE_GPU === '1') return 'env'
    if (LAUNCH_MARKER) {
      const flag = path.join(path.dirname(LAUNCH_MARKER), 'disable-gpu.flag')
      if (fs.existsSync(flag)) return 'flag'
    }
  } catch (e) { /* 拿不到就当作没有开关 */ }
  return null
})()

const gpuDecision = gpuPolicy.decideLevel({
  prevCrashed: prevLaunchCrashed,
  prevLevel: prevLaunchLevel,
  goodLevel: stickyGoodLevel,
  manualLevel: forcedFallback ? 1 : 0,
  manualReason: forcedFallback,
})
const gpuFallbackReason = gpuDecision.reason
const gpuFallbackLevel = gpuDecision.level

try {
  if (gpuFallbackReason) {
    app.commandLine.appendSwitch('disable-gpu-sandbox')
    app.disableHardwareAcceleration()
    // L2 及以上：连渲染进程的沙箱也关掉。实测：受限环境里**渲染进程的沙箱**
    // 同样起不来 —— 只关 GPU 沙箱的话，GPU 不崩了、页面却是死的（白窗），
    // 正是「还是打不开」的形态。
    if (gpuFallbackLevel >= 2) app.commandLine.appendSwitch('no-sandbox')
    console.log(`[gpu] 已启用兜底（原因=${gpuFallbackReason}, 级别=L${gpuFallbackLevel}）：disable-gpu-sandbox + 软渲染${gpuFallbackLevel >= 2 ? ' + no-sandbox' : ''}`)
  }
  if (LAUNCH_MARKER) {
    fs.writeFileSync(LAUNCH_MARKER, JSON.stringify({
      at: Date.now(), pid: process.pid, fallback: gpuFallbackReason || null, level: gpuFallbackLevel,
    }))
  }
} catch (e) {
  // 拿不到 userData 就跳过 —— 不能因为这个兜底本身把启动搞挂
  console.error('[gpu] 兜底判定失败（忽略，按默认启用硬件加速）：', e && e.message)
}

/** 启动成功 → 清掉尝试标记；并把本次生效的兜底级别记成「粘性成功级」。 */
function markLaunchSucceeded() {
  try {
    if (LAUNCH_MARKER && fs.existsSync(LAUNCH_MARKER)) fs.unlinkSync(LAUNCH_MARKER)
  } catch (e) {
    console.error('[gpu] 清理启动标记失败（忽略）：', e && e.message)
  }
  // 粘性地记住「哪一级能成功」：L0 也记（统一口径）；之后启动 `decideLevel` 直接用。
  // 想重新从 L0 验证：删掉 userData 下的 gpu-state.json 即可（见文件顶部说明）。
  try {
    if (LAUNCH_MARKER) {
      const statePath = path.join(path.dirname(LAUNCH_MARKER), 'gpu-state.json')
      fs.writeFileSync(statePath, JSON.stringify({
        goodLevel: gpuFallbackLevel, at: Date.now(), version: app.getVersion(),
      }))
    }
  } catch (e) {
    console.error('[gpu] 记录成功级别失败（忽略）：', e && e.message)
  }
}

//: 判定「这次启动算成功」所需的**稳定运行时长**。
//: 为什么不立刻清标记：**GPU 进程可能在窗口建好之后才崩**。
//: 实测（dev 模式）：窗口都出来了、后端都 spawn 了，1 秒后 GPU 连崩 9 次 FATAL ——
//: 若一建好窗口就清标记，这次崩溃就**不会被记为失败**，自愈永远不触发。
const LAUNCH_STABLE_MS = 15000

// ============ 启动诊断日志（round 206） ============
// 为什么需要它：本文件顶部的症状说明里写着「双击图标完全没反应（进程秒退、
// 无窗口、无提示、**无日志**）」—— 而 round 197c 只修了「打不开」，
// **没有修「打不开时什么证据都不留」**。于是：
//   * 用户看到的是「双击没反应」；
//   * 排查的人（用户/我）手上**一个字节的证据都没有**，
//     只能靠反复试 —— 这正是本项目最忌讳的「静默失效」。
// 注意 `update.log` 帮不上忙：它每行都是「自动更新未启用」，
// 只能证明进程起过，**证明不了窗口有没有建出来**。
//
// 落点：`<userData>/startup.log`（Windows: %APPDATA%\SmartSCADA\startup.log）
// 格式：每行一条 JSON，**只追加**，超过 256 KB 截断重开（不无限长）。
// 纪律：**这个函数自己绝不许抛** —— 诊断日志把启动搞挂是最糟的结果。
const STARTUP_LOG = (() => {
  try { return path.join(app.getPath('userData'), 'startup.log') } catch (e) { return null }
})()
const STARTUP_LOG_MAX_BYTES = 256 * 1024

function writeStartupLog(phase, extra) {
  try {
    if (!STARTUP_LOG) return
    try {
      if (fs.statSync(STARTUP_LOG).size > STARTUP_LOG_MAX_BYTES) fs.unlinkSync(STARTUP_LOG)
    } catch (e) { /* 不存在就无所谓 */ }
    const line = JSON.stringify(Object.assign({
      at: new Date().toISOString(),
      phase,
      version: app.getVersion(),
      pid: process.pid,
      packaged: app.isPackaged,
      gpuFallback: gpuFallbackReason || null,
      gpuFallbackLevel: gpuFallbackLevel,
    }, extra || {}))
    fs.appendFileSync(STARTUP_LOG, line + '\n')
  } catch (e) {
    // 只往 stderr 说一句，绝不向上抛
    console.error('[startup] 写诊断日志失败（忽略）：', e && e.message)
  }
}

//: 建窗口失败时的**可见**兜底：弹窗 + 告诉用户日志在哪 + 两种手动覆盖。
//: 此前这条路径是**纯静默**的 —— 用户只看到「双击没反应」。
function showWindowFailureDialog(err) {
  const msg = String((err && err.message) || err || '未知错误')
  const dir = STARTUP_LOG ? path.dirname(STARTUP_LOG) : '(拿不到 userData)'
  try {
    dialog.showErrorBox(
      'SmartSCADA 启动失败：无法创建窗口',
      `窗口创建失败，应用无法继续启动。\n\n` +
      `原因：${msg}\n\n` +
      `诊断日志（每次启动都会追加一行）：\n${STARTUP_LOG || '(不可用)'}\n\n` +
      `可以试这两种**强制兜底**方式（任选一种，都不需要改配置）：\n` +
      `  1) 先设环境变量 SCADA_DISABLE_GPU=1，再启动\n` +
      `  2) 在下面这个目录里新建一个空文件 disable-gpu.flag\n     ${dir}`
    )
  } catch (e) {
    console.error('[startup] 弹窗失败（忽略）：', e && e.message)
  }
}

// 每次启动先记一条 —— 这条在 GPU 初始化之前，所以**即使 GPU 直接 FATAL 也有痕迹**。
writeStartupLog('boot')

// 后端运行时端口文件（后端启动后写入 {port,host,pid,mode,started_at}）的定位
// **不在这里拼路径** —— 见 electron/backend-paths.js。
//
// 2026-09-24 修正：此处原先把路径写死成 <backend_dir>/data/runtime.json，注释还写着
// 「与后端 paths.RUNTIME_JSON_PATH 对齐」。那是错的：实际发布的 onedir 布局下，
// 后端 paths.py 的 frozen 分支取 _BASE = exe_dir/_internal，
// 于是文件落在 <backend_dir>/_internal/data/runtime.json。
// 结果 readRuntimePort() 恒返回 null，整个「避免 5000/5001 错配」的机制
// **从未生效过** —— 只是回退值 5000 恰好等于模拟模式端口（run.py:446），
// 而这里又恒 spawn(exe, []) 不传参数，才一直没暴露。
// 现在统一走 backend-paths.js：**两个候选布局都探测**，谁先存在用谁。

// ============ 状态 ============
let mainWindow = null
let tray = null
let backendProcess = null
let backendPID = null       // 记录 PID，用于 Windows 强杀
let backendRestartCount = 0
let backendOwnedByUs = false
let backendHealthy = false
let healthCheckTimer = null
let trayMenuTimer = null
let isQuitting = false      // 用变量代替 app.isQuitting（更可靠）
let rendererGone = false     // 当前窗口的渲染进程已崩（崩后不再向它发消息/通知）
let rendererGoneEarly = false // 渲染进程崩在「启动稳定窗口」内 —— 决定本次启动算不算成功
let launchStable = false     // 是否已熬过 LAUNCH_STABLE_MS（稳定窗口）

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) { app.quit() }

// ============ 工具 ============
function getBackendPath() {
  return backendPaths.getBackendPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appDir: __dirname,
  })
}

function getSystemInfo() {
  const os = require('os')
  return {
    platform: os.platform(), arch: os.arch(), release: os.release(),
    totalMemory: Math.round(os.totalmem() / 1073741824 * 10) / 10,
    freeMemory: Math.round(os.freemem() / 1073741824 * 10) / 10,
    cpus: os.cpus().length, hostname: os.hostname(),
  }
}

function sendToRenderer(channel, data) {
  // 渲染进程崩过之后，帧会处于 disposed 状态 —— 此时 webContents.send 会在
  // Electron 内部打出 "Error sending from webFrameMain: ... Render frame was disposed"。
  // 实测（2026-10-09）：这类噪音一次崩溃就能刷出 50KB，**把真正的时间线埋掉**。
  // 已知死帧就别再发；其余异常也只记不抛 —— 这只是状态通知，绝不能升级成主进程异常。
  if (!mainWindow || mainWindow.isDestroyed() || rendererGone) return
  try {
    mainWindow.webContents.send(channel, data)
  } catch (e) {
    console.error('[Renderer] 发送消息失败（已忽略）：', e && e.message)
  }
}

// 把当前解析出的后端端口注入渲染进程（仅 main.js 侧，无需改动 preload/src）。
// 前端约定：从 window.__BACKEND_PORT__ 读取实际端口用于 axios baseURL / WebSocket，
// 回退值 5000 与历史行为一致。main.js 在端口确定或变更时调用本函数（带去重）。
let _lastPushedPort = null
function pushBackendPortToRenderer() {
  // 窗口还没建（--hidden 自启动）/已销毁时不能置去重标记：否则窗口稍后创建时
  // 会因为端口"已推送过"而永远拿不到 __BACKEND_PORT__，前端一直用回退的 5000。
  if (!mainWindow || mainWindow.isDestroyed()) return
  const p = Number(BACKEND_PORT) || 5000
  if (p === _lastPushedPort) return
  _lastPushedPort = p
  mainWindow.webContents.executeJavaScript(`window.__BACKEND_PORT__ = ${p};`).catch(() => {})
}

// ============ 端口 & 健康检查 ============
function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: BACKEND_HOST })
    s.setTimeout(1500)
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('timeout', () => { s.destroy(); resolve(false) })
    s.on('error', () => { s.destroy(); resolve(false) })
  })
}

// 读取后端写入的 runtime.json，拿回本次启动的真实端口。
// 读不到（后端尚未写入 / 布局不符 / 文件被删）时返回 null，调用方回退到 BACKEND_PORT 或探测。
//
// 候选路径与「两种布局都探测」的口径集中在 electron/backend-paths.js，
// 且与 CI 闸门 tools/verify-backend-runtime.js 共用同一份实现 —— 不允许各写一份。
// 每次调用都重新解析路径：后端可能刚写完文件，且打包/开发布局不同。
function readRuntimePort() {
  return backendPaths.readRuntimePort(getBackendPath())
}

// 把 runtime.json 中的端口同步到模块级 BACKEND_PORT（仅在确有值时更新），
// 返回当前生效端口。供健康检查、托盘菜单、IPC 统一取用。
function syncBackendPort() {
  const p = readRuntimePort()
  if (p) { BACKEND_PORT = p; pushBackendPortToRenderer() }
  return BACKEND_PORT
}

function checkBackendHealth(port) {
  const targetPort = Number.isInteger(port) ? port : syncBackendPort()
  return new Promise((resolve) => {
    const req = http.get(`http://${BACKEND_HOST}:${targetPort}${HEALTH_ENDPOINT}`, { timeout: 2000 }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 400))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

// 启动时确定后端端口：
//   1) 优先读 runtime.json（后端已写好真实端口）；
//   2) 读不到则探测 5000 / 5001 哪个能通健康检查；
//   3) 都没有则回退 5000（向后兼容）。
async function resolveBackendPort() {
  const rp = readRuntimePort()
  if (rp) { BACKEND_PORT = rp; console.log(`runtime.json 指定端口: ${rp}`); pushBackendPortToRenderer(); return rp }
  for (const cand of [5000, 5001]) {
    if (await isPortOpen(cand) && await checkBackendHealth(cand)) {
      BACKEND_PORT = cand
      console.log(`探测到后端端口: ${cand}`)
      pushBackendPortToRenderer()
      return cand
    }
  }
  console.warn('未从 runtime.json / 探测获得后端端口，回退 5000')
  BACKEND_PORT = 5000
  pushBackendPortToRenderer()
  return 5000
}

function waitForBackendNonBlocking() {
  const startTime = Date.now()
  const TIMEOUT = 60000
  const check = async () => {
    if (Date.now() - startTime > TIMEOUT) {
      console.warn('后端健康检查超时(60s)')
      sendToRenderer('backend-status-changed', { healthy: false, timeout: true, port: BACKEND_PORT })
      return
    }
    // 每轮重新读取 runtime.json（后端启动后才会写入/覆盖），以拿到真实端口
    const port = syncBackendPort()
    if (await checkBackendHealth(port)) {
      backendHealthy = true; backendRestartCount = 0
      scheduleTrayUpdate(); sendToRenderer('backend-status-changed', { healthy: true, port: BACKEND_PORT })
      console.log(`后端健康检查通过 (port=${port})`)
    } else {
      setTimeout(check, 1500)
    }
  }
  check()
}

function startHealthMonitor() {
  if (healthCheckTimer) return
  healthCheckTimer = setInterval(async () => {
    if (isQuitting) return // 关闭中不检查，防止重启
    const was = backendHealthy
    backendHealthy = await checkBackendHealth()
    if (was !== backendHealthy) {
      console.log(`后端状态: ${backendHealthy ? '在线' : '离线'}`)
      scheduleTrayUpdate()
      sendToRenderer('backend-status-changed', { healthy: backendHealthy, port: BACKEND_PORT })
    }
    if (!backendHealthy && backendOwnedByUs && !backendProcess && !isQuitting) attemptRestart()
  }, 10000)
}

function stopHealthMonitor() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null }
}

// ============ 托盘 ============
function scheduleTrayUpdate() {
  if (trayMenuTimer) return
  trayMenuTimer = setTimeout(() => { trayMenuTimer = null; rebuildTrayMenu() }, 500)
}

function rebuildTrayMenu() {
  if (!tray) return
  let statusLabel
  if (backendHealthy) statusLabel = '● 后端在线'
  else if (backendOwnedByUs && backendProcess) statusLabel = '◐ 启动中...'
  else if (backendOwnedByUs) statusLabel = '○ 后端已停止'
  else statusLabel = '○ 后端离线'

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } } },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    { label: `端口 ${BACKEND_PORT}`, enabled: false },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: getAutoLaunchEnabled(), click: m => setAutoLaunch(m.checked) },
    { type: 'separator' },
    { label: '重启后端', enabled: backendOwnedByUs, click: () => restartBackendManual() },
    { type: 'separator' },
    { label: '退出 SmartSCADA', click: () => quitApp() },
  ]))
  tray.setToolTip(`SmartSCADA — ${backendHealthy ? '在线' : '离线'} :${BACKEND_PORT}`)
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', 'tray-icon.ico')
  let icon
  try { icon = nativeImage.createFromPath(iconPath); if (icon.isEmpty()) throw new Error('empty') } catch (e) { console.warn('托盘图标加载失败:', iconPath, e.message); icon = nativeImage.createEmpty() }
  tray = new Tray(icon)
  rebuildTrayMenu()
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
}

// ============ 后端进程管理 ============

/** Windows 强杀进程树 — 用 spawnSync 避免 shell 注入 */
function killProcessTree(pid) {
  if (!pid) return
  try {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    console.log(`taskkill /PID ${pid} /T /F exitCode=${result.status}`)
  } catch (e) {
    console.log(`taskkill /PID ${pid} 失败 (可能已退出): ${e.message}`)
  }
}

async function startBackend() {
  // 先用 runtime.json（或探测）确定真实端口，避免 5000/5001 错配
  syncBackendPort()
  if (await isPortOpen(BACKEND_PORT)) {
    if (await checkBackendHealth()) {
      console.log('端口已有健康后端，跳过启动')
      backendOwnedByUs = false; backendHealthy = true; scheduleTrayUpdate()
      return true
    }
    console.warn(`端口 ${BACKEND_PORT} 被占用但健康检查失败`)
    sendToRenderer('backend-status-changed', { healthy: false, portConflict: true })
    return false
  }

  const exe = getBackendPath()
  if (!fs.existsSync(exe)) {
    console.error('后端文件缺失:', exe)
    sendToRenderer('backend-status-changed', { healthy: false, missing: true })
    return false
  }

  try {
    backendProcess = spawn(exe, [], { cwd: path.dirname(exe), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    backendPID = backendProcess.pid
    backendOwnedByUs = true
    console.log(`后端已 spawn PID=${backendPID}`)

    backendProcess.stdout.on('data', d => {
      const msg = d.toString().trim()
      if (msg) { console.log(`[BE] ${msg}`); sendToRenderer('backend-log', msg) }
    })
    backendProcess.stderr.on('data', d => {
      const msg = d.toString().trim()
      if (msg) { console.error(`[BE] ${msg}`); sendToRenderer('backend-log', `[ERR] ${msg}`) }
    })
    backendProcess.on('error', err => {
      console.error('spawn失败:', err)
      backendProcess = null; backendPID = null; backendHealthy = false; scheduleTrayUpdate()
    })
    backendProcess.on('exit', (code, sig) => {
      console.log(`后端退出 code=${code} sig=${sig}`)
      backendProcess = null; backendPID = null; backendHealthy = false; scheduleTrayUpdate()
      if (isQuitting) return
      if (code === 0) return
      attemptRestart()
    })

    return true
  } catch (err) {
    console.error('spawn异常:', err)
    return false
  }
}

let restartTimer = null
let restartPending = false // 防重入：exit 回调与健康巡检可能同时触发重启，重复 spawn 会起两个后端

async function attemptRestart() {
  if (restartPending) return
  backendRestartCount++
  if (backendRestartCount > MAX_BACKEND_RESTARTS) {
    console.error(`重启 ${MAX_BACKEND_RESTARTS} 次仍失败`)
    sendToRenderer('backend-status-changed', { healthy: false, restartFailed: true })
    return
  }
  restartPending = true
  const delay = Math.min(2000 * backendRestartCount, 20000)
  console.log(`${delay / 1000}s 后重启 (${backendRestartCount}/${MAX_BACKEND_RESTARTS})`)
  scheduleTrayUpdate()
  restartTimer = setTimeout(async () => {
    restartTimer = null
    if (isQuitting) { restartPending = false; return }
    try {
      if (await startBackend()) waitForBackendNonBlocking()
    } finally {
      restartPending = false
    }
  }, delay)
}

async function restartBackendManual() {
  await killBackend()
  backendRestartCount = 0
  if (await startBackend()) waitForBackendNonBlocking()
}

/** 杀后端 — Windows 优先用 taskkill，兜底 Node kill */
async function killBackend() {
  // 停止健康监控，防止重启
  stopHealthMonitor()

  if (!backendProcess && !backendPID) return

  const pid = backendPID || backendProcess?.pid
  console.log(`正在关闭后端 PID=${pid}`)

  // 方法1: Windows taskkill（杀整个进程树）
  if (process.platform === 'win32' && pid) {
    killProcessTree(pid)
    // 等进程退出
    await new Promise(r => setTimeout(r, 1000))
    backendProcess = null; backendPID = null
    return
  }

  // 方法2: Node.js kill
  if (backendProcess) {
    return new Promise(resolve => {
      const t = setTimeout(() => {
        try { backendProcess.kill() } catch {}
        backendProcess = null; backendPID = null; resolve()
      }, 3000)
      backendProcess.once('exit', () => {
        clearTimeout(t); backendProcess = null; backendPID = null; resolve()
      })
      try { backendProcess.kill() } catch {}
    })
  }

  backendProcess = null; backendPID = null
}

// ============ 退出应用 ============
let quitPromise = null
function quitApp() {
  if (quitPromise) return quitPromise // 防止重复调用
  isQuitting = true
  console.log('正在退出应用...')
  stopHealthMonitor()
  // 取消待触发/延时中的重启，避免退出瞬间又拉一个后端进程起来
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
  restartPending = false

  quitPromise = killBackend().then(() => {
    if (tray) { tray.destroy(); tray = null }
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.destroy(); mainWindow = null }
    // 用 app.exit(0) 而非 app.quit()，避免触发 before-quit 无限循环
    app.exit(0)
  })
  return quitPromise
}

// ============ 窗口 ============
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'resources', 'icon.ico')
  const opts = {
    width: 1400, height: 900, minWidth: 1024, minHeight: 700,
    title: 'SmartSCADA', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true },
  }
  if (fs.existsSync(iconPath)) opts.icon = iconPath

  rendererGone = false
  rendererGoneEarly = false
  mainWindow = new BrowserWindow(opts)

  // 渲染进程错误日志 + 白屏诊断
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    console.error(`[Renderer] 加载失败 code=${code}: ${desc} url=${validatedURL}`)
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    const errorHTML = `<html><body style="font-family:sans-serif;padding:40px;background:#f5f7fa">
      <h2 style="color:#f56c6c">⚠ 页面加载失败</h2>
      <p><b>错误代码:</b> ${esc(code)}</p>
      <p><b>描述:</b> ${esc(desc)}</p>
      <p><b>URL:</b> ${esc(validatedURL || 'N/A')}</p>
      <p><b>后端端口:</b> ${BACKEND_PORT}</p>
      <hr><p style="color:#999">请检查后端服务是否在端口 ${BACKEND_PORT} 上运行</p>
      <button onclick="location.reload()" style="padding:8px 16px;cursor:pointer">重试</button>
    </body></html>`
    mainWindow.loadURL(`data:text/html,${encodeURIComponent(errorHTML)}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Renderer] 崩溃:', details.reason, details.exitCode)
    rendererGone = true
    // 崩在稳定窗口内 = 这次启动**不算成功**（主进程也许还活着，但窗口是死的）。
    // 这只是记录；升级决策发生在稳定计时器回调里（见 whenReady）。
    if (!launchStable) rendererGoneEarly = true
    writeStartupLog('renderer-gone', {
      reason: String(details.reason), exitCode: details.exitCode, duringStartup: !launchStable,
    })
  })
  mainWindow.webContents.on('console-message', (_e, level, msg, line, sourceId) => {
    if (level >= 2) console.error(`[Renderer] ${msg} (${sourceId}:${line})`)
  })

  // Ctrl+Shift+I 打开 DevTools（打包后也能用）
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.openDevTools()
    }
  })

  if (isDev) { mainWindow.loadURL('http://localhost:5173'); mainWindow.webContents.openDevTools() }
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // 页面加载完成后再注入一次端口：resolveBackendPort() 往往在页面 commit 之前就跑完了，
  // 那次 executeJavaScript 会随旧文档一起作废；刷新/二次加载时同样需要重新注入。
  mainWindow.webContents.on('did-finish-load', () => {
    // 帧重新加载成功 → 渲染进程恢复可用（刷新/重试后别再拦住状态通知）
    rendererGone = false
    _lastPushedPort = null
    pushBackendPortToRenderer()
  })

  let closeAttempts = 0
  mainWindow.once('ready-to-show', () => mainWindow.show())

  // 显示窗口时重置关闭计数
  mainWindow.on('show', () => { closeAttempts = 0 })

  // 关闭按钮：第一次隐藏到托盘，第二次真正退出
  mainWindow.on('close', e => {
    if (isQuitting) return // 允许关闭
    e.preventDefault()
    mainWindow.hide()
    closeAttempts++
    if (closeAttempts >= 2) quitApp()
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ============ 开机自启 ============
function getAutoLaunchEnabled() { return app.getLoginItemSettings().openAtLogin }
function setAutoLaunch(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe'), args: ['--hidden'] })
}

function createShortcuts() {
  try {
    const { shell } = require('electron')
    const exe = app.getPath('exe')

    // 「图标看着在、其实指错地方」是**真实踩过**的故障形态（2026-10-09）：
    // 桌面 SmartSCADA.lnk 被外部工具重写成了指向不存在的
    // `...\Programs\SmartSCADA-1033\` 目录 —— 双击的表现就是
    // 「Windows 找不到目标」= 用户嘴里的「双击没反应」。
    // 原先的写法是 `if (!existsSync) 才创建`：**指错了也不管**。
    // 现在：存在但目标不符（或读不出来）→ 重写自愈；目标正确 → 一个字节都不碰。
    const ensureShortcut = (lnkPath, label) => {
      try {
        if (fs.existsSync(lnkPath)) {
          let actual = null
          try { actual = shell.readShortcutLink(lnkPath).target } catch (e) { actual = null }
          if (actual && String(actual).toLowerCase() === String(exe).toLowerCase()) return
          console.warn(`[shortcut] ${label}快捷方式目标不对（${actual || '读取失败'}），重写为 ${exe}`)
          try { fs.unlinkSync(lnkPath) } catch (e) { /* 删不掉就直接覆盖写 */ }
        }
        shell.writeShortcutLink(lnkPath, { target: exe, cwd: path.dirname(exe) })
      } catch (e) {
        console.warn(`[shortcut] ${label}快捷方式处理失败：`, e && e.message)
      }
    }

    const desk = path.join(app.getPath('desktop'), 'SmartSCADA.lnk')
    ensureShortcut(desk, '桌面')
    const appData = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming')
    const smDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SmartSCADA')
    try {
      if (!fs.existsSync(smDir)) fs.mkdirSync(smDir, { recursive: true })
      ensureShortcut(path.join(smDir, 'SmartSCADA.lnk'), '开始菜单')
    } catch (e) {
      // 开始菜单快捷方式失败不影响启动，但**必须出声** ——
      // 静默吞掉的话用户只会觉得"装了但找不到"。
      console.warn('[shortcut] 开始菜单快捷方式创建失败：', e && e.message)
    }
  } catch (e) {
    console.warn('[shortcut] 桌面快捷方式创建失败：', e && e.message)
  }
}

// ============ 主流程 ============
app.whenReady().then(async () => {
  const isHiddenLaunch = process.argv.includes('--hidden')

  const backendExists = fs.existsSync(getBackendPath())
  if (!backendExists) {
    writeStartupLog('backend-missing', { backendPath: String(getBackendPath()) })
    dialog.showErrorBox('后端缺失', `找不到: ${getBackendPath()}\n请重新安装。`)
    app.quit(); return
  }

  createShortcuts()
  if (isFirstRun()) markComplete()
  createTray()

  if (!isHiddenLaunch) {
    // createWindow() 此前**裸调用**：`new BrowserWindow()` 抛错时
    // 整条 whenReady 链以 unhandled rejection 结束，进程退出、无窗口、
    // **不弹窗、不写日志** —— 正是「双击没反应」那个症状。
    // 现在：接住 → 写诊断日志 → 弹窗告诉用户原因与手动兜底方式。
    try {
      createWindow()
      writeStartupLog('window-created')
    } catch (err) {
      writeStartupLog('window-failed', {
        message: String((err && err.message) || err),
        stack: String((err && err.stack) || '').slice(0, 800),
      })
      showWindowFailureDialog(err)
    }
    if (mainWindow && setupUpdater) {
      setupUpdater(() => mainWindow) // 传 getter，窗口重建后自动指向新窗口
      if (!isDev && checkForUpdates) setTimeout(() => checkForUpdates(), 15000)
    }
  }

  // 启动前先确定后端真实端口（读 runtime.json，否则探测 5000/5001，回退 5000）
  await resolveBackendPort()

  // 窗口已经建起来了 → 起一个**延时**清标记：只有在稳定运行
  // `LAUNCH_STABLE_MS` 之后才算「这次启动真的成功了」。
  // 见 LAUNCH_STABLE_MS 的说明 —— GPU 可能在窗口建好之后才崩。
  if (mainWindow) {
    setTimeout(() => {
      launchStable = true
      if (rendererGoneEarly) {
        // 窗口建出来了、主进程也活够了 15 秒 —— 但**渲染进程死在启动阶段**。
        // 实测过这种形态：GPU 只关到 L1 时页面进程崩 ×2，窗口是死的（白窗）。
        // 这**不算成功**：保留标记（下次启动在本次级别上再升一级），不记 gpu-state。
        writeStartupLog('launch-unstable-renderer', {
          stableMs: LAUNCH_STABLE_MS, fallbackLevel: gpuFallbackLevel,
        })
        return
      }
      markLaunchSucceeded()
      // 稳定运行满 LAUNCH_STABLE_MS → 这次启动**确实成功了**。
      // 日志里有了这一行，才能把「窗口建出来但随后崩」和「压根没建出来」区分开。
      writeStartupLog('launch-stable', { stableMs: LAUNCH_STABLE_MS, fallbackLevel: gpuFallbackLevel })
    }, LAUNCH_STABLE_MS)
  }

  startBackend().then(started => {
    if (started) waitForBackendNonBlocking()
  })

  startHealthMonitor()
}).catch((err) => {
  // 兜底：whenReady 链上任何一步抛错（含上面 try/catch 之外的）都要留下痕迹，
  // 而不是变成一条无人看见的 unhandled rejection。
  writeStartupLog('when-ready-failed', {
    message: String((err && err.message) || err),
    stack: String((err && err.stack) || '').slice(0, 800),
  })
  showWindowFailureDialog(err)
})

// ============ 生命周期 ============
app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
app.on('window-all-closed', () => {})
app.on('activate', () => { if (!mainWindow) createWindow(); else mainWindow.show() })

// before-quit：确保后端被杀
app.on('before-quit', (e) => {
  // 正常退出 → 清掉启动尝试标记。
  // 这样「标记还在」才真正等于「上次没走完正常流程」（崩溃 / 被强杀），
  // 自愈降级据此触发 —— 见文件顶部的 GPU/沙箱兜底说明。
  markLaunchSucceeded()
  writeStartupLog('quit')
  if (!isQuitting) {
    e.preventDefault()
    quitApp() // 返回 promise，app.exit(0) 会在清理完成后调用
  }
})

// ============ IPC ============
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-backend-status', async () => ({
  running: backendHealthy, port: syncBackendPort(),
  portOpen: await isPortOpen(syncBackendPort()), ownedByUs: backendOwnedByUs,
}))
ipcMain.handle('get-system-info', () => getSystemInfo())
ipcMain.handle('run-diagnostics', async () => ({
  backendExists: fs.existsSync(getBackendPath()),
  // ⚠️ 字段名必须叫 portFree，**不能**叫 portAvailable。
  //    isPortOpen() 的语义是「**能连上**（有进程在监听）」，所以
  //    `!isPortOpen(...)` 表达的是「端口**空闲**」—— 叫 portAvailable 时，
  //    与 get-backend-status 的 `portOpen` 恰好**语义相反**，
  //    读的人会得出与事实相反的结论。
  //    本通道当前无人调用（见 tests/electron/ipc-wiring.test.ts），
  //    所以改的是「将来接线时会不会被坑」，不是当下的用户可见行为。
  portFree: !(await isPortOpen(BACKEND_PORT)),
  systemInfo: getSystemInfo(), errors: [], warnings: [],
}))
ipcMain.handle('get-auto-launch', () => getAutoLaunchEnabled())
ipcMain.handle('set-auto-launch', (_e, en) => { setAutoLaunch(en); return getAutoLaunchEnabled() })
