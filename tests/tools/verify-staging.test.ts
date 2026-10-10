import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

/**
 * `tools/verify-staging.js` 的行为契约（round 208 加固）。
 *
 * 本轮修的缺陷
 * ------------
 * 这道闸门原先**只查 mtime**：断言「暂存产物 mtime 晚于 HEAD 提交时间」。
 * 而 `cp -r` / `robocopy` 会把 mtime **刷新成复制那一刻** ——
 * 于是一份**陈旧后端**复制进 `backend/` 就能满足「mtime 晚于 HEAD」而**过闸门**。
 *
 * 实测（2026-10-10，本机真实状态）：
 *   * `package.json` = `1.3.1081`，`backend/_internal/VERSION` = **`1.3.1079`**；
 *   * 暂存 exe mtime = 11:58:57，HEAD 提交时间 = 11:58:02 —— 只差 **55 秒**，闸门放行；
 *   * 打出来的安装包是「前端 1.3.1081 + 后端 1.3.1079」，
 *     `/api/health/status` 自报旧版本而 UI 是新版本。
 *
 * 加固后：**暂存后端自报的 `_internal/VERSION` 必须等于本仓库 `package.json` 的版本**。
 *
 * 夹具约定（沿用本目录既有做法）
 * ------------------------------
 * * 夹具放仓库内 `.vitest_cache/`（已 gitignore），**不做任何删除**（环境有批量删除保护）；
 * * 用**异步 `spawn`** 起被测脚本 —— 本机 node 里所有**同步** spawn 一律 `EBUSY`
 *   （`spawnSync` / `execSync` / `execFileSync`，连 `cmd.exe` 都起不来）；
 * * 每条负向用例都断言**失败原因文本**，不只断言退出码 ——
 *   否则「失败在别的地方」会互相掩护（skill `ci-gate-hardening` 守卫 4）。
 */

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-staging.js')
const FIXTURE_ROOT = path.join(REPO, '.vitest_cache', 'verify-staging-fixtures', String(process.pid))

/** 本仓库版本号 —— 闸门的参照物（工具自己也是从 package.json 读的）。 */
const REPO_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'),
).version

function run(dir: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, '--dir', dir])
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** 带额外环境变量跑闸门（用于把后端仓库落点指到夹具上）。 */
function runWithEnv(dir: string, extraEnv: Record<string, string>):
Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, '--dir', dir],
                        { env: { ...process.env, ...extraEnv } })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** 以模块方式加载闸门（`tools/` 不是包，用 createRequire 取 CommonJS 导出）。 */
const mod = createRequire(import.meta.url)(TOOL) as {
  backendRepoCandidates: () => string[]
  backendHeadTime: () => { time: number | null; where: string | null }
  assessStaging: (dir: string, headTime?: number | null) => Record<string, unknown>
}

/** 在**指定路径**造一个暂存目录夹具（需要显式控制位置时用）。 */
function makeStagingAt(dir: string, version: string | null, mtime?: Date): void {
  fs.mkdirSync(path.join(dir, '_internal'), { recursive: true })
  const exe = path.join(dir, 'scada-backend.exe')
  fs.writeFileSync(exe, 'fake-exe')
  if (mtime) fs.utimesSync(exe, mtime, mtime)
  if (version !== null) {
    fs.writeFileSync(path.join(dir, '_internal', 'VERSION'), version, 'utf8')
  }
}

interface FixtureOpts {
  version?: string | null   // null = 不写 _internal/VERSION
  mtime?: Date              // 不传 = 现在（新鲜）
  withExe?: boolean
}

/** 造一个暂存目录夹具。 */
function makeStaging(name: string, opts: FixtureOpts = {}): string {
  const dir = path.join(FIXTURE_ROOT, name)
  fs.mkdirSync(path.join(dir, '_internal'), { recursive: true })
  if (opts.withExe !== false) {
    const exe = path.join(dir, 'scada-backend.exe')
    fs.writeFileSync(exe, 'fake-exe')
    if (opts.mtime) fs.utimesSync(exe, opts.mtime, opts.mtime)
  }
  if (opts.version !== null) {
    fs.writeFileSync(path.join(dir, '_internal', 'VERSION'), opts.version ?? REPO_VERSION, 'utf8')
  }
  return dir
}

beforeAll(() => {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
})

