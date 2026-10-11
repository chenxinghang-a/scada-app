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
import { createRequire } from 'node:module'

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-packaged-runtime.js')
const CMD = fs.readFileSync(TOOL, 'utf8')

// ⚠️ 本文件是 **ESM**（用的是 `import`），ESM 里**没有**裸 `require`。
// 本机 vitest/Vite 会顺手 shim 掉，于是「本地全绿」；**CI runner 上不会** ——
// 这就是 `electron-build` job（windows-latest）在 `Unit tests` 步失败、
// 而 `build-and-test`（ubuntu-latest）全绿的那类差异。
// 与 `verify-backend-runtime.test.ts` 保持一致：用 createRequire 显式取。
const require_ = createRequire(import.meta.url)
// 需要 CommonJS 形态（工具本身是 CJS）—— 这里只用于行为级用例，故 any。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gate: any = require_(TOOL)

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
 * 该目录**会被 electron-builder 打进安装包**（`extraResources` 的 filter 原先只排了
 * `*.log`/`logs`/`exports`/`__pycache__`/`*.pyc`，没排 `data/`），而构建链的顺序是
 * 「electron-builder → verify:packaged-runtime」—— 于是**下一次打包会带上上一次
 * 探针跑出来的垃圾**。实测：删掉该目录后跑一次探针，它会带着 4096 字节的
 * `scada_simulated.db` + WAL + `runtime.json` 原地重建。
 *
 * 现在有**两道防线**（Bug 10 修复）：
 *   ① 本探针跑完把 `_internal/data/` 恢复到跑前状态（本文件的用例）；
 *   ② `package.json` 的 `extraResources.filter` 直接排掉 `!_internal/data/**`
 *      与 `!_internal/backups/**`（后者是二号机扫出的 `auto_backup` 落点，
 *      同一个 filter 缺口 —— 见「extraResources 过滤口径」那组用例）。
 *
 * ⚠️ 注意 `--user-data-dir` 隔离**救不了**这一条：那是 Electron 的口径，管的是
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
    const got = String(gate.runtimeDataDir('C:/app/release/win-unpacked/SmartSCADA.exe'))
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
  const { snapshotTree, cleanupCreated, runtimeNewFiles, cleanupUntilClean } = gate as {
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

/**
 * `extraResources` 过滤口径（第二道防线，2026-10-11 补）
 * --------------------------------------------------
 * Bug 10 的**根本原因**不是探针不清理，而是 filter **压根没排**运行期目录。
 * 探针清理（第一道防线）只在「闸门真被跑到」时生效；而 filter 是**打包器**的口径 ——
 * 哪怕有人在没跑闸门的情况下手工 `electron-builder`，这两条也拦得住。
 *
 * 为什么必须静态断言而不是只靠集成测试：
 * 真实的「带垃圾打包」要跑完整 electron-builder 才看得见（分钟级 + 需要 python 产物），
 * 在单测里跑不动；而 filter 的形状是**编译期常量**，静态断言足够且是 fail-fast。
 */
describe('extraResources 过滤口径（不得把运行期目录打进安装包）', () => {
  const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  const filter: string[] = PKG.build.extraResources[0].filter

  it('必须排掉 _internal/data（后端运行期库/WAL/runtime.json 的落点）', () => {
    // 判据要点：用**排除条目**判定，不能只看 `**/*` 里有没有这个词（那样恒真）。
    expect(
      filter.some((f) => f === '!_internal/data/**'),
      `extraResources.filter 没排 _internal/data/ —— 闸门跑出的运行期库会被打进安装包：\n${filter.join('\n')}`,
    ).toBe(true)
  })

  it('必须排掉 _internal/backups（auto_backup 的落点，同一个缺口）', () => {
    // 二号机扫出：AutoBackup 用 project_root=Path(__file__).parent.parent，
    // 冻结产物里就是 _internal/ → _internal/backups/ 正好落进 extraResources。
    expect(
      filter.some((f) => f === '!_internal/backups/**'),
      `extraResources.filter 没排 _internal/backups/：\n${filter.join('\n')}`,
    ).toBe(true)
  })

  it('保留 `**/*` 兜底（别为了排除把整个 backend 排空）', () => {
    expect(filter[0]).toBe('**/*')
  })

  it('先前的排除项不得被这次改动弄丢（回归守卫）', () => {
    for (const must of ['!**/*.log', '!logs/**', '!exports/**', '!**/__pycache__/**', '!**/*.pyc']) {
      expect(filter, `filter 丢了原有排除项 ${must}`).toContain(must)
    }
  })
})
