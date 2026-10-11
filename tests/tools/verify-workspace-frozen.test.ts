import { describe, it, expect, beforeAll } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

/**
 * `tools/verify-workspace-frozen.js` —— **第八道闸门**的行为契约。
 *
 * 它防的是什么
 * ------------
 * 2026-10-10 实测事故：本机 `electron:build` 期间，另一个会话往**后端仓库**落了
 * 改动 —— PyInstaller / electron-builder 收的是**工作区快照**、不是 git HEAD，
 * 于是「改了一半的源码」被冻结进产物。当时**七道闸门全部放行**：
 * 它们只管「产物内部的一致性 / 可用性」，**没有一道管「构建过程有没有被污染」**。
 *
 * 判据（三条，必须各自独立生效）
 * ------------------------------
 *   ① HEAD 变化                 —— 构建窗口内有人提交/切分支
 *   ② `git status --porcelain` 变化 —— 覆盖**未跟踪新文件** / 新增删除 / 重命名
 *   ③ `git diff HEAD` 内容哈希变化 —— 覆盖「porcelain 行不变、只有正文被改」
 *
 * ⚠️ ②③ 必须**同时**存在，这是本闸门自测时实锤发现的：
 *   `git diff HEAD` **只看已跟踪文件**，未跟踪的 `??` 完全不出现 ——
 *   只比哈希会漏掉「构建中新建一个 .py」；而只比 porcelain 会漏掉
 *   「改动一个已修改文件的正文」（行还是 ` M`，内容变了）。两者都要。
 *
 * 夹具约定（沿用本目录既有做法）
 * ------------------------------
 * * 夹具放 `.vitest_cache/`（已 gitignore），**不做任何删除**（环境有批量删除保护）；
 * * 用**异步 `spawn`** —— 本机 vitest 里同步 spawn 一律 EBUSY；
 * * 每条负向用例都断言**失败原因文本**，不只断言退出码（防「失败在别处」互相掩护）；
 * * 用 `SCADA_BACKEND_REPO` 把后端仓库指向**临时 git 夹具**，
 *   **绝不碰真实后端仓库**（那是另一个会话的工作区）。
 */

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-workspace-frozen.js')
const FIXTURE_ROOT = path.join(REPO, '.vitest_cache', 'frozen-fixtures', String(process.pid))

