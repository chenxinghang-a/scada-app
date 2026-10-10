import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * `tools/verify-version-coherence.js` 的行为契约（round 208 新增）。
 *
 * 为什么需要这道闸门
 * ------------------
 * `verify-staging.js` 管的是**源**（`backend/`），而用户装到机器上的是**产物**
 * （`release/win-unpacked/resources/**`）—— 两者之间隔着 electron-builder 的复制
 * 与 `extraResources` 过滤。源目录版本对了，产物照样可能是别的版本。
 *
 * 实测（2026-10-10，本机）：打出来的安装包是「前端 `1.3.1081` + 后端 `1.3.1079`」，
 * `/api/health/status` 自报 `1.3.1079` 而 UI 是 `1.3.1081`。
 *
 * 判据是 fail-closed 的：**读不到版本号也判负**（没有「跳过」分支）。
 *
 * 夹具：真造一个 asar（`@electron/asar` 的 `createPackage`），不 mock 读 asar 的环节。
 * 放仓库内 `.vitest_cache/`（已 gitignore），**不做任何删除**。
 */

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-version-coherence.js')
const FIXTURE_ROOT = path.join(REPO, '.vitest_cache', 'verify-version-fixtures', String(process.pid))

const REPO_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'),
).version

const require_ = createRequire(import.meta.url)
const asar = require_('@electron/asar') as {
  createPackage: (src: string, dest: string) => Promise<void>
}

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args])
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

interface PkgOpts {
  /** 产物里后端的 _internal/VERSION；null = 不写 */
  backendVersion?: string | null
  /** 产物里 asar 内 package.json 的 version；null = 不造 asar */
  asarVersion?: string | null
  /** 暂存源的 _internal/VERSION；null = 不写 */
  sourceVersion?: string | null
}

/**
 * 造一个「打包产物 + 暂存源」夹具。
 * @returns `{ packagedDir, sourceDir }`
 */
async function makePkg(name: string, opts: PkgOpts = {}): Promise<{ packagedDir: string; sourceDir: string }> {
  const root = path.join(FIXTURE_ROOT, name)
  const packagedDir = path.join(root, 'win-unpacked')
  const resources = path.join(packagedDir, 'resources')

  // 产物里的后端
  fs.mkdirSync(path.join(resources, 'backend', '_internal'), { recursive: true })
  if (opts.backendVersion !== null) {
    fs.writeFileSync(
      path.join(resources, 'backend', '_internal', 'VERSION'),
      opts.backendVersion ?? REPO_VERSION, 'utf8',
    )
  }

  // 产物里的前端（真造一个 asar）
  if (opts.asarVersion !== null) {
    const srcDir = path.join(root, 'asar-src')
    fs.mkdirSync(srcDir, { recursive: true })
    fs.writeFileSync(
      path.join(srcDir, 'package.json'),
      JSON.stringify({ name: 'smartscada', version: opts.asarVersion ?? REPO_VERSION }), 'utf8',
    )
    await asar.createPackage(srcDir, path.join(resources, 'app.asar'))
  }

  // 暂存源
  const sourceDir = path.join(root, 'backend')
  fs.mkdirSync(path.join(sourceDir, '_internal'), { recursive: true })
  if (opts.sourceVersion !== null) {
    fs.writeFileSync(
      path.join(sourceDir, '_internal', 'VERSION'),
      opts.sourceVersion ?? REPO_VERSION, 'utf8',
    )
  }

  return { packagedDir, sourceDir }
}

beforeAll(() => {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
})

