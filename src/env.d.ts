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
    /** 端口**空闲**（没有任何进程在监听）。注意与 `getBackendStatus().portOpen` **语义相反** ——
     *  那个是「有进程在监听」。同名不同义会让读的人得出相反结论，故此处刻意用 portFree。 */
    portFree: boolean
    systemInfo: any
    errors: string[]
    warnings: string[]
  }>
  getAutoLaunch: () => Promise<boolean>
  setAutoLaunch: (enabled: boolean) => Promise<boolean>
  onBackendLog: (callback: (data: string) => void) => () => void
  /** 主进程推送的后端状态。**载荷是全量的**（见 electron/main.js 的
   *  sendToRenderer('backend-status-changed', …) 各调用点）：
   *  正常时 `{healthy, port}`；异常分支还会带 `timeout` / `portConflict` / `missing`。
   *  声明必须覆盖实际载荷，否则消费者只能 `as any` 绕过类型（原先正是如此）。 */
  onBackendStatusChanged: (callback: (data: {
    healthy: boolean
    port?: number
    timeout?: boolean
    portConflict?: boolean
    missing?: boolean
  }) => void) => () => void
}

declare const __APP_VERSION__: string

// ⚠️ 这里**不能**写成 `declare global { interface Window { … } }`。
//    本文件没有顶层 import/export，因此它是一个**全局脚本**而不是模块；
//    而 `declare global` 只在**模块**里才有意义 —— 写在脚本里是惰性的，
//    全局 `Window` 根本不会被增强。
//
//    这个坑真实存在过（2026-10-08，round 192 发现）：
//    原先包着 `declare global`，于是 `window.electronAPI` **从来没有被类型化**，
//    唯一的消费者（`src/components/MainLayout.vue`）只能写 `window as any`
//    再就地手写一份载荷类型 —— **等于绕过类型检查**，
//    声明写错了也没人会发现（实测 `onBackendStatusChanged` 的声明只写了
//    `{healthy}`，实际载荷还有 `port` / `timeout` / `portConflict` / `missing`）。
//
//    正确写法就是在全局脚本里**直接**声明 `interface Window`（它会自动与全局合并）。
interface Window {
  electronAPI?: ElectronAPI
}
