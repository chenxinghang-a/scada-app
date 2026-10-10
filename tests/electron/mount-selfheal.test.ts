/**
 * 白屏自愈守卫（2026-10-10，事故②的防御性收口）。
 *
 * 背景：打包版页面在"特定用户数据状态"下挂载失败（类循环 + 加载时序），
 * 窗口正常但 `#app` 永远为空 —— 用户看到灰白屏、无任何提示。
 * 修复了已知循环之后再加一道自愈：启动后探测 `#app` 是否挂载，
 * 没挂上 → 清代码缓存 + 重载一次；无论成败都写 startup.log。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const MAIN = path.join(REPO, 'electron', 'main.js')
const CODE = fs.readFileSync(MAIN, 'utf8')

describe('白屏自愈（#app 挂载探测 → 清缓存 → 重载一次）', () => {
  it('有挂载探测：以 #app 的子节点数为判据', () => {
    expect(CODE).toContain('function armMountWatchdog')
    expect(CODE).toContain('getElementById("app")')
    expect(CODE).toMatch(/children\.length/)
  })

  it('自愈动作 = 清代码缓存 + 重载（且只重载一次）', () => {
    expect(CODE).toContain('clearCodeCaches')
    expect(CODE).toContain('webContents.reload()')
    // 单次守卫 + 持久失败分支（不许变成重载循环）
    expect(CODE).toContain('mountWatchdogFired')
    expect(CODE).toContain("mount-failed-persist")
  })

  it('无论修好与否都留证据（startup.log）', () => {
    expect(CODE).toContain("writeStartupLog('mount-failed'")
  })

  it('开发模式不掺和（vite dev server 语义不同）', () => {
    const fn = CODE.slice(CODE.indexOf('function armMountWatchdog'))
    const head = fn.slice(0, fn.indexOf('setTimeout'))
    expect(head).toContain('if (isDev) return')
  })

  it('在窗口创建后被调用（whenReady 链里）', () => {
    const readyIdx = CODE.indexOf('app.whenReady()')
    const callIdx = CODE.indexOf('armMountWatchdog()', readyIdx)
    expect(readyIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeGreaterThan(readyIdx)
  })
})