describe('tools/verify-version-coherence.js 产物版本一致性闸门', () => {
  describe('正向对照', () => {
    it('产物前后端版本一致且等于 package.json → 通过', async () => {
      const { packagedDir, sourceDir } = await makePkg('ok')
      const r = await run(['--packaged', packagedDir, '--source', sourceDir, '--require-source'])
      expect(r.out).toContain('版本一致')
      expect(r.code).toBe(0)
    })

    it('不加 --require-source 时只验产物（暂存源可以不存在）', async () => {
      const { packagedDir } = await makePkg('ok-no-source', { sourceVersion: null })
      const r = await run(['--packaged', packagedDir, '--source', path.join(FIXTURE_ROOT, 'nope')])
      expect(r.code).toBe(0)
    })
  })

  describe('负向：每条失败路径各有各的原因（守卫 4）', () => {
    it('★ 回归：产物里后端是旧版本 → 判负，并指出是哪一处', async () => {
      const { packagedDir, sourceDir } = await makePkg('stale-backend', { backendVersion: '1.3.1079' })
      const r = await run(['--packaged', packagedDir, '--source', sourceDir])
      expect(r.code).toBe(1)
      expect(r.out).toContain('产物后端')
      expect(r.out).toContain('1.3.1079')
      expect(r.out).toContain(REPO_VERSION)
    })

    it('产物里前端（asar）是别的版本 → 判负', async () => {
      const { packagedDir, sourceDir } = await makePkg('stale-asar', { asarVersion: '9.9.9-x' })
      const r = await run(['--packaged', packagedDir, '--source', sourceDir])
      expect(r.code).toBe(1)
      expect(r.out).toContain('产物前端')
      expect(r.out).toContain('9.9.9-x')
    })

    it('产物里缺后端 VERSION → 判负（fail-closed，不跳过）', async () => {
      const { packagedDir, sourceDir } = await makePkg('no-backend-version', { backendVersion: null })
      const r = await run(['--packaged', packagedDir, '--source', sourceDir])
      expect(r.code).toBe(1)
      expect(r.out).toContain('读不到')
    })

    it('产物里缺 app.asar → 判负（读不到就是读不到）', async () => {
      const { packagedDir, sourceDir } = await makePkg('no-asar', { asarVersion: null })
      const r = await run(['--packaged', packagedDir, '--source', sourceDir])
      expect(r.code).toBe(1)
      expect(r.out).toContain('产物前端')
      expect(r.out).toContain('读不到')
    })

    it('--require-source 时暂存源版本不符 → 判负', async () => {
      const { packagedDir, sourceDir } = await makePkg('stale-source', { sourceVersion: '1.3.1000' })
      const r = await run(['--packaged', packagedDir, '--source', sourceDir, '--require-source'])
      expect(r.code).toBe(1)
      expect(r.out).toContain('暂存源')
      expect(r.out).toContain('1.3.1000')
    })

    it('用法错误（未知参数）→ 退出码 2，且不是静默通过', async () => {
      const r = await run(['--bogus'])
      expect(r.code).toBe(2)
      expect(r.out).toContain('未知参数')
    })
  })
})

// ---------------------------------------------------------------------------
// 接线守卫（skill `ci-gate-hardening` 守卫 2）
// ---------------------------------------------------------------------------

describe('接线：闸门必须真的被跑到，且在上传产物之前', () => {
  const CI = path.join(REPO, '.github', 'workflows', 'ci.yml')
  const PKG = path.join(REPO, 'package.json')

  /** 只保留可执行行 —— 注释里提到旧断言是允许的（注释往往正是在解释它为什么被换掉）。 */
  const executableLines = (text: string) =>
    text.split('\n').filter((ln) => !ln.trim().startsWith('#'))

  it('CI 里真的调用了版本一致性闸门', () => {
    const lines = executableLines(fs.readFileSync(CI, 'utf8'))
    expect(lines.some((ln) => ln.includes('node tools/verify-version-coherence.js'))).toBe(true)
  })

  it('CI 调用点在「Upload NSIS installer」之前（上传了坏产物再红就晚了）', () => {
    const lines = executableLines(fs.readFileSync(CI, 'utf8'))
    const gate = lines.findIndex((ln) => ln.includes('node tools/verify-version-coherence.js'))
    const upload = lines.findIndex((ln) => ln.includes('name: Upload NSIS installer'))
    expect(gate).toBeGreaterThanOrEqual(0)
    expect(upload).toBeGreaterThanOrEqual(0)
    expect(gate).toBeLessThan(upload)
  })

  it('该 step 没有 continue-on-error（否则闸门红了 job 还是绿的）', () => {
    const text = fs.readFileSync(CI, 'utf8')
    const idx = text.indexOf('Verify version coherence')
    expect(idx).toBeGreaterThanOrEqual(0)
    // 取到下一个 step 之前
    const nextStep = text.indexOf('\n      - name:', idx + 1)
    const block = text.slice(idx, nextStep === -1 ? undefined : nextStep)
    expect(block).not.toContain('continue-on-error')
  })

  it('本地打包链也走到它（npm run verify:packaged）', () => {
    const scripts = JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts as Record<string, string>
    expect(scripts['verify:packaged']).toContain('verify:version:packaged')
    expect(scripts['verify:version:packaged']).toContain('verify-version-coherence.js')
    // 且 electron:build 走 verify:packaged
    expect(scripts['electron:build']).toContain('verify:packaged')
  })

  it('暂存闸门仍在本地链上（不许被这次改动挤掉）', () => {
    const scripts = JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts as Record<string, string>
    expect(scripts['electron:build']).toContain('verify:staging')
    expect(scripts['verify:staging']).toContain('verify-staging.js')
  })
})
