const { BrowserWindow, dialog, app } = require('electron')
const path = require('path')
const fs = require('fs')

// ===========================================================================
// 自动更新：明确【关闭】
// ===========================================================================
// 本项目交付口径（审计 Phase 5）："一个版本源、一个 commit、一个安装包"。
//   - 后端 VERSION 文件是唯一版本真源，前后端 lockstep；
//   - 安装包由 electron-builder 产出（nsis），通过发布流程一次性分发；
//   - 运行期【不启用】自动更新。
//
// 为什么要"显式关闭"而不是留 no-op：
//   旧实现依赖 `require('electron-updater')` 失败来"碰巧"不更新——
//   package.json 从未声明该依赖，catch 后只 console.log 再 return，
//   等于一个静默失效的 no-op，用户以为在用最新版、开发者以为链路通。
//   这正是后端反复在修的"静默失效"。审计明确要求"不得保留 no-op"，
//   所以这里把"自动更新未启用"做成【显式、可读、可诊断】的状态。
//
// 关闭的硬约束（任一条不满足，更新都应保持关闭）：
//   1. AUTO_UPDATE_ENABLED = false（本文件显式开关）；
//   2. package.json build 段未配置 publish（无更新服务器）；
//   3. package.json 未声明 electron-updater 依赖。
//
// 若要真正启用自动更新，必须同时完成：
//   a) AUTO_UPDATE_ENABLED = true；
//   b) npm i electron-updater；
//   c) package.json 的 build 段配置 publish；
//   d) 修复 latest.yml 文件名一致性（见交付链缺口文档 P3-b）。
// 上面任何一步没做，这里都会以"未启用"状态明确退出，而不是假装在工作。
// ===========================================================================
const AUTO_UPDATE_ENABLED = false

let autoUpdater = null
let loadError = null
try {
  autoUpdater = require('electron-updater').autoUpdater
} catch (e) {
  loadError = e
}

let disabledReported = false

// 把"自动更新未启用"这件事落盘，事后可诊断（打包后无控制台，日志是唯一线索）。
function reportDisabled(reason) {
  if (disabledReported) return
  disabledReported = true
  const oneLine = String(reason).replace(/\s*\r?\n\s*/g, ' | ').trim()
  const msg = `自动更新未启用: ${oneLine}`
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
    // 落盘也失败时不再向上抛：更新能力探测失败绝不能影响应用启动。
  }
}

let updateAvailable = false
let updateDownloaded = false

function sendToRenderer(getWindow, channel, data) {
  const win = typeof getWindow === 'function' ? getWindow() : getWindow
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function setupUpdater(getWindow) {
  // —— 显式关闭：自动更新未启用，给出可读原因后退出，不做任何更新检查 ——
  if (!AUTO_UPDATE_ENABLED) {
    reportDisabled(
      'AUTO_UPDATE_ENABLED=false（交付口径：一个版本源/一个安装包，运行期不自动更新）。' +
      (loadError ? ` electron-updater 也未安装 (${loadError.message})` : ' electron-updater 依赖未声明')
    )
    return
  }

  // 防御：即便开关打开，但依赖缺失/未配置 publish，也应明确退出而非静默 no-op。
  if (!autoUpdater) {
    reportDisabled(
      loadError
        ? `electron-updater 加载失败 (${loadError.message}) —— package.json 未声明该依赖`
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
  if (!AUTO_UPDATE_ENABLED) {
    reportDisabled('AUTO_UPDATE_ENABLED=false，跳过更新检查')
    return
  }
  if (!autoUpdater) {
    reportDisabled('electron-updater 未安装，跳过更新检查')
    return
  }
  if (updateDownloaded) return
  autoUpdater.checkForUpdates().catch(err => {
    console.error('检查更新失败:', err.message)
  })
}

module.exports = { setupUpdater, checkForUpdates, AUTO_UPDATE_ENABLED }
