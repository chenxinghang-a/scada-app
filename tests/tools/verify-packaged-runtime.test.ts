/**
 * `tools/verify-packaged-runtime.js` 的结构守卫（不真跑 exe —— 真跑由本地
 * 打包链与 CI 的 electron-build job 负责；这里钉住判据与安全形状）。
 *
 * 为什么需要这些断言
 * ------------------
 * 这工具的任务是「把**要发出去的 exe** 真跑一遍，看页面挂没挂上」——
 * 事故②里「闸门绿、装出来灰白屏」就是它要拦的类型。它最糟的失败形态：
 *   1. 判据错成「进程没崩」→ 灰白屏照样绿（必须看 #app 子节点）；
 *   2. 拿不到结果时静默放行（fail-open）；
 *   3. **碰了真实用户数据**（%APPDATA% 里存着主人的状态，绝不能动）；
 *   4. 跑完不收拾（进程树残留 → 下次构建/端口冲突）。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-packaged-runtime.js')
const CMD = fs.readFileSync(TOOL, 'utf8')

describe('verify-packaged-runtime：判据与安全形状', () => {
  it('测的对象是**打包产物 exe**（不是 dist）', () => {
    expect(CMD).toContain('release')
    expect(CMD).toContain('win-unpacked')
    expect(CMD).toContain('SmartSCADA.exe')
  })

  it('核心判据 = #app 挂载出子节点（>0）', () => {
    expect(CMD).toContain('getElementById("app")')
    expect(CMD).toMatch(/mounted\s*>\s*0/)
  })

  it('检查渲染层致命错误（事故②的签名）', () => {
    expect(CMD).toContain('Uncaught')
    expect(CMD).toContain('Class extends')
    expect(CMD).toContain('before initialization')
  })

  it('绝不碰真实用户数据：一次性 userData + --user-data-dir', () => {
    expect(CMD).toContain('--user-data-dir')
    expect(CMD).toContain('.vitest_cache')
    // 不得出现直接指向 %APPDATA%/SmartSCADA 的路径
    expect(CMD).not.toMatch(/APPDATA[\\/].*SmartSCADA/i)
  })

  it('fail-closed：拿不到目标/结果都判负', () => {
    const idx = CMD.indexOf('没等到调试端口')
    expect(idx).toBeGreaterThan(-1)
    expect(CMD.slice(idx, idx + 300)).toMatch(/return 1/)
  })

  it('无论成败都杀整棵进程树（taskkill /T /F，finally 里）', () => {
    expect(CMD).toContain("'taskkill'")
    expect(CMD).toContain("'/T'")
    expect(CMD).toContain("'/F'")
    expect(CMD).toContain('finally')
  })

  it('子进程剥掉 ELECTRON_RUN_AS_NODE（防工具自身被静默毒死）', () => {
    expect(CMD).toContain('delete childEnv.ELECTRON_RUN_AS_NODE')
  })
})
