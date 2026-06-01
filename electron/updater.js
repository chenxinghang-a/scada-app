let autoUpdater
try { autoUpdater = require('electron-updater').autoUpdater } catch { autoUpdater = null }

const { BrowserWindow, dialog } = require('electron')

let updateAvailable = false
let updateDownloaded = false

function sendToRenderer(getWindow, channel, data) {
  const win = typeof getWindow === 'function' ? getWindow() : getWindow
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function setupUpdater(getWindow) {
  if (!autoUpdater) { console.log('electron-updater 不可用'); return }

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
  if (!autoUpdater || updateDownloaded) return
  autoUpdater.checkForUpdates().catch(err => {
    console.error('检查更新失败:', err.message)
  })
}

module.exports = { setupUpdater, checkForUpdates }
