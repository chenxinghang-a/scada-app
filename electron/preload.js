const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  runDiagnostics: () => ipcRenderer.invoke('run-diagnostics'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  onBackendLog: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('backend-log', handler)
    return () => ipcRenderer.removeListener('backend-log', handler)
  },
  onBackendStatusChanged: (callback) => {
    const handler = (_event, data) => {
      // 同时以 DOM 自定义事件广播一次：渲染侧 src/api/request.ts 监听
      // window 的 'backend-status-changed' 事件来同步 __BACKEND_PORT__ / baseURL，
      // 之前只有 ipc 回调、没人派发 DOM 事件，那条监听实际是死的。
      try {
        window.dispatchEvent(new CustomEvent('backend-status-changed', { detail: data }))
      } catch { /* 事件派发失败不影响 ipc 回调 */ }
      callback(data)
    }
    ipcRenderer.on('backend-status-changed', handler)
    return () => ipcRenderer.removeListener('backend-status-changed', handler)
  },
})
