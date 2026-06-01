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
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('backend-status-changed', handler)
    return () => ipcRenderer.removeListener('backend-status-changed', handler)
  },
})
