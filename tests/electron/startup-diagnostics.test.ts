/**
 * Electron 启动**可诊断性**守卫（round 206）。
 *
 * 为什么需要它
 * ------------
 * `electron/main.js` 顶部的症状说明里写着：双击图标**完全没反应**
 * （进程秒退、无窗口、无提示、**无日志**）。
 * round 197c 只修了「打不开」（自愈降级），**没修「打不开时什么证据都不留」**。
 * 于是失败时的状态是：
 *
 *   * 用户看到的是「双击没反应」；
 *   * 排查的人手上**一个字节的证据都没有** —— 只能反复试。
 *
 * 而且 `update.log` 帮不上忙：它每行都是「自动更新未启用」，
 * 只能证明进程起过，**证明不了窗口有没有建出来**。
 *
 * 更具体的一处：`createWindow()` 此前是**裸调用**，
 * `new BrowserWindow()` 抛错时整条 `whenReady` 链以 unhandled rejection 结束 ——
 * 进程退出、无窗口、**不弹窗、不写日志**。
 *
 * 本文件钉住两件事：
 *   1. **静态位置**：诊断日志必须在 `app.whenReady()` **之前**写第一行
 *      （否则 GPU 直接 FATAL 时仍然没有痕迹）；
 *      `createWindow()` 必须在 try/catch 里；`whenReady` 链必须有 `.catch`。
 *   2. **真跑**：用一个假的 `electron` 模块把 `main.js` 真加载一遍，
 *      断言 `<userData>/startup.log` 里**确实**多出了带版本号与兜底原因的一行。
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

const REPO = process.cwd()
const MAIN = path.join(REPO, 'electron', 'main.js')

const read = (p: string) => fs.readFileSync(p, 'utf8')

/**
 * 剥掉注释再定位。
 * ⚠️ 本仓库**第三次**踩同一个坑：解释性注释里会原样出现被检查的代码片段，
 * 基于文本的判定会匹配到注释里那一次，结论完全反掉。
 * （round 191 M4、round 192 的 `saveConfig` 判据、round 197 的 GPU 开关位置。）
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SRC = read(MAIN)
const CODE = stripComments(SRC)

// ---------------------------------------------------------------------------
// 静态位置（最容易被人「顺手挪一下」而静默失效的部分）
// ---------------------------------------------------------------------------

describe('诊断日志的静态位置', () => {
  it('第一行 boot 日志写在 app.whenReady() 之前', () => {
    const boot = CODE.indexOf("writeStartupLog('boot')")
    const ready = CODE.indexOf('app.whenReady()')
    expect(boot).toBeGreaterThan(-1)
    expect(ready).toBeGreaterThan(-1)
    expect(boot).toBeLessThan(ready)
  })

  it('boot 日志写在 GPU 兜底判定之后（否则记不到兜底原因）', () => {
    const fallback = CODE.indexOf('const gpuFallbackReason')
    const boot = CODE.indexOf("writeStartupLog('boot')")
    expect(fallback).toBeGreaterThan(-1)
    expect(fallback).toBeLessThan(boot)
  })

  it('createWindow() 在 whenReady 里被 try/catch 包住', () => {
    const readyBlock = CODE.slice(CODE.indexOf('app.whenReady()'))
    const tryIdx = readyBlock.indexOf('try {')
    const callIdx = readyBlock.indexOf('createWindow()')
    const catchIdx = readyBlock.indexOf('} catch (err) {')
    expect(tryIdx).toBeGreaterThan(-1)
    expect(callIdx).toBeGreaterThan(tryIdx)
    expect(catchIdx).toBeGreaterThan(callIdx)
    expect(readyBlock.slice(catchIdx, catchIdx + 300)).toContain("writeStartupLog('window-failed'")
  })

  it('whenReady 链有 .catch —— 不留 unhandled rejection', () => {
    expect(CODE).toMatch(/\}\)\.catch\(/)
    expect(CODE).toContain("writeStartupLog('when-ready-failed'")
  })

  it('建窗口失败会弹窗（不再纯静默）', () => {
    expect(CODE).toContain('function showWindowFailureDialog')
    // ⚠️ 断言必须**限定在函数体内**：`SCADA_DISABLE_GPU` 在文件里还出现在
    // GPU 兜底判定那一处，全局 `toContain` 会被它喂饱 ——
    // 变异验证时实测到过（把弹窗里的兜底指引删掉，全局断言仍然通过）。
    const fn = CODE.slice(CODE.indexOf('function showWindowFailureDialog'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toContain('dialog.showErrorBox')
    // 弹窗必须告诉用户三件事：原因、日志在哪、两种手动兜底方式
    expect(body).toContain('STARTUP_LOG')
    expect(body).toContain('SCADA_DISABLE_GPU')
    expect(body).toContain('disable-gpu.flag')
  })

  it('日志写入函数自己绝不抛（诊断把启动搞挂是最糟的结果）', () => {
    const fn = CODE.slice(CODE.indexOf('function writeStartupLog'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toContain('try {')
    expect(body).toContain('catch (e)')
    // 不许出现 rethrow
    expect(body).not.toMatch(/catch \(e\) \{\s*throw/)
  })

  it('日志有大小上限（不能无限增长）', () => {
    expect(CODE).toContain('STARTUP_LOG_MAX_BYTES')
    const fn = CODE.slice(CODE.indexOf('function writeStartupLog'))
    expect(fn).toContain('STARTUP_LOG_MAX_BYTES')
  })
})

// ---------------------------------------------------------------------------
// 真跑：用假的 electron 模块加载 main.js，看 startup.log 是不是真的多了一行
// ---------------------------------------------------------------------------

interface Harness {
  calls: { switches: string[]; disabledHW: boolean; quit: boolean; dialogs: string[] }
  logPath: string
  lines: () => any[]
}

let tmpDirs: string[] = []

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true })
  tmpDirs = []
})

function loadMain(opts: { markerAgeMs?: number | null; userData?: string } = {}): Harness {
  const userData = opts.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'scada-startup-'))
  if (!opts.userData) tmpDirs.push(userData)

  // 预置「上次启动没走完」的标记 → 这次应当走兜底
  if (opts.markerAgeMs !== null && opts.markerAgeMs !== undefined) {
    fs.writeFileSync(
      path.join(userData, 'launch-attempt.json'),
      JSON.stringify({ at: Date.now() - opts.markerAgeMs, pid: 1, fallback: null })
    )
  }

  const calls = { switches: [] as string[], disabledHW: false, quit: false, dialogs: [] as string[] }

  const fakeApp = {
    isPackaged: true,
    getPath: () => userData,
    getVersion: () => '9.9.9-test',
    requestSingleInstanceLock: () => true,
    quit: () => { calls.quit = true },
    on: () => {},
    // **永不 resolve** —— 只跑模块级代码，不真的去 spawn 后端 / 建托盘。
    whenReady: () => new Promise(() => {}),
    commandLine: { appendSwitch: (s: string) => { calls.switches.push(s) } },
    disableHardwareAcceleration: () => { calls.disabledHW = true },
  }
  const fakeElectron = {
    app: fakeApp,
    BrowserWindow: class {},
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) },
    ipcMain: { handle: () => {} },
    dialog: { showErrorBox: (t: string) => { calls.dialogs.push(String(t)) } },
    session: { defaultSession: {} },
  }

  const mod = Module as unknown as { _load: (...a: any[]) => any }
  const orig = mod._load
  mod._load = function (request: string) {
    if (request === 'electron') return fakeElectron
    // eslint-disable-next-line prefer-rest-params
    return orig.apply(this, arguments as unknown as any[])
  }
  try {
    delete require.cache[require.resolve(MAIN)]
    require(MAIN)
  } finally {
    mod._load = orig
  }

  const logPath = path.join(userData, 'startup.log')
  return {
    calls,
    logPath,
    lines: () => (fs.existsSync(logPath)
      ? read(logPath).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []),
  }
}

describe('startup.log 真的会被写出来', () => {
  it('加载 main.js 就写下一行 boot（含版本号与是否打包）', () => {
    const h = loadMain({ markerAgeMs: null })
    const lines = h.lines()
    expect(lines.length).toBeGreaterThan(0)
    const boot = lines.find((l) => l.phase === 'boot')
    expect(boot, '没有 boot 行 —— 诊断日志没生效').toBeTruthy()
    expect(boot.version).toBe('9.9.9-test')
    expect(boot.packaged).toBe(true)
    expect(typeof boot.at).toBe('string')
    expect(boot.gpuFallback).toBeNull()
  })

  it('上次启动崩过 → boot 行记下兜底原因，并且真的加了开关', () => {
    const h = loadMain({ markerAgeMs: 60_000 })
    const boot = h.lines().find((l) => l.phase === 'boot')
    expect(boot.gpuFallback).toBe('auto-retry')
    expect(h.calls.switches).toContain('disable-gpu-sandbox')
    expect(h.calls.disabledHW).toBe(true)
  })

  it('标记过期（>24h）→ 不触发兜底', () => {
    const h = loadMain({ markerAgeMs: 25 * 60 * 60 * 1000 })
    const boot = h.lines().find((l) => l.phase === 'boot')
    expect(boot.gpuFallback).toBeNull()
    expect(h.calls.switches).not.toContain('disable-gpu-sandbox')
  })

  it('日志是追加的：连续两次加载 → 两行 boot', () => {
    const h = loadMain({ markerAgeMs: null })
    const before = h.lines().length
    // 复用同一个 userData → 第二行必须**追加**，不能覆盖
    loadMain({ markerAgeMs: null, userData: path.dirname(h.logPath) })
    expect(h.lines().length).toBe(before + 1)
  })

  it('日志超过上限会被截断重开（不会无限长）', () => {
    const h = loadMain({ markerAgeMs: null })
    // 塞到超过 256 KB
    fs.appendFileSync(h.logPath, 'x'.repeat(300 * 1024) + '\n')
    expect(fs.statSync(h.logPath).size).toBeGreaterThan(256 * 1024)
    loadMain({ markerAgeMs: null, userData: path.dirname(h.logPath) })
    const size = fs.statSync(h.logPath).size
    expect(size).toBeLessThan(256 * 1024)
    expect(h.lines().some((l) => l.phase === 'boot')).toBe(true)
  })
})
