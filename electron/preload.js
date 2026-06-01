const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  runDiagnostics: () => ipcRenderer.invoke('run-diagnostics'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  onBackendLog: (callback) => ipcRenderer.on('backend-log', (_event, data) => callback(data)),
})
