const { BrowserWindow, dialog, app } = require('electron')
const path = require('path')
const fs = require('fs')

// ---------------------------------------------------------------------------
// 更新能力自检（为什么需要这个）
//
// 打包后的 Windows 应用**没有控制台**，`console.log/warn` 谁也看不见。
// 此前 electron-updater 未安装时，这里只 `console.log('electron-updater 不可用')`
// 然后 `return` —— 结果是「永远不更新」这件事对用户和开发者**完全不可见**：
// 用户以为自己在用最新版，开发者以为更新链路是通的。
// 这正是本项目（后端 round 159/160）反复在修的「静默失效」，
// 只不过发生在 JS 侧。
//
// 所以这里把原因**落盘**到 userData/update.log，事后可诊断。
// 本模块只做「让失败可见」，**不改变行为** —— 真正接通自动更新需要
// `npm i electron-updater` + 配置 build.publish（+ 修 latest.yml 文件名不一致），
// 那是单独一步，见 `SCADA-交付链缺口与修复方案.md` P3-a / P3-b。
// ---------------------------------------------------------------------------
let autoUpdater = null
let loadError = null
try {
  autoUpdater = require('electron-updater').autoUpdater
} catch (e) {
  loadError = e
}

let unavailableReported = false

function reportUnavailable(reason) {
  if (unavailableReported) return
  unavailableReported = true
  // 原因里可能带换行（例如 Node 的 "Cannot find module ...\nRequire stack:\n- ..."），
  // 直接落盘会把一条日志写成多行，破坏「一行一条」的日志格式。压成单行。
  const oneLine = String(reason).replace(/\s*\r?\n\s*/g, ' | ').trim()
  const msg = `自动更新不可用: ${oneLine}`
  console.warn(`[updater] ${msg}`)
  try {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(
      path.join(dir, 'update.log'),
      `${new Date().toISOString()} [updater] ${msg}\n`,
      'utf8',
    )
  } catch (e) {
    // 落盘也失败时不再向上抛：上面那条 console.warn 已是最后手段，
    // 「更新能力探测失败」绝不能影响应用启动。
  }
}

let updateAvailable = false
let updateDownloaded = false

function sendToRenderer(getWindow, channel, data) {
  const win = typeof getWindow === 'function' ? getWindow() : getWindow
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function setupUpdater(getWindow) {
  if (!autoUpdater) {
    reportUnavailable(
      loadError
        ? `electron-updater 加载失败 (${loadError.message}) —— package.json 里没有该依赖`
        : 'electron-updater 不可用'
    )
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    console.log('检查更新...')
    sendToRenderer(getWindow, 'update-status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    console.log('发现新版本:', info.version)
    updateAvailable = true
    sendToRenderer(getWindow, 'update-status', { status: 'available', version: info.version })

    const win = typeof getWindow === 'function' ? getWindow() : getWindow
    if (!win || win.isDestroyed()) return

    dialog.showMessageBox(win, {
      type: 'info', title: '发现新版本',
      message: `SmartSCADA ${info.version} 已发布`,
      detail: '是否现在下载更新？',
      buttons: ['下载', '稍后'], defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate()
        sendToRenderer(getWindow, 'update-status', { status: 'downloading' })
      }
    }).catch(() => {})
  })

  autoUpdater.on('update-not-available', () => {
    console.log('当前已是最新版本')
    sendToRenderer(getWindow, 'update-status', { status: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer(getWindow, 'update-progress', { percent: progress.percent, bytesPerSecond: progress.bytesPerSecond })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('更新下载完成')
    updateDownloaded = true
    sendToRenderer(getWindow, 'update-status', { status: 'downloaded', version: info.version })

    const win = typeof getWindow === 'function' ? getWindow() : getWindow
    if (!win || win.isDestroyed()) return

    dialog.showMessageBox(win, {
      type: 'info', title: '更新已就绪',
      message: '更新已下载完成，是否立即重启安装？',
      buttons: ['立即重启', '稍后重启'], defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    }).catch(() => {})
  })

  autoUpdater.on('error', (err) => {
    console.error('更新检查失败:', err.message)
    sendToRenderer(getWindow, 'update-status', { status: 'error', error: err.message })
  })
}

function checkForUpdates() {
  if (!autoUpdater) {
    reportUnavailable('electron-updater 未安装，跳过更新检查')
    return
  }
  if (updateDownloaded) return
  autoUpdater.checkForUpdates().catch(err => {
    console.error('检查更新失败:', err.message)
  })
}

module.exports = { setupUpdater, checkForUpdates }
