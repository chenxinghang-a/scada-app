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
const BACKEND_PORT = 5000
const BACKEND_HOST = '127.0.0.1'
const HEALTH_ENDPOINT = '/api/health/status'
const isDev = !app.isPackaged
const MAX_BACKEND_RESTARTS = 5

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

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://${BACKEND_HOST}:${BACKEND_PORT}${HEALTH_ENDPOINT}`, { timeout: 2000 }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 400))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function waitForBackendNonBlocking() {
  const startTime = Date.now()
  const TIMEOUT = 60000
  const check = async () => {
    if (Date.now() - startTime > TIMEOUT) {
      console.warn('后端健康检查超时(60s)')
      sendToRenderer('backend-status-changed', { healthy: false, timeout: true })
      return
    }
    if (await checkBackendHealth()) {
      backendHealthy = true; backendRestartCount = 0
      scheduleTrayUpdate(); sendToRenderer('backend-status-changed', { healthy: true })
      console.log('后端健康检查通过')
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
      sendToRenderer('backend-status-changed', { healthy: backendHealthy })
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
  running: backendHealthy, port: BACKEND_PORT,
  portOpen: await isPortOpen(BACKEND_PORT), ownedByUs: backendOwnedByUs,
}))
ipcMain.handle('get-system-info', () => getSystemInfo())
ipcMain.handle('run-diagnostics', async () => ({
  backendExists: fs.existsSync(getBackendPath()),
  portAvailable: !(await isPortOpen(BACKEND_PORT)),
  systemInfo: getSystemInfo(), errors: [], warnings: [],
}))
ipcMain.handle('get-auto-launch', () => getAutoLaunchEnabled())
ipcMain.handle('set-auto-launch', (_e, en) => { setAutoLaunch(en); return getAutoLaunchEnabled() })
