const { BrowserWindow, dialog, app } = require('electron')
const path = require('path')
const fs = require('fs')

// ===========================================================================
// 自动更新：已启用（2026-10-19 决策 A —— 走 GitHub Releases）
// ===========================================================================
// 变更原因：原口径是"运行期不自动更新"（一个版本源、一个安装包）。审计后决定
// 启用自动更新，发布渠道选 GitHub Releases（项目已在 GitHub，零额外成本）。
//
// 启用后必须同时满足的四件事（缺一条这里就会显式报"未启用"并退出，不会假装工作）：
//   1. AUTO_UPDATE_ENABLED = true（本文件开关）；
//   2. package.json build 段配置 publish（指向 GitHub 仓库）；
//   3. package.json 声明 electron-updater 依赖；
//   4. latest.yml 与产物文件名一致（由 nsis.artifactName 保证，已统一）。
//
// 发布流程：推 `v*` tag → .github/workflows/release.yml 构建并发布到 GitHub Releases
// → 已安装的旧版启动 15 秒后检查更新 → 有新版弹窗询问是否下载。
//
// 保留的 fail-closed 行为（不要删）：
//   - 依赖缺失 / 未配置 publish → 明确落盘"未启用"，绝不静默 no-op；
//   - 开发模式（!isDev 才调用）不检查更新，避免打向发布服务器。
// ===========================================================================
const AUTO_UPDATE_ENABLED = true

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

// 头注硬约束 2 的**代码实现**：build 段是否配置了 publish（= 有更新服务器）。
// 读的是**打包进 app 的 package.json**（app.getAppPath() 下），与"用户是否配了服务器"一致。
// 任一环节读不到，都按"未配置"处理（fail-closed：宁可认为没有更新服务器）。
function hasPublishConfig() {
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const publish = pkg && pkg.build && pkg.build.publish
    if (Array.isArray(publish)) return publish.length > 0
    return !!publish
  } catch (e) {
    return false
  }
}

function sendToRenderer(getWindow, channel, data) {
  const win = typeof getWindow === 'function' ? getWindow() : getWindow
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function setupUpdater(getWindow) {
  // —— 显式关闭：自动更新未启用，给出可读原因后退出，不做任何更新检查 ——
  if (!AUTO_UPDATE_ENABLED) {
    reportDisabled(
      'AUTO_UPDATE_ENABLED=false（自动更新被显式关闭）。' +
      (loadError ? ` electron-updater 也未安装 (${loadError.message})` : '')
    )
    return
  }

  // 防御：即便开关打开，但依赖缺失 / 未配置 publish，也应明确退出而非静默 no-op。
  if (!autoUpdater) {
    reportDisabled(
      loadError
        ? `electron-updater 加载失败 (${loadError.message}) —— package.json 未声明该依赖`
        : 'electron-updater 不可用'
    )
    return
  }

  // 防御：头注把「build 段未配置 publish（无更新服务器）」列为硬约束 ——
  // 这里必须**真的检查**，否则就成了一条"只写在注释里"的假保证：
  // 一旦开关被翻开而 publish 没配，checkForUpdates() 会打向一个不存在的服务器。
  if (!hasPublishConfig()) {
    reportDisabled(
      'package.json 的 build 段未配置 publish（无更新服务器）—— 即便开关打开，更新也保持关闭。'
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
  // 与 setupUpdater 同一条硬约束：未配置 publish 就不该去 check（会打向空服务器）
  if (!hasPublishConfig()) {
    reportDisabled('build 段未配置 publish，跳过更新检查')
    return
  }
  if (updateDownloaded) return
  autoUpdater.checkForUpdates().catch(err => {
    console.error('检查更新失败:', err.message)
  })
}

module.exports = { setupUpdater, checkForUpdates, AUTO_UPDATE_ENABLED, hasPublishConfig }