describe('tools/verify-staging.js 暂存闸门', () => {
  describe('正向对照（没有它，所有负向用例都可能因为「什么都没测到」而假绿）', () => {
    it('新鲜 mtime + 版本一致 → 通过', async () => {
      const dir = makeStaging('ok')
      const r = await run(dir)
      expect(r.out).toContain('版本一致')
      expect(r.code).toBe(0)
    })

    it('通过时会把版本号打出来（便于在 CI 日志里核对）', async () => {
      const dir = makeStaging('ok-echo')
      const r = await run(dir)
      expect(r.out).toContain(REPO_VERSION)
    })
  })

  describe('负向：本轮修的缺陷 —— **mtime 新鲜但版本是旧的**', () => {
    it('★ 回归：cp -r 刷新过 mtime 的陈旧后端必须被拦下', async () => {
      // 这正是真实缺陷的形态：mtime 是刚才（复制那一刻），内容却是旧版本。
      const dir = makeStaging('stale-but-fresh-mtime', { version: '1.3.1079', mtime: new Date() })
      const r = await run(dir)
      expect(r.code).toBe(1)
      // 守卫 4：断言「失败在正确的地方」
      expect(r.out).toContain('版本与本仓库**不一致**')
      expect(r.out).toContain('1.3.1079')
      expect(r.out).toContain(REPO_VERSION)
      // 并说明为什么 mtime 判据挡不住
      expect(r.out).toContain('mtime')
    })

    it('版本不一致时不能只说「失败」，要说清两边分别是多少', async () => {
      const dir = makeStaging('mismatch', { version: '0.0.1-other' })
      const r = await run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('暂存 = 0.0.1-other')
      expect(r.out).toContain(`本仓库 package.json = ${REPO_VERSION}`)
    })
  })

  describe('负向：其余失败路径各有各的原因（守卫 4）', () => {
    it('暂存产物缺 _internal/VERSION → 判负（fail-closed，不跳过）', async () => {
      const dir = makeStaging('no-version', { version: null })
      const r = await run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('读不到')
      expect(r.out).toContain('VERSION')
    })

    it('暂存目录里没有 exe → 判负，并给出怎么暂存', async () => {
      const dir = makeStaging('no-exe', { withExe: false })
      const r = await run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('暂存目录里没有')
      expect(r.out).toContain('robocopy')
    })

    it('mtime 早于后端仓库 HEAD → 判负（新鲜度判据保留）', async () => {
      // ⚠️ 必须**自带**后端仓库夹具，不能依赖环境里恰好有后端仓库 ——
      //    第一版就是依赖了 `../industrial_scada` 之类，
      //    **本机绿、CI 红**（前端 CI 的 build-and-test job 里没有后端 checkout：
      //    后端只在 electron-build job 里被 clone 成 backend-src）→
      //    探测返回 null → 新鲜度判据降级为「不判」→ 这条本该判负的用例变绿 → CI 红。
      const root = path.join(FIXTURE_ROOT, 'stale-vs-be')
      const futureEpoch = Math.floor(Date.now() / 1000) + 86400   // 明天：比夹具新
      if (!(await makeFakeBackendRepo(path.join(root, 'backend-src'), futureEpoch))) {
        throw new Error('造不出假后端仓库（git 不可用）—— 这条用例失去判别力')
      }
      const dir = path.join(root, 'staging')
      makeStagingAt(dir, REPO_VERSION, new Date('2020-01-01T00:00:00Z'))

      const r = await runWithEnv(dir, { SCADA_BACKEND_REPO: path.join(root, 'backend-src') })
      expect(r.code).toBe(1)
      // 守卫 4：断言**原因文本**，而且断言它落在「后端仓库」这条路径上
      // （判据①的参照物 2026-10-10 已从「前端 HEAD」改成「后端仓库 HEAD」）
      expect(r.out).toContain('比**后端仓库**')
      expect(r.out).toContain('HEAD 提交时间还旧')
    })

    it('探测不到后端仓库 → 新鲜度判据**降级**，但版本一致性判据仍生效', async () => {
      // 这是「静默降级」那条口径的守卫：降级可以，但 ② 不能跟着一起失效。
      const dir = makeStaging('degrade', { version: '0.0.1-wrong' })
      const r = await runWithEnv(dir, { SCADA_BACKEND_REPO: path.join(FIXTURE_ROOT, 'nope') })
      // ① 降级（不判新鲜度）→ 不会因为 mtime 判负；
      // ② 仍然生效 → 版本不一致照样判负。
      expect(r.code).toBe(1)
      expect(r.out).toContain('版本与本仓库**不一致**')
    })
  })
})

// ---------------------------------------------------------------------------
// 判据①的参照物：**后端仓库**的 HEAD，不是前端仓库的 HEAD
// ---------------------------------------------------------------------------

