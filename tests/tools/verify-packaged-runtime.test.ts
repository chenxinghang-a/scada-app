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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
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

  it('包含仪表盘导航烟测（事故③：懒加载链的崩溃只在导航到 /dashboard 时爆）', () => {
    expect(CMD).toContain('probeDashboard')
    expect(CMD).toContain('#/dashboard')
    expect(CMD).toContain('仪表盘')
    expect(CMD).toContain("localStorage.setItem('auth_token'")
  })
})

/**
 * 产物目录清理（2026-10-11 发现的真实缺陷）
 * ----------------------------------------
 * 本探针真启动打包版，而后端把自己的模拟库 / WAL / `runtime.json` 写在 **exe 旁边**：
 * `release/win-unpacked/resources/backend/_internal/data/`。
 * 该目录**会被 electron-builder 打进安装包**（`extraResources` 的 filter 只排了
 * `*.log`/`logs`/`exports`/`__pycache__`/`*.pyc`，没排 `data/`），而构建链的顺序是
 * 「electron-builder → verify:packaged-runtime」—— 于是**下一次打包会带上上一次
 * 探针跑出来的垃圾**。实测：删掉该目录后跑一次探针，它会带着 4096 字节的
 * `scada_simulated.db` + WAL + `runtime.json` 原地重建。
 *
 * 注意 `--user-data-dir` 隔离**救不了**这一条：那是 Electron 的口径，管的是
 * 应用的 userData；后端是独立进程，`main.js` 用 `spawn(exe, [], {cwd: exeDir})`
 * 起它，后端 `paths.py` 取 `_BASE = exe_dir/_internal`。
 */
describe('verify-packaged-runtime：产物目录不得留运行期垃圾', () => {
  it('有清理机制（快照求差 + 复核），不是「按名字硬删」', () => {
    expect(CMD).toContain('snapshotTree')
    expect(CMD).toContain('cleanupCreated')
    expect(CMD).toContain('runtimeNewFiles')
    expect(CMD).toContain('cleanupUntilClean')
    // 只删「相对 before 新增」的 —— 按名字硬删会误伤产物自带内容
    expect(CMD).toMatch(/!before\.files\.has/)
    expect(CMD).toMatch(/!before\.dirs\.has/)
  })

  it('判据路径 = exe 旁的 resources/backend/_internal/data（不是 %APPDATA%，也不是 app 根）', () => {
    const mod = require(TOOL)
    const got = String(mod.runtimeDataDir('C:/app/release/win-unpacked/SmartSCADA.exe'))
    expect(got.replace(/\\/g, '/')).toBe(
      'C:/app/release/win-unpacked/resources/backend/_internal/data'
    )
  })

  it('清理不干净 → 判负（fail-closed，不留静默放行）', () => {
    const idx = CMD.indexOf('产物目录清理不干净')
    expect(idx).toBeGreaterThan(-1)
    expect(CMD.slice(idx, idx + 400)).toMatch(/process\.exitCode\s*=\s*1/)
  })

  it('跑前不存在的目录，跑完必须整个消失（不能只剩空壳）', () => {
    expect(CMD).toContain('dataExistedBefore')
    // 空快照下 cleanupUntilClean 会把根目录本身当「新建目录」删掉；
    // 另有一道 rmdir 兜底，防「删了又出现」的时序问题。
    expect(CMD).toMatch(/!dataExistedBefore[\s\S]{0,200}rmdirSync/)
  })

  it('--keep-artifacts 仅供排查，且默认不保留', () => {
    expect(CMD).toContain('keepArtifacts')
    expect(CMD).toMatch(/keepArtifacts\s*=\s*false/)
  })

  it('清理在 finally 里（失败路径也必须收拾）', () => {
    expect(CMD).toContain('killTree')
    const idx = CMD.lastIndexOf('finally')
    expect(idx).toBeGreaterThan(-1)
    expect(CMD.slice(idx)).toContain('cleanupUntilClean')
  })
})

