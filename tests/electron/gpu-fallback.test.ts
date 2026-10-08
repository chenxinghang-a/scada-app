/**
 * Electron 启动韧性守卫：**GPU 进程起不来时必须还能开**。
 *
 * 为什么需要它
 * ------------
 * 症状（实测于 2026-10-09，用户报「双击打不开」）：
 *
 *     [ERROR:gpu_process_host.cc(982)] GPU process exited unexpectedly: exit_code=-1073741819
 *     [WARNING:gpu_process_host.cc(1416)] The GPU process has crashed 9 time(s)
 *     [FATAL:gpu_data_manager_impl_private.cc(423)] GPU process isn't usable. Goodbye.
 *
 * → Electron **直接 FATAL 退出**。用户看到的现象是
 *   **双击图标完全没反应**（进程秒退、无窗口、无提示、无日志）。
 *
 * 逐个开关实测的结果（同一台机器、同一个包）：
 *
 * | 做法                                | 结果 |
 * |-------------------------------------|------|
 * | 默认                                | ❌ GPU 崩 9 次后 FATAL |
 * | 命令行 `--disable-gpu`              | ❌ 仍崩 |
 * | `app.disableHardwareAcceleration()` | ❌ 仍崩（兜底执行了，但不够） |
 * | **`--disable-gpu-sandbox`**         | ✅ **起来了，2.5s 后端口 5000 监听** |
 * | `--no-sandbox` / `--in-process-gpu` | ✅ 同样有效 |
 *
 * 根因是 **GPU 进程的沙箱**在该环境里起不来。选最窄的 `--disable-gpu-sandbox`
 * （`--no-sandbox` 会把整个 Chromium 沙箱都关掉，范围过大）。
 *
 * 策略：**自愈式降级** —— 启动时写标记，启动成功后删掉；
 * 下次若发现标记还在（60 秒内的），说明上次崩在启动阶段 → 自动启用兜底。
 * 用户**不需要知道任何开关**。
 *
 * ⚠️ 本守卫最要紧的一点是**位置**：
 * `app.commandLine.appendSwitch` / `app.disableHardwareAcceleration()`
 * **必须在 `app.whenReady()` 之前调用**。一旦有人把它挪到 whenReady 里面（或之后），
 * 它会**静默失效** —— 不报错、不警告，只是兜底再也不起作用。所以用行号先后钉住。
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
 * ⚠️ **必须先剥注释再定位** —— 本仓库**第三次**踩同一个坑：
 * 解释性注释里会原样出现被检查的代码片段（本例注释里就写着
 * 「必须在 `app.whenReady()` **之前**调用」），于是基于文本的位置判定
 * 会**匹配到注释里那一次**，结论完全反掉。
 * （前两次：round 191 M4、round 192 的 `saveConfig` 判据。）
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('GPU / 沙箱兜底（GPU 进程崩溃时仍能启动）', () => {
  const src = stripComments(read(MAIN))

  it('兜底用的是**实测有效**的开关（disable-gpu-sandbox），不是只靠软渲染', () => {
    // 实测：只调 disableHardwareAcceleration() 仍会 GPU FATAL
    expect(src).toContain('disable-gpu-sandbox')
    expect(/app\s*\.\s*commandLine\s*\.\s*appendSwitch/.test(src)).toBe(true)
    expect(/app\s*\.\s*disableHardwareAcceleration\s*\(/.test(src)).toBe(true)
  })

  it('兜底开关必须在 app.whenReady() 之前（否则静默失效）', () => {
    const idx = src.indexOf('disable-gpu-sandbox')
    const readyIdx = src.indexOf('app.whenReady(')
    expect(idx).toBeGreaterThan(-1)
    expect(readyIdx).toBeGreaterThan(-1)
    expect(
      idx,
      'appendSwitch("disable-gpu-sandbox") 出现在 app.whenReady() 之后 —— ' +
        'Electron 会忽略它，兜底**静默失效**（不报错，只是再也不起作用）。',
    ).toBeLessThan(readyIdx)
  })

  it('兜底判定必须早于单实例锁（锁不通过会 app.quit()，后面就没机会了）', () => {
    const idx = src.indexOf('disable-gpu-sandbox')
    const lockIdx = src.indexOf('requestSingleInstanceLock')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(lockIdx)
  })

  it('有**自愈**机制：启动时写尝试标记，成功后清掉', () => {
    // 写标记
    expect(src).toContain('launch-attempt.json')
    expect(/fs\s*\.\s*writeFileSync\s*\(\s*LAUNCH_MARKER/.test(src)).toBe(true)

    // 清标记：必须找**调用点**而不是函数定义。
    // ⚠️ 这条判据也改过两次：
    //   1. 第一版 `indexOf('markLaunchSucceeded()')` 命中的是
    //      `function markLaunchSucceeded() {` 那行定义（在 whenReady 之前）→ 假红；
    //   2. 改成 setTimeout 之后调用点变成 `markLaunchSucceeded,`（**不带括号**），
    //      于是 lastIndexOf('markLaunchSucceeded()') 又只剩定义 → 假红。
    // 最终：找**不带括号**的标识符，且要求它出现在定义之后。
    const defIdx = src.indexOf('function markLaunchSucceeded')
    const callIdx = src.lastIndexOf('markLaunchSucceeded')
    const readyIdx = src.indexOf('app.whenReady(')

    expect(defIdx, '没有定义 markLaunchSucceeded').toBeGreaterThan(-1)
    expect(callIdx, '没有调用 markLaunchSucceeded').toBeGreaterThan(defIdx)
    expect(
      callIdx,
      '清标记必须发生在 whenReady 之后（窗口已建好才算成功）',
    ).toBeGreaterThan(readyIdx)

    // **必须是延时清**，不能一建好窗口就清。
    // 实测（dev 模式）：窗口都出来了、后端都 spawn 了，1 秒后 GPU 才连崩 9 次 FATAL ——
    // 立刻清标记会把这次崩溃记成「成功」，自愈永远不触发。
    expect(/LAUNCH_STABLE_MS/.test(src), '没有稳定运行时长常量').toBe(true)
    expect(
      /setTimeout\s*\(\s*markLaunchSucceeded\s*,\s*LAUNCH_STABLE_MS\s*\)/.test(src),
      '清标记不是延时调用 —— 窗口一建好就清，会把「建好窗口后才崩」记成成功',
    ).toBe(true)
  })

  it('自愈的回溯窗口足够宽（不会因用户隔久了再点就失效）', () => {
    // ⚠️ 第一版用的是 **60 秒**窗口 —— 实测发现这有个可靠性缺口：
    // 用户两次双击之间完全可能隔几分钟，那样第二次就不会降级，**自愈等于白做**。
    // 现在改成 24 小时，并且靠「正常退出时清标记」来区分「没走完流程」。
    expect(/LAUNCH_MARKER_STALE_MS/.test(src), '没有回溯窗口常量').toBe(true)
    expect(
      /LAUNCH_MARKER_STALE_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src),
      '回溯窗口不是 24 小时 —— 太窄会让自愈在用户隔久了再点时失效',
    ).toBe(true)
    // 比较方式必须用这个常量，不能写死一个数字
    expect(/Date\s*\.\s*now\s*\(\s*\)\s*-\s*prev\s*\.\s*at\s*<\s*LAUNCH_MARKER_STALE_MS/.test(src)).toBe(true)
  })

  it('⚠️ TDZ：窗口常量必须**声明在使用之前**', () => {
    // 踩过（2026-10-09）：第一版把 `const LAUNCH_MARKER_STALE_MS` 放在使用它的
    // 那段代码**下面** —— `const` 的暂时性死区会让启动直接抛 ReferenceError，
    // **比 GPU 崩溃还早**，整个应用根本起不来。
    // 判据：该标识符的**第一次出现**必须紧跟在 `const ` 之后。
    // （⚠️ 别拿 `indexOf('const LAUNCH_MARKER_STALE_MS')` 的位置去比 ——
    //   `const ` 本身有 6 个字符，位置会差 6，写成相等会假红。）
    const firstIdx = src.indexOf('LAUNCH_MARKER_STALE_MS')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(
      src.slice(firstIdx - 6, firstIdx),
      'LAUNCH_MARKER_STALE_MS 在声明之前就被引用了 —— const 的暂时性死区会抛 ' +
        'ReferenceError，应用直接起不来（比 GPU 崩溃更早）',
    ).toBe('const ')
  })

  it('正常退出会清掉标记（否则「标记还在」不能代表「没走完流程」）', () => {
    const quitIdx = src.indexOf("app.on('before-quit'")
    expect(quitIdx).toBeGreaterThan(-1)
    const quitBlock = src.slice(quitIdx, quitIdx + 400)
    expect(
      /markLaunchSucceeded\s*\(/.test(quitBlock),
      'before-quit 里没有清标记 —— 「标记还在」就可能是用户正常关窗留下的，' +
        '自愈会误判成崩溃',
    ).toBe(true)
  })

  it('默认行为不变：没有标记/开关时**不**降级', () => {
    const block = src.slice(
      src.indexOf('disable-gpu-sandbox') - 1200,
      src.indexOf('disable-gpu-sandbox') + 300,
    )
    // 必须是条件式：forcedFallback 或 prevLaunchCrashed
    expect(/if\s*\(\s*gpuFallbackReason\s*\)/.test(block)).toBe(true)
    expect(/SCADA_DISABLE_GPU\s*===\s*'1'/.test(block)).toBe(true)
    expect(/existsSync\s*\(/.test(block)).toBe(true)
  })

  it('兜底判定自身出错不许拖垮启动（块内必须有 try + catch）', () => {
    // ⚠️ 这条判据改过两版，两版都错，记录一下免得再犯：
    //   1. `lastIndexOf('try {', 调用点)` —— main.js **前面本来就有别的 try**
    //      （updater 的 require 块），把 try/catch 整个删掉它照样通过；
    //   2. 用「分节注释」界定块范围 —— 但本文件**已经剥掉注释**了，
    //      注释标记搜不到，于是对**正确**的代码也报红（假红）。
    // 最终：用**代码锚点**（`disable-gpu-sandbox` 这个唯一字面量）+ **距离约束**
    // 保证那个 try 是**紧邻**它的，而不是文件前面那个无关的 try。
    const anchor = src.indexOf('disable-gpu-sandbox')
    expect(anchor).toBeGreaterThan(-1)

    const tryIdx = src.lastIndexOf('try {', anchor)
    const catchIdx = src.indexOf('catch (', anchor)

    expect(tryIdx, '块里没有 try').toBeGreaterThan(-1)
    expect(catchIdx, '块里没有 catch').toBeGreaterThan(anchor)
    expect(
      anchor - tryIdx,
      '离它最近的那个 try 在很远处 —— 说明这个块自己的 try 被删了',
    ).toBeLessThan(1200)
  })
})
