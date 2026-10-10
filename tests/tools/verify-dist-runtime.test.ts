/**
 * `tools/verify-dist-runtime.js` 的结构守卫（不真跑 Electron —— 真跑由
 * CI 的 electron-build job 与本地打包链负责，这里只钉住它的**判据形状**）。
 *
 * 为什么需要这些断言
 * ------------------
 * 这个工具的使命是「看像素」：拦住 verify:dist / verify:asar / 全部单测都拦不住的
 * 白屏类缺陷（2026-10-09 实锤：chunk 循环依赖 → isFunction TDZ → #app 挂不上）。
 * 此类工具最糟的失败形态是**看起来在守、实际守不住**：
 *   1. 判据不是「页面挂载成功」而是「进程没崩」→ 白屏照样绿；
 *   2. 拿不到结果时静默放行（fail-open）→ 环境一坏就永远绿；
 *   3. 忘了剥 ELECTRON_RUN_AS_NODE → 工具自己变成无头 Node，什么都没测却 exited 0。
 * 所以逐条钉死。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-dist-runtime.js')
const CMD = fs.readFileSync(TOOL, 'utf8')

describe('verify-dist-runtime：判据形状', () => {
  it('核心判据是「#app 挂载出子节点」——不是「进程存活」', () => {
    expect(CMD).toContain('getElementById("app")')
    expect(CMD).toContain('children.length')
    expect(CMD).toMatch(/mounted\s*>\s*0/)
  })

  it('收集三类致命信号：未捕获异常 / 渲染崩溃 / 加载失败', () => {
    expect(CMD).toContain("'render-process-gone'")
    expect(CMD).toContain("'did-fail-load'")
    expect(CMD).toContain('Uncaught')
    expect(CMD).toContain('before initialization')
  })

  it('fail-closed：拿不到结果行必须 exit 1，不许静默放行', () => {
    const idx = CMD.indexOf('没拿到结果行')
    expect(idx).toBeGreaterThan(-1)
    // 该分支必须在 400 字符内 return 1（而不是 console.warn 后继续）
    expect(CMD.slice(idx, idx + 600)).toMatch(/return 1/)
  })

  it('子进程必须剥掉会把 Electron 变无头 Node 的环境变量', () => {
    expect(CMD).toContain('delete childEnv.ELECTRON_RUN_AS_NODE')
    expect(CMD).toContain('delete childEnv.NODE_OPTIONS')
  })

  it('兼容开关走命令行（受限环境里 appendSwitch 可能来不及）', () => {
    expect(CMD).toContain("'--no-sandbox'")
    expect(CMD).toContain("'--disable-gpu-sandbox'")
  })

  it('输出走文件重定向（Windows 上 Electron 的管道输出会丢，实测）', () => {
    expect(CMD).toContain('openSync(runLog')
    expect(CMD).toContain('readFileSync(runLog')
  })

  it('包含仪表盘导航烟测（事故③：懒加载链的崩溃只在导航到 /dashboard 时爆）', () => {
    expect(CMD).toContain('#/dashboard')
    expect(CMD).toContain('仪表盘')
    expect(CMD).toContain('VDR_DASH')
    // 假会话（路由守卫只看存在性与角色）+ 判定必须包含导航结果
    expect(CMD).toContain('auth_token')
    expect(CMD).toMatch(/dash\.ok/)
  })
})
