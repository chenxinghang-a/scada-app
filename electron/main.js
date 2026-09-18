const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, session } = require('electron')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const net = require('net')
const fs = require('fs')
// updater 可选
let setupUpdater = null, checkForUpdates = null
try { const u = require('./updater'); setupUpdater = u.setupUpdater; checkForUpdates = u.checkForUpdates } catch {}
const { isFirstRun, markComplete } = require('./first-run')

// ============ 常量 ============
// 端口默认回退到 5000（向后兼容 / 模拟模式）。真实模式下后端监听 5001，
// 实际端口以运行时文件 runtime.json 为准（见 getRuntimePort / syncBackendPort）。
let BACKEND_PORT = 5000
const BACKEND_HOST = '127.0.0.1'
const HEALTH_ENDPOINT = '/api/health/status'
const isDev = !app.isPackaged
const MAX_BACKEND_RESTARTS = 5

// 后端运行时端口文件：后端启动后写入 {port,host,pid,mode,started_at}。
// 路径与后端 paths.RUNTIME_JSON_PATH 对齐 —— <backend_dir>/data/runtime.json。
// 后端冻结（PyInstaller onefile）时 backend 目录即 scada-backend.exe 所在目录，
// 开发/打包布局下 getBackendPath() 已能稳定解析该目录，故此处直接拼接。
const RUNTIME_JSON_PATH = path.join(path.dirname(getBackendPath()), 'data', 'runtime.json')

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

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) { app.quit() }

// ============ 工具 ============
function getBackendPath() {
  return isDev
    ? path.join(__dirname, '..', 'backend', 'scada-backend.exe')
    : path.join(process.resourcesPath, 'backend', 'scada-backend.exe')
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// 把当前解析出的后端端口注入渲染进程（仅 main.js 侧，无需改动 preload/src）。
// 前端约定：从 window.__BACKEND_PORT__ 读取实际端口用于 axios baseURL / WebSocket，
// 回退值 5000 与历史行为一致。main.js 在端口确定或变更时调用本函数（带去重）。
let _lastPushedPort = null
function pushBackendPortToRenderer() {
  const p = Number(BACKEND_PORT) || 5000
  if (p === _lastPushedPort) return
  _lastPushedPort = p
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`window.__BACKEND_PORT__ = ${p};`).catch(() => {})
  }
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
// 读不到（后端尚未写入/文件被删）时返回 null，调用方回退到 BACKEND_PORT 或探测。
function readRuntimePort() {
  try {
    const txt = fs.readFileSync(RUNTIME_JSON_PATH, 'utf-8')
    const obj = JSON.parse(txt)
    if (obj && Number.isInteger(obj.port) && obj.port > 0) return obj.port
  } catch (e) {
    // 文件不存在 / 解析失败：视为暂无，不报错（后端可能正在启动）
  }
  return null
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

async function attemptRestart() {
  backendRestartCount++
  if (backendRestartCount > MAX_BACKEND_RESTARTS) {
    console.error(`重启 ${MAX_BACKEND_RESTARTS} 次仍失败`)
    sendToRenderer('backend-status-changed', { healthy: false, restartFailed: true })
    return
  }
  const delay = Math.min(2000 * backendRestartCount, 20000)
  console.log(`${delay / 1000}s 后重启 (${backendRestartCount}/${MAX_BACKEND_RESTARTS})`)
  scheduleTrayUpdate()
  setTimeout(async () => {
    if (isQuitting) return
    if (await startBackend()) waitForBackendNonBlocking()
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
    const desk = path.join(app.getPath('desktop'), 'SmartSCADA.lnk')
    if (!fs.existsSync(desk)) shell.writeShortcutLink(desk, { target: exe, cwd: path.dirname(exe) })
    const appData = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming')
    const smDir = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SmartSCADA')
    try { if (!fs.existsSync(smDir)) fs.mkdirSync(smDir, { recursive: true }); const sm = path.join(smDir, 'SmartSCADA.lnk'); if (!fs.existsSync(sm)) shell.writeShortcutLink(sm, { target: exe, cwd: path.dirname(exe) }) } catch {}
  } catch {}
}

// ============ 主流程 ============
app.whenReady().then(async () => {
  const isHiddenLaunch = process.argv.includes('--hidden')

  const backendExists = fs.existsSync(getBackendPath())
  if (!backendExists) {
    dialog.showErrorBox('后端缺失', `找不到: ${getBackendPath()}\n请重新安装。`)
    app.quit(); return
  }

  createShortcuts()
  if (isFirstRun()) markComplete()
  createTray()

  if (!isHiddenLaunch) {
    createWindow()
    if (mainWindow && setupUpdater) {
      setupUpdater(() => mainWindow) // 传 getter，窗口重建后自动指向新窗口
      if (!isDev && checkForUpdates) setTimeout(() => checkForUpdates(), 15000)
    }
  }

  // 启动前先确定后端真实端口（读 runtime.json，否则探测 5000/5001，回退 5000）
  await resolveBackendPort()

  startBackend().then(started => {
    if (started) waitForBackendNonBlocking()
  })

  startHealthMonitor()
})

// ============ 生命周期 ============
app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
app.on('window-all-closed', () => {})
app.on('activate', () => { if (!mainWindow) createWindow(); else mainWindow.show() })

// before-quit：确保后端被杀
app.on('before-quit', (e) => {
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
  portAvailable: !(await isPortOpen(BACKEND_PORT)),
  systemInfo: getSystemInfo(), errors: [], warnings: [],
}))
ipcMain.handle('get-auto-launch', () => getAutoLaunchEnabled())
ipcMain.handle('set-auto-launch', (_e, en) => { setAutoLaunch(en); return getAutoLaunchEnabled() })
