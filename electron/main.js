const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn, execSync } = require('child_process')
const net = require('net')
const fs = require('fs')

// ============ 单实例锁 ============
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

let mainWindow = null
let tray = null
let backendProcess = null
const BACKEND_PORT = 5000  // 模拟模式端口
const isDev = !app.isPackaged

// ============ 开机自启管理 ============
function getAutoLaunchEnabled() {
  return app.getLoginItemSettings().openAtLogin
}

function setAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe'),
    args: ['--hidden'],
  })
  console.log(`开机自启: ${enabled ? '已启用' : '已禁用'}`)
}

// ============ 快捷方式管理 ============
function createShortcuts() {
  try {
    const { shell } = require('electron')
    const exePath = app.getPath('exe')

    // 桌面快捷方式
    const desktopPath = app.getPath('desktop')
    const shortcutPath = path.join(desktopPath, 'SmartSCADA.lnk')

    if (!fs.existsSync(shortcutPath)) {
      shell.writeShortcutLink(shortcutPath, {
        target: exePath,
        cwd: path.dirname(exePath),
        description: 'SmartSCADA - 工业数据采集与监控系统',
      })
      console.log('桌面快捷方式已创建')
    }

    // 开始菜单快捷方式（使用 APPDATA 路径）
    const appData = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming')
    const programsPath = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SmartSCADA')

    try {
      if (!fs.existsSync(programsPath)) {
        fs.mkdirSync(programsPath, { recursive: true })
      }

      const startMenuShortcut = path.join(programsPath, 'SmartSCADA.lnk')
      if (!fs.existsSync(startMenuShortcut)) {
        shell.writeShortcutLink(startMenuShortcut, {
          target: exePath,
          cwd: path.dirname(exePath),
          description: 'SmartSCADA - 工业数据采集与监控系统',
        })
        console.log('开始菜单快捷方式已创建')
      }
    } catch (e) {
      console.log('开始菜单快捷方式创建跳过:', e.message)
    }
  } catch (e) {
    console.log('快捷方式创建跳过:', e.message)
  }
}

// ============ 环境检查 ============
function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'backend', 'scada-backend.exe')
  }
  return path.join(process.resourcesPath, 'backend', 'scada-backend.exe')
}

function checkBackendExists() {
  const backendPath = getBackendPath()
  return fs.existsSync(backendPath)
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

function getSystemInfo() {
  const os = require('os')
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 10) / 10,
    freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024 * 10) / 10,
    cpus: os.cpus().length,
    hostname: os.hostname(),
  }
}

// 完整环境诊断
async function runDiagnostics() {
  const results = {
    backendExists: false,
    portAvailable: false,
    systemInfo: getSystemInfo(),
    errors: [],
    warnings: [],
  }

  // 1. 检查后端文件
  results.backendExists = checkBackendExists()
  if (!results.backendExists) {
    results.errors.push(`后端文件不存在: ${getBackendPath()}`)
  }

  // 2. 检查端口
  const portInUse = await checkPort(BACKEND_PORT)
  results.portAvailable = !portInUse
  if (portInUse) {
    results.warnings.push(`端口 ${BACKEND_PORT} 已被占用（可能是上次未正常退出）`)
  }

  // 3. 检查内存
  if (results.systemInfo.freeMemory < 0.5) {
    results.warnings.push(`可用内存不足: ${results.systemInfo.freeMemory}GB`)
  }

  return results
}

