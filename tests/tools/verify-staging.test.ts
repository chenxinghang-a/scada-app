import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
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

    it('mtime 早于 HEAD 提交时间 → 仍按「陈旧」判负（老判据保留）', async () => {
      const dir = makeStaging('stale-mtime', { mtime: new Date('2020-01-01T00:00:00Z') })
      const r = await run(dir)
      expect(r.code).toBe(1)
      expect(r.out).toContain('比 HEAD 提交时间还旧')
    })
  })
})