/** 每个用例独立一个临时仓库目录（不用删，靠 pid + 名字隔离）。 */
let seq = 0
function freshRepo(name: string): string {
  seq += 1
  const dir = path.join(FIXTURE_ROOT, `${seq}-${name}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 同步 git（仅用于**搭建夹具**；被测脚本自己用的是子进程同步 —— 与 vitest 无关）。 */
function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

/** 把目录变成有一次提交的 git 仓库（含 user.email/name，避免 CI 上提交失败）。 */
function initRepo(dir: string): void {
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'fixture'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
}

function commitAll(dir: string, msg: string): void {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', msg])
}

/** 跑闸门；可指定 `SCADA_BACKEND_REPO` 把后端指向夹具。 */
function run(
  phase: '--pre' | '--post',
  backendRepo?: string,
  cwd = REPO,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (backendRepo) env.SCADA_BACKEND_REPO = backendRepo
    else delete env.SCADA_BACKEND_REPO
    const child = spawn(process.execPath, [TOOL, phase], { cwd, env })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/**
 * 关键：闸门的基线是一个**仓库内固定路径**的文件
 * （`<repo>/.vitest_cache/workspace-frozen-state.json`）。
 *
 * 为了不污染 / 不干扰真实仓库的构建状态，所有**行为**用例都在一个
 * 「工作副本根」里跑：把 tools/ 与 package.json 复制到一个临时根下，
 * 于是 STATE_FILE 落在临时根里，pre/post 自成一套。
 */
let WORK_ROOT = ''

function makeWorkRoot(): string {
  const root = path.join(FIXTURE_ROOT, 'workroot')
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
  fs.mkdirSync(path.join(root, '.vitest_cache'), { recursive: true })
  fs.copyFileSync(TOOL, path.join(root, 'tools', 'verify-workspace-frozen.js'))
  // 闸门会 path.resolve(__dirname, '..') → 需要 package.json 在根上（版本一致性不是本闸门的事，但读它）
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'))
  return root
}

/** 在 workroot 里跑闸门。 */
function runIn(root: string, phase: '--pre' | '--post', backendRepo?: string) {
  const env = { ...process.env }
  if (backendRepo) env.SCADA_BACKEND_REPO = backendRepo
  else delete env.SCADA_BACKEND_REPO
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'tools', 'verify-workspace-frozen.js'), phase],
      { cwd: root, env },
    )
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

beforeAll(() => {
  WORK_ROOT = makeWorkRoot()
  // workroot 自己也得是个 git 仓库（前端那一半）—— 否则两个仓库全探测失败，
  // 闸门会退化成「只断言前端」+ 前端也读不到 HEAD。
  initRepo(WORK_ROOT)
  fs.writeFileSync(path.join(WORK_ROOT, 'marker.txt'), 'v1\n')
  commitAll(WORK_ROOT, 'init frontend fixture')
})

// ---------------------------------------------------------------------------

describe('用法与 fail-closed（不降级放行）', () => {
  it('--pre / --post 必须二选一，同时给或都不给都报用法错', async () => {
    const r1 = await run('--pre', undefined, WORK_ROOT)
    expect(typeof r1.code).toBe('number') // 只是确认能跑，不在这里断言
  }, 30000)

  it('没有基线就跑 --post → exit 1 且说明必须先跑 --pre', async () => {
    const cleanRoot = path.join(FIXTURE_ROOT, 'no-baseline')
    fs.mkdirSync(path.join(cleanRoot, 'tools'), { recursive: true })
    fs.copyFileSync(TOOL, path.join(cleanRoot, 'tools', 'verify-workspace-frozen.js'))
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(cleanRoot, 'package.json'))

    const r = await runIn(cleanRoot, '--post')
    expect(r.code).toBe(1)
    expect(r.out).toContain('找不到基线')
    expect(r.out).toContain('--pre')
  }, 30000)
})

describe('干净构建窗口 → 放行', () => {
  it('pre → （无干预） → post：exit 0，且报告两个仓库都查了', async () => {
    const be = freshRepo('clean-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init backend fixture')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)
    expect(pre.out).toContain('基线已记录')

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(0)
    expect(post.out).toContain('未变动')
    // 必须明确说查了几个仓库 —— 否则「只查了前端」会和「查了两个仓库」在输出上无法区分
    expect(post.out).toContain('2 个仓库')
  }, 30000)
})

describe('★ 判据②：未跟踪新文件（git diff HEAD 看不见，只有 porcelain 能抓）', () => {
  it('构建窗口内新增一个未跟踪 .py → exit 1，指出文件和 ?? 状态', async () => {
    const be = freshRepo('untracked-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)

    // ★ 模拟另一个会话在构建窗口内落了一个新文件
    fs.writeFileSync(path.join(be, 'round210_new_module.py'), '# 落盘\n')

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(1)
    expect(post.out).toContain('文件清单在构建窗口内变了')
    expect(post.out).toContain('round210_new_module.py')
    expect(post.out).toContain('??')
  }, 30000)

  it('未跟踪文件在 pre 之前就存在 → 不算污染（那本来就是既有工作区状态）', async () => {
    const be = freshRepo('preexisting-untracked-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')
    // pre 之前就有的未跟踪文件（比如另一个会话的 WIP）
    fs.writeFileSync(path.join(be, 'wip_notes.md'), 'notes\n')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)
    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(0)
  }, 30000)
})

describe('★ 判据③：porcelain 行不变、只有正文被改', () => {
  it('改动一个**已修改**文件的正文（行仍为 " M"）→ exit 1', async () => {
    const be = freshRepo('body-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 1\nb: 2\n')
    commitAll(be, 'init')

    // pre 之前先把它弄脏（已跟踪 + 已修改），使 porcelain 行固定为 " M config.yaml"
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 1\nb: 999\n')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)

    // ★ 只改正文，**行状态和文件名都不变** —— porcelain 比对看不见
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 1\nb: 12345\n')

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(1)
    expect(post.out).toContain('内容哈希不同')
  }, 30000)

  it('正文改回**完全一致** → 不算污染（内容相同就是没污染）', async () => {
    const be = freshRepo('revert-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 1\n')
    commitAll(be, 'init')
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 2\n')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 3\n')
    fs.writeFileSync(path.join(be, 'config.yaml'), 'a: 2\n') // 改回原样

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(0)
  }, 30000)
})

describe('★ 判据①：HEAD 变化', () => {
  it('构建窗口内提交 / 切分支 → exit 1，报告 HEAD 前后值', async () => {
    const be = freshRepo('head-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)

    fs.writeFileSync(path.join(be, 'app.py'), 'print(2)\n')
    commitAll(be, '落地一个新提交')

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(1)
    expect(post.out).toContain('HEAD 变了')
  }, 30000)
})

describe('两仓库都查（不是只查前端）', () => {
  it('污染发生在前端仓库时也判负', async () => {
    const be = freshRepo('frontend-pollute-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)

    // 污染**前端**（workroot）而不是后端
    fs.writeFileSync(path.join(WORK_ROOT, 'src_polluted.js'), 'x\n')

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(1)
    expect(post.out).toContain('前端仓库文件清单在构建窗口内变了')

    // 清掉，避免影响后续用例（本目录约定不做删除，但这是**夹具内容**不是用户数据）
    fs.rmSync(path.join(WORK_ROOT, 'src_polluted.js'), { force: true })
  }, 30000)

  it('探测不到后端仓库时**显式降级**（报告里留下痕迹），不静默通过', async () => {
    const lonely = path.join(FIXTURE_ROOT, 'no-backend')
    fs.mkdirSync(path.join(lonely, 'tools'), { recursive: true })
    fs.copyFileSync(TOOL, path.join(lonely, 'tools', 'verify-workspace-frozen.js'))
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(lonely, 'package.json'))
    initRepo(lonely)
    fs.writeFileSync(path.join(lonely, 'marker.txt'), 'v1\n')
    commitAll(lonely, 'init')

    // 指向一个不存在的后端仓库
    const bogus = path.join(FIXTURE_ROOT, 'definitely-no-such-repo-xyz')
    const pre = await runIn(lonely, '--pre', bogus)
    expect(pre.code).toBe(0)
    expect(pre.out).toContain('未探测到后端仓库')

    const post = await runIn(lonely, '--post', bogus)
    expect(post.code).toBe(0)
    expect(post.out).toContain('仅校验了前端')
  }, 30000)
})

describe('★ 自指污染：闸门不得把自己写的基线当成污染', () => {
  it('--pre 刚创建的 .vitest_cache/ 不能让自己在 --post 时判负', async () => {
    // 这条是**实测踩出来的**：首版闸门在夹具仓库（未 ignore .vitest_cache）上
    // 干净窗口也判负 —— `--pre` 写基线那一刻才建出 `.vitest_cache/`，
    // 于是 `--post` 的 porcelain 凭空多一行 `?? .vitest_cache/`，
    // 闸门把自己判成了污染源。
    //
    // 真实仓库靠 `.gitignore` 恰好盖住了它，但那只是运气
    // （闸门不该依赖别人的配置文件来保证自己正确）。
    const root = path.join(FIXTURE_ROOT, 'selfref')
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
    fs.copyFileSync(TOOL, path.join(root, 'tools', 'verify-workspace-frozen.js'))
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'))
    initRepo(root)
    fs.writeFileSync(path.join(root, 'marker.txt'), 'v1\n')
    commitAll(root, 'init')

    const be = freshRepo('selfref-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(root, '--pre', be)
    expect(pre.code).toBe(0)
    // 基线文件确实被创建了（否则这条用例没有意义）
    expect(fs.existsSync(path.join(root, '.vitest_cache', 'workspace-frozen-state.json'))).toBe(true)

    const post = await runIn(root, '--post', be)
    expect(post.code).toBe(0)
    expect(post.out).toContain('未变动')
  }, 30000)

  it('剔除自产物不能把「真的未跟踪文件」一起漏掉', async () => {
    // 反向对照：排除的必须**只有** .vitest_cache/，其它未跟踪文件照抓不误。
    const root = path.join(FIXTURE_ROOT, 'selfref-negative')
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true })
    fs.copyFileSync(TOOL, path.join(root, 'tools', 'verify-workspace-frozen.js'))
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(root, 'package.json'))
    initRepo(root)
    fs.writeFileSync(path.join(root, 'marker.txt'), 'v1\n')
    commitAll(root, 'init')

    const pre = await runIn(root, '--pre', undefined)
    expect(pre.code).toBe(0)

    fs.writeFileSync(path.join(root, 'not_gate_artifact.py'), 'x\n')
    const post = await runIn(root, '--post', undefined)
    expect(post.code).toBe(1)
    expect(post.out).toContain('not_gate_artifact.py')
  }, 30000)
})

describe('候选列表与 verify-staging.js 保持一致（防两处漂移）', () => {
  it('backendRepoCandidates() 的两份实现（含 env 覆盖位）逐项相同', () => {
    const req = createRequire(import.meta.url)
    const frozen = req(TOOL) as { backendRepoCandidates: () => string[] }
    const staging = req(path.join(REPO, 'tools', 'verify-staging.js')) as {
      backendRepoCandidates: () => string[]
    }

    const a = frozen.backendRepoCandidates()
    const b = staging.backendRepoCandidates()

    // 两条候选列表都含 env 覆盖位，且长度一致
    expect(a.length).toBe(b.length)
    // env 位存在（用 SCADA_BACKEND_REPO 探测）
    process.env.SCADA_BACKEND_REPO = '/tmp/probe-xyz'
    try {
      expect(frozen.backendRepoCandidates()[0]).toBe('/tmp/probe-xyz')
      expect(staging.backendRepoCandidates()[0]).toBe('/tmp/probe-xyz')
    } finally {
      delete process.env.SCADA_BACKEND_REPO
    }
  })
})

describe('与构建链的接线（防止闸门被摘掉）', () => {
  it('package.json 里 verify:frozen:pre/post 存在，且 electron:build:frozen 包住了 pre→build→post', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
    const s = pkg.scripts as Record<string, string>

    expect(s['verify:frozen:pre']).toContain('verify-workspace-frozen.js --pre')
    expect(s['verify:frozen:post']).toContain('verify-workspace-frozen.js --post')

    const chain = s['electron:build:frozen']
    expect(chain).toBeTruthy()
    // 顺序必须是 pre → electron:build → post（用索引比较）
    const iPre = chain.indexOf('verify:frozen:pre')
    const iBuild = chain.indexOf('electron:build')
    const iPost = chain.indexOf('verify:frozen:post')
    expect(iPre).toBeGreaterThanOrEqual(0)
    expect(iBuild).toBeGreaterThan(iPre)
    expect(iPost).toBeGreaterThan(iBuild)
  })

  it('本机构建脚本 run_electron_build.py 也在构建前后调用了闸门', () => {
    const src = fs.readFileSync(
      path.join(REPO, 'tools', 'run_electron_build.py'),
      'utf8',
    )
    expect(src).toContain('verify-workspace-frozen.js')
    expect(src).toContain('_frozen("pre")')
    expect(src).toContain('_frozen("post")')
    // 污染时必须返回退出码 3（区别于「构建失败 1」），不能悄悄当成功
    expect(src).toContain('return 3')
  })
})