// ============ 后端管理 ============
async function startBackend() {
  const portInUse = await checkPort(BACKEND_PORT)
  if (portInUse) {
    console.log(`端口 ${BACKEND_PORT} 已被占用，跳过后端启动（可能已有实例运行）`)
    return true
  }

  if (!checkBackendExists()) {
    const backendPath = getBackendPath()
    dialog.showErrorBox(
      '后端文件缺失',
      `找不到后端程序: ${backendPath}\n\n请重新安装 SmartSCADA 或联系管理员。`
    )
    return false
  }

  const backendPath = getBackendPath()
  const backendDir = path.dirname(backendPath)

  console.log(`启动后端: ${backendPath}`)

  try {
    backendProcess = spawn(backendPath, [], {
      cwd: backendDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) console.log(`[Backend] ${msg}`)
    })

    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) console.error(`[Backend] ${msg}`)
    })

    backendProcess.on('error', (err) => {
      console.error('后端启动失败:', err)
    })

    backendProcess.on('exit', (code) => {
      console.log(`后端进程退出，代码: ${code}`)
      backendProcess = null
      // 非正常退出且不是正在退出时，尝试重启
      if (code !== 0 && !app.isQuitting) {
        console.log('后端异常退出，3秒后尝试重启...')
        setTimeout(() => startBackend(), 3000)
      }
    })

    return true
  } catch (err) {
    console.error('启动后端异常:', err)
    return false
  }
}

function waitForBackend(maxWait = 60000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    const check = () => {
      if (Date.now() - startTime > maxWait) {
        reject(new Error('后端启动超时'))
        return
      }
      const req = net.createConnection(BACKEND_PORT, '127.0.0.1')
      req.on('connect', () => {
        req.destroy()
        resolve()
      })
      req.on('error', () => {
        setTimeout(check, 500)
      })
    }
    check()
  })
}

// ============ 窗口管理 ============
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'SmartSCADA',
    show: false,
    icon: path.join(__dirname, '..', 'resources', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============ 系统托盘 ============
function createTray() {
  const iconPath = path.join(__dirname, '..', 'resources', 'tray-icon.ico')
  let icon
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) throw new Error('empty')
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('SmartSCADA - 工业数据采集与监控系统')

  const autoLaunchEnabled = getAutoLaunchEnabled()

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: '后端状态',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: autoLaunchEnabled,
      click: (menuItem) => {
        setAutoLaunch(menuItem.checked)
      },
    },
    { type: 'separator' },
    {
      label: '退出 SmartSCADA',
      click: () => {
        app.isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ============ 启动流程 ============
app.whenReady().then(async () => {
  // 检查是否是开机自启（--hidden 参数）
  const isHiddenLaunch = process.argv.includes('--hidden')

  // 环境诊断
  const diag = await runDiagnostics()
  console.log('环境诊断:', JSON.stringify(diag, null, 2))

  if (diag.errors.length > 0) {
    dialog.showErrorBox('环境检查失败', diag.errors.join('\n'))
    app.quit()
    return
  }

  // 创建快捷方式（首次运行时）
  createShortcuts()

  // 创建托盘
  createTray()

  // 启动后端
  const started = await startBackend()

  if (started) {
    try {
      await waitForBackend()
      console.log('后端已就绪')
    } catch (err) {
      console.error(err.message)
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: '启动失败',
        message: '后端服务启动超时',
        detail: `后端程序: ${getBackendPath()}\n端口: ${BACKEND_PORT}\n\n可能原因:\n1. 端口被其他程序占用\n2. 后端程序损坏\n3. 系统防火墙拦截`,
        buttons: ['重试', '退出'],
        defaultId: 0,
      })
      if (choice === 0) {
        // 重试
        app.relaunch()
        app.exit()
      } else {
        app.quit()
      }
      return
    }
  }

  // 创建窗口（如果不是隐藏启动）
  if (isHiddenLaunch) {
    // 开机自启模式：只创建托盘，不显示窗口
    console.log('开机自启模式，最小化到托盘')
  } else {
    createWindow()
  }
})

app.on('second-instance', () => {
  // 第二个实例尝试启动时，显示主窗口
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // Windows 下保持托盘运行
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  } else {
    mainWindow.show()
  }
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
})

// ============ IPC 接口 ============
ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('get-backend-status', async () => {
  const running = await checkPort(BACKEND_PORT)
  return { running, port: BACKEND_PORT }
})

ipcMain.handle('get-system-info', () => getSystemInfo())

ipcMain.handle('run-diagnostics', async () => {
  return await runDiagnostics()
})

ipcMain.handle('get-auto-launch', () => {
  return getAutoLaunchEnabled()
})

ipcMain.handle('set-auto-launch', (_event, enabled) => {
  setAutoLaunch(enabled)
  return getAutoLaunchEnabled()
})
