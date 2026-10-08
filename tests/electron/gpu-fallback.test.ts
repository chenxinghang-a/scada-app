/**
 * Electron 启动韧性守卫：**GPU 进程起不来时必须还能开**。
 *
 * 为什么需要它
 * ------------
 * 症状（实测于 2026-10-09，round 197c）：
 *
 *     [ERROR:gpu_process_host.cc(982)] GPU process exited unexpectedly: exit_code=-1073741819
 *     [WARNING:gpu_process_host.cc(1416)] The GPU process has crashed 9 time(s)
 *     [FATAL:gpu_data_manager_impl_private.cc(423)] GPU process isn't usable. Goodbye.
 *
 * → Electron **直接 FATAL 退出**。用户看到的现象是
 *   **双击图标完全没反应**（进程秒退、无窗口、无提示、无日志）。
 *   而且**命令行 `--disable-gpu` 也压不住**（仍崩 9 次）。
 *
 * 这类失败在**受限会话 / 远程桌面 / 显卡驱动异常 / 虚拟机**上都会出现，
 * 而它**不报错**、只是「打不开」—— 用户完全无从判断。
 *
 * 做法：给一个**软渲染兜底开关**（环境变量 `SCADA_DISABLE_GPU=1`
 * 或 userData 下的 `disable-gpu.flag`），走 `app.disableHardwareAcceleration()`。
 *
 * ⚠️ 这条守卫最关键的一点是**位置**：
 * `app.disableHardwareAcceleration()` **必须在 `app.whenReady()` 之前调用**。
 * 一旦有人把它挪到 whenReady 里面（或之后），它会**静默失效** ——
 * 不报错、不警告，只是兜底再也不起作用。所以这里用**行号先后**把它钉住。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const MAIN = path.join(REPO, 'electron', 'main.js')

const read = (p: string) => fs.readFileSync(p, 'utf8')

/**
 * 剥掉注释。
 *
 * ⚠️ **必须先剥注释再定位** —— 这是本仓库第三次踩同一个坑：
 * 解释性注释里会原样出现被检查的代码片段（本例的注释里就写着
 * 「必须在 `app.whenReady()` **之前**调用」），于是基于文本的位置判定
 * 会**匹配到注释里那一次**，结论完全反掉。
 * （前两次：round 191 M4、round 192 的 `saveConfig` 判据。）
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('GPU 兜底开关（GPU 进程崩溃时仍能启动）', () => {
  const src = stripComments(read(MAIN))

  it('存在软渲染兜底开关（环境变量 + userData 标记文件）', () => {
    expect(/app\s*\.\s*disableHardwareAcceleration\s*\(/.test(src)).toBe(true)
    expect(src).toContain('SCADA_DISABLE_GPU')
    expect(src).toContain('disable-gpu.flag')
  })

  it('开关判定必须在 app.whenReady() 之前（否则静默失效）', () => {
    const gpuIdx = src.indexOf('disableHardwareAcceleration')
    const readyIdx = src.indexOf('app.whenReady(')
    expect(gpuIdx).toBeGreaterThan(-1)
    expect(readyIdx).toBeGreaterThan(-1)
    expect(
      gpuIdx,
      'app.disableHardwareAcceleration() 出现在 app.whenReady() 之后 —— ' +
        'Electron 会忽略它，兜底开关**静默失效**（不报错，只是再也不起作用）。',
    ).toBeLessThan(readyIdx)
  })

  it('开关判定必须早于单实例锁（锁不通过会 app.quit()，后面就没机会了）', () => {
    const gpuIdx = src.indexOf('disableHardwareAcceleration')
    const lockIdx = src.indexOf('requestSingleInstanceLock')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(gpuIdx).toBeLessThan(lockIdx)
  })

  it('兜底判定自身出错不许拖垮启动（块内必须有 try + catch）', () => {
    // ⚠️ 这条判据改过两版，两版都错，记录一下免得再犯：
    //   1. `lastIndexOf('try {', 调用点)` —— main.js **前面本来就有别的 try**
    //      （updater 的 require 块），把 try/catch 整个删掉它照样通过；
    //   2. 用「分节注释」界定块范围 —— 但本文件**已经剥掉注释**了，
    //      注释标记搜不到，于是对**正确**的代码也报红（假红）。
    // 最终：用**代码锚点**（`disable-gpu.flag` 这个唯一字面量）+ **距离约束**
    // 保证那个 try 是**紧邻**它的，而不是文件前面那个无关的 try。
    const flagIdx = src.indexOf('disable-gpu.flag')
    expect(flagIdx).toBeGreaterThan(-1)

    const tryIdx = src.lastIndexOf('try {', flagIdx)
    const catchIdx = src.indexOf('catch (', flagIdx)

    expect(tryIdx, '块里没有 try').toBeGreaterThan(-1)
    expect(catchIdx, '块里没有 catch').toBeGreaterThan(flagIdx)
    expect(
      flagIdx - tryIdx,
      '离它最近的那个 try 在很远处 —— 说明这个块自己的 try 被删了',
    ).toBeLessThan(400)
  })

  it('默认行为不变：没有开关时**不**禁用硬件加速', () => {
    // 判定必须是「环境变量 === '1'」或「标记文件存在」这种**条件式**，
    // 不能无条件调用 —— 那会让所有机器都掉到软渲染，白降性能
    const block = src.slice(
      src.indexOf('disableHardwareAcceleration') - 700,
      src.indexOf('disableHardwareAcceleration') + 200,
    )
    expect(/SCADA_DISABLE_GPU\s*===\s*'1'/.test(block)).toBe(true)
    expect(/existsSync\s*\(/.test(block)).toBe(true)
  })
})
