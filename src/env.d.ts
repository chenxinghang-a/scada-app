/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ElectronAPI {
  getAppVersion: () => Promise<string>
  getBackendStatus: () => Promise<{
    running: boolean
    port: number
    portOpen: boolean
    ownedByUs: boolean
  }>
  getSystemInfo: () => Promise<{
    platform: string
    arch: string
    release: string
    totalMemory: number
    freeMemory: number
    cpus: number
    hostname: string
  }>
  runDiagnostics: () => Promise<{
    backendExists: boolean
    portAvailable: boolean
    systemInfo: any
    errors: string[]
    warnings: string[]
  }>
  getAutoLaunch: () => Promise<boolean>
  setAutoLaunch: (enabled: boolean) => Promise<boolean>
  onBackendLog: (callback: (data: string) => void) => () => void
  onBackendStatusChanged: (callback: (data: { healthy: boolean }) => void) => () => void
}

declare const __APP_VERSION__: string

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