/**
 * 行为级守卫：真建一棵临时树，调被测函数，断言结果。
 *
 * 为什么不能只看源码里有 `cleanupCreated` 这几个字：那样**变异存活**——
 * 把 `cleanupUntilClean(...)` 换成 `{ leftover: [] }` 后，文本断言照样全绿，
 * 而缺陷（垃圾留在产物目录里）一点没被拦住。2026-10-11 实测确认过这个失效模式。
 * 所以这一组必须**真调函数**。
 */
describe('verify-packaged-runtime：清理函数的行为（真建树真调）', () => {
  const mod = require(TOOL)
  const { snapshotTree, cleanupCreated, runtimeNewFiles, cleanupUntilClean } = mod as {
    snapshotTree: (r: string) => { files: Set<string>; dirs: Set<string> }
    cleanupCreated: (r: string, b: { files: Set<string>; dirs: Set<string> }) => string[]
    runtimeNewFiles: (r: string, b: { files: Set<string>; dirs: Set<string> }) => string[]
    cleanupUntilClean: (
      r: string,
      b: { files: Set<string>; dirs: Set<string> },
      a?: number,
      d?: number
    ) => Promise<{ failed: string[]; leftover: string[] }>
  }

  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vpr-clean-'))
  })
  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* */ }
  })

  it('只删本次新建的文件（预置文件必须原样留着）', async () => {
    fs.writeFileSync(path.join(tmp, 'preset.txt'), 'keep-me')
    const before = snapshotTree(tmp)
    // 模拟探针运行：后端在旁边写出库 / WAL / runtime.json
    fs.writeFileSync(path.join(tmp, 'scada_simulated.db'), 'x'.repeat(100))
    fs.writeFileSync(path.join(tmp, 'runtime.json'), '{}')
    fs.mkdirSync(path.join(tmp, 'diagnostics'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'diagnostics', 'd.log'), 'log')

    const { leftover } = await cleanupUntilClean(tmp, before)

    expect(leftover).toEqual([])
    expect(fs.existsSync(path.join(tmp, 'preset.txt'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'scada_simulated.db'))).toBe(false)
    expect(fs.existsSync(path.join(tmp, 'runtime.json'))).toBe(false)
    expect(fs.existsSync(path.join(tmp, 'diagnostics'))).toBe(false)
  }, 30000)

  it('空快照（跑前不存在）→ 跑完连新建的子目录一起清掉', async () => {
    const before = { files: new Set<string>(), dirs: new Set<string>() }
    fs.mkdirSync(path.join(tmp, 'queue'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'queue', 'q.json'), '[]')

    const { leftover } = await cleanupUntilClean(tmp, before)

    expect(leftover).toEqual([])
    expect(fs.existsSync(path.join(tmp, 'queue'))).toBe(false)
  }, 30000)

  it('复核判据看得见「本次新增」—— 不依赖 cleanup 的返回值', () => {
    const before = { files: new Set<string>(), dirs: new Set<string>() }
    fs.writeFileSync(path.join(tmp, 'still-there.db'), 'x')
    // runtimeNewFiles 是**独立复核**：只看磁盘现状与 before 的差集
    expect(runtimeNewFiles(tmp, before)).toEqual(['still-there.db'])
  })

  it('预置的**空目录**不算「本次新建」，不被删（发布配置将来可能随包带空目录）', async () => {
    fs.mkdirSync(path.join(tmp, 'preset-empty-dir'))
    const before = snapshotTree(tmp)
    fs.writeFileSync(path.join(tmp, 'new.db'), 'x')

    const { leftover } = await cleanupUntilClean(tmp, before)

    expect(leftover).toEqual([])
    expect(fs.existsSync(path.join(tmp, 'preset-empty-dir'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'new.db'))).toBe(false)
  }, 30000)
})