/**
 * 回归背景（wb 在 2026-10-10 报的**假阳性**）：
 *   他在前端提交（HEAD 17:42）**之前**，我用后端源码重建了后端产物（mtime 17:35）
 *   → 旧的判据①（拿**前端** HEAD 去比后端产物 mtime）判红。
 *   但「**前端提交晚于后端构建**」是完全合法的场景 ——
 *   后端产物是不是「后端当前源码」的产物，跟前端什么时候提交**无关**。
 *
 * 判别性：下面这条用例造一个**HEAD 很旧**的假后端仓库，
 * 而夹具产物的 mtime 是「现在」→ **必须通过**。
 * 旧实现会拿前端 HEAD（一般比这个旧时间新）去比 → 判红 → 用例失败。
 */
function runCmd(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }):
Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** 造一个 HEAD 提交时间被钉在 `epochSec` 的假 git 仓库。 */
async function makeFakeBackendRepo(dir: string, epochSec: number): Promise<boolean> {
  fs.mkdirSync(dir, { recursive: true })
  const stamp = `${epochSec} +0000`
  const env = { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }
  const init = await runCmd('git', ['init', '-q'], { cwd: dir, env })
  if (init.code !== 0) return false
  const commit = await runCmd(
    'git', ['-c', 'user.email=t@t', '-c', 'user.name=t',
            'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: dir, env })
  return commit.code === 0
}

describe('判据①的参照物是后端仓库，不是前端仓库', () => {
  it('候选落点包含本机并列布局与 CI 的 backend-src', () => {
    const cands = (mod as any).backendRepoCandidates()
    expect(cands.some((c: string) => c.includes('industrial_scada'))).toBe(true)
    expect(cands).toContain('backend-src')
  })

  it('★ 回归：后端 HEAD 旧、前端 HEAD 新 → 仍然通过（wb 报的假阳性）', async () => {
    const root = path.join(FIXTURE_ROOT, 'be-old')
    // 2020-01-01：比任何「现在的」夹具 mtime 都旧
    const oldEpoch = 1577836800
    const okRepo = await makeFakeBackendRepo(path.join(root, 'backend-src'), oldEpoch)
    if (!okRepo) {
      // 造不出假仓库（环境无 git）→ 显式失败，不要静默跳过
      throw new Error('造不出假后端仓库（git 不可用）—— 这条回归用例失去了判别力')
    }
    const staging = path.join(root, 'staging')

    // ⚠️ 夹具 mtime 必须**卡在两个参照物之间**，否则这条用例没有判别力：
    //    第一版用的是 `new Date()`（= 现在），而前端 HEAD 就在刚刚提交 →
    //    产物比前端 HEAD 还新 → **两种参照物都通过** → 变异「退回前端 HEAD」**没被抓住**
    //    （变异台实测）。改成「**前端 HEAD − 1 秒**」：
    //      · 新逻辑（参照物 = 假后端 HEAD 2020）→ 产物更新 → **通过** ✓
    //      · 旧逻辑（参照物 = 前端 HEAD）      → 产物更旧 → **判负** → 用例变红 ✓
    //    这样「参照物是谁」就真的被区分开了，而且不依赖机器上的具体时刻。
    const feHead = (mod as any).headCommitTime(REPO) as number | null
    if (!feHead) throw new Error('读不到前端仓库 HEAD —— 这条回归用例失去判别力')
    makeStagingAt(staging, REPO_VERSION, new Date((feHead - 1) * 1000))

    const r = await runWithEnv(staging, { SCADA_BACKEND_REPO: path.join(root, 'backend-src') })
    expect(r.code).toBe(0)
    expect(r.out).toContain('版本一致')
  })

  it('后端 HEAD 比产物新 → 判负（新鲜度判据仍然有效）', async () => {
    const root = path.join(FIXTURE_ROOT, 'be-new')
    const futureEpoch = Math.floor(Date.now() / 1000) + 86400   // 明天
    const okRepo = await makeFakeBackendRepo(path.join(root, 'backend-src'), futureEpoch)
    if (!okRepo) throw new Error('造不出假后端仓库（git 不可用）')

    const staging = path.join(root, 'staging')
    makeStagingAt(staging, REPO_VERSION, new Date())

    const r = await runWithEnv(staging, { SCADA_BACKEND_REPO: path.join(root, 'backend-src') })
    expect(r.code).toBe(1)
    // 守卫 4：断言失败原因落在**正确的那条路径**上
    expect(r.out).toContain('比**后端仓库**')
    expect(r.out).toContain('不可能是后端当前源码的产物')
  })
})
