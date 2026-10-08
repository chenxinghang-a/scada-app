/**
 * Electron IPC 契约守卫：**主进程 / preload / 渲染层类型声明 三者的通道名与方法名必须一致**。
 *
 * 为什么需要这条
 * --------------
 * 这三者是**手工维护的三份清单**，任何一处改了名字而别处没跟上，都会变成
 * **静默的运行时失败**：
 *
 *   * `ipcMain.handle('a')` 但 preload `invoke('b')`
 *     → 渲染层拿到的是 `Error: No handler registered for 'b'`，而**构建期/类型检查全绿**
 *   * `env.d.ts` 声明了 `foo()` 但 preload 没暴露
 *     → TS 认为 `electronAPI.foo()` 合法，运行期是 `undefined is not a function`
 *   * main 发 `webContents.send('x')` 但 preload 没 `ipcRenderer.on('x')`
 *     → 那条推送**永远没人收**（本项目的 round 176 就踩过同型：
 *       后端 status 变更只发了 ipc 回调、没人派发 DOM 事件，监听实际是死的）
 *
 * 本守卫把这三对关系都做成**双向**断言（多余和缺失都要报），
 * 期望值全部来自**对侧文件本身**，不写死字面量 ——
 * 否则就会出现 round 181 那种「守卫与被测同源 = 守卫是瞎的」。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const MAIN = path.join(REPO, 'electron', 'main.js')
const PRELOAD = path.join(REPO, 'electron', 'preload.js')
const ENV_D = path.join(REPO, 'src', 'env.d.ts')

const read = (p: string) => fs.readFileSync(p, 'utf8')

/** 抠出所有 `fn('literal')` 形式里的字面量。 */
function literals(src: string, pattern: RegExp): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(pattern)) out.add(m[1])
  return [...out].sort()
}

const mainSrc = read(MAIN)
const preloadSrc = read(PRELOAD)

/** 主进程**接收**的通道（渲染 → 主）。 */
const mainHandled = literals(mainSrc, /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)
/** 主进程**发出**的通道（主 → 渲染）。 */
const mainSent = literals(mainSrc, /(?:sendToRenderer|webContents\.send)\(\s*'([^']+)'/g)
/** preload **调用**的通道。 */
const preloadInvoked = literals(preloadSrc, /ipcRenderer\.invoke\(\s*'([^']+)'/g)
/** preload **监听**的通道。 */
const preloadListened = literals(preloadSrc, /ipcRenderer\.on\(\s*'([^']+)'/g)

/** preload 通过 contextBridge 暴露的键。 */
const exposedKeys = (() => {
  const block = preloadSrc.match(/exposeInMainWorld\(\s*'[^']+'\s*,\s*\{([\s\S]*?)\n\}\)/)?.[1] ?? ''
  return literals(block, /^\s{2}(\w+)\s*:/gm)
})()

/** env.d.ts 里 ElectronAPI 接口声明的方法名。 */
const declaredKeys = (() => {
  const block = read(ENV_D).match(/interface ElectronAPI \{([\s\S]*?)\n\}/)?.[1] ?? ''
  return literals(block, /^\s{2}(\w+)\s*[:(]/gm)
})()

const diff = (a: string[], b: string[]) => ({
  onlyInA: a.filter((x) => !b.includes(x)),
  onlyInB: b.filter((x) => !a.includes(x)),
})

describe('Electron IPC 契约（主进程 ↔ preload ↔ 类型声明）', () => {
  it('抠出来的清单非空（否则守卫本身失效，会变成"空断言假绿"）', () => {
    expect(mainHandled.length, 'main.js 里没抠到 ipcMain.handle/on').toBeGreaterThan(0)
    expect(mainSent.length, 'main.js 里没抠到 sendToRenderer/webContents.send').toBeGreaterThan(0)
    expect(preloadInvoked.length, 'preload.js 里没抠到 ipcRenderer.invoke').toBeGreaterThan(0)
    expect(preloadListened.length, 'preload.js 里没抠到 ipcRenderer.on').toBeGreaterThan(0)
    expect(exposedKeys.length, 'preload.js 里没抠到 exposeInMainWorld 的键').toBeGreaterThan(0)
    expect(declaredKeys.length, 'env.d.ts 里没抠到 ElectronAPI 的方法').toBeGreaterThan(0)
  })

  it('渲染 → 主：preload invoke 的通道，主进程必须都有 handler（双向）', () => {
    const d = diff(preloadInvoked, mainHandled)
    expect(
      { '主进程缺 handler': d.onlyInA, '主进程多出没被调用': d.onlyInB },
      'invoke 的通道与 ipcMain.handle/on 的通道不一致 —— 运行期会是 "No handler registered"',
    ).toEqual({ '主进程缺 handler': [], '主进程多出没被调用': [] })
  })

  it('主 → 渲染：主进程 send 的通道，preload 必须都有监听（双向）', () => {
    const d = diff(mainSent, preloadListened)
    expect(
      { 'preload 缺监听': d.onlyInA, 'preload 多出没被推送': d.onlyInB },
      'send 的通道与 preload 的 on 监听不一致 —— 那条推送会永远没人收',
    ).toEqual({ 'preload 缺监听': [], 'preload 多出没被推送': [] })
  })

  it('类型声明 ↔ preload 实际暴露面：双向一致（声明了没有 = 运行期 undefined）', () => {
    const d = diff(declaredKeys, exposedKeys)
    expect(
      { '声明了但没暴露': d.onlyInA, '暴露了但没声明': d.onlyInB },
      'env.d.ts 的 ElectronAPI 与 preload 的 exposeInMainWorld 不一致',
    ).toEqual({ '声明了但没暴露': [], '暴露了但没声明': [] })
  })

  it('main.js 不得静默吞掉 updater 的加载失败', () => {
    // 原先写的是 `try { … } catch {}` —— updater.js 加载失败时
    // setupUpdater/checkForUpdates 静默保持 null，自动更新就悄悄没了，
    // 而这正是本项目 round 161 花力气消除的那类「静默失效」。
    //
    // ⚠️ 这里必须取**整段**再断言，不能只看 `require('./updater')` 那一行：
    // 第一版就是这么写的，变异验证当场打脸 —— 把 `} catch (e) { console.error(…) }`
    // 换回 `} catch {}` 时，`catch {}` 落在**另一行**上，单行断言完全看不见。
    // （与 round 181 的「50 字符窗口正则」是同一类错误：守卫口径太窄 = 守卫是瞎的。）
    const start = mainSrc.indexOf('let setupUpdater')
    const end = mainSrc.indexOf('const { isFirstRun', start)
    const block = start >= 0 && end > start ? mainSrc.slice(start, end) : ''

    expect(block, '没取到 updater 加载那一段，守卫失效').toContain("require('./updater')")
    expect(block, 'updater 加载失败被 catch{} 静默吞掉').not.toMatch(/catch\s*\{\s*\}/)
    expect(block, 'updater 加载失败必须打印原因（否则是静默失效）').toMatch(
      /catch\s*\(\s*\w+\s*\)\s*\{[\s\S]*console\.error/,
    )
  })
})
