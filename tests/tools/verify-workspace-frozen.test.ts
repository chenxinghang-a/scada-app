import { describe, it, expect, beforeAll } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { stripComments } from '../helpers/source-text'
import fs from 'node:fs'
import os from 'node:os'
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
  return runRaw(root, [phase], backendRepo)
}
/**
 * 在指定根里跑闸门，参数自由。
 *
 * ⚠️ 一律走**复制的副本**（`<root>/tools/verify-workspace-frozen.js`），
 *    绝不对真实 `TOOL` 直接 spawn —— 它的 REPO_ROOT 是编译期常量、
 *    不受 cwd 影响，直接跑会写真实仓库的基线并探测真实后端仓库（别的会话的工作区）。
 */
function runRaw(root: string, args: string[], backendRepo?: string, extraEnv?: Record<string, string>) {
  const env = { ...process.env }
  if (backendRepo) env.SCADA_BACKEND_REPO = backendRepo
  else delete env.SCADA_BACKEND_REPO
  if (extraEnv) Object.assign(env, extraEnv)
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'tools', 'verify-workspace-frozen.js'), ...args],
      { cwd: root, env },
    )
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: -1, out: `spawn 失败: ${e.message}` }))
    child.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/** 带额外环境变量跑（用于把基线时效阈值压到 0）。 */
function runInWithEnv(
  root: string,
  phase: '--pre' | '--post',
  backendRepo: string | undefined,
  extraEnv: Record<string, string>,
) {
  return runRaw(root, [phase], backendRepo, extraEnv)
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
  it('--pre / --post 二选一：同时给或都不给都报用法错（exit 1）', async () => {
    // ⚠️ 必须用**隔离的 workroot** 跑，不能对真实 TOOL 直接跑：
    //    `TOOL` 的 REPO_ROOT 是编译期常量（resolve(__dirname,'..') = 真实仓库根），
    //    **不受 cwd 影响** —— 直接跑它会往真实仓库写 .vitest_cache/ 下的基线文件，
    //    并且去探测**真实后端仓库**（那是另一个会话的活工作区）。
    //    首版就是这么写的，属测试污染，已改。
    const iso = path.join(FIXTURE_ROOT, 'usage')
    fs.mkdirSync(path.join(iso, 'tools'), { recursive: true })
    fs.copyFileSync(TOOL, path.join(iso, 'tools', 'verify-workspace-frozen.js'))
    fs.copyFileSync(path.join(REPO, 'package.json'), path.join(iso, 'package.json'))

    const both = await runRaw(iso, ['--pre', '--post'])
    expect(both.code).toBe(1)
    expect(both.out).toContain('用法')

    const neither = await runRaw(iso, [])
    expect(neither.code).toBe(1)
    expect(neither.out).toContain('用法')
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

describe('基线时效（防「过期参照物给出误导性判词」）', () => {
  it('基线过旧 + 检测到差异 → 判词是「基线已过期」，不是「构建窗口内被改动」', async () => {
    // 为什么要有这条：`--pre` 与 `--post` 本该只隔一次构建（几分钟）。
    // 若基线是几小时前的（上次构建崩了/被中断/忘了配对），现在的 `--post`
    // 是在拿**过期参照物**比对 —— 此时「构建窗口内被改动」这个判词是**误导**，
    // 会把人引去查一个不存在的问题。
    // 实测过：`--pre` 后有人提交了一个合理 commit，旧版报的正是
    // 「构建窗口内有人提交」——而真实原因是「基线是上一次的」。
    const be = freshRepo('age-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)

    // 造一个差异 + 把阈值压到 0（等价于「基线已过期」）
    fs.writeFileSync(path.join(be, 'late.py'), 'x\n')
    const post = await runInWithEnv(WORK_ROOT, '--post', be, { SCADA_FROZEN_MAX_AGE_MS: '1' })

    expect(post.code).toBe(1)
    expect(post.out).toContain('基线**已过期**')
    expect(post.out).toContain('结论不可信')
    // 关键：不得给出「构建窗口内工作区被改动」这个（此刻不可信的）判词
    expect(post.out).not.toContain('构建窗口内工作区被改动 —— 产物不可信')
    // 且必须给出正确处置
    expect(post.out).toContain('重新跑一次')

    fs.rmSync(path.join(be, 'late.py'), { force: true })
  }, 30000)

  it('基线过旧但两边恰好一致 → 放行，但必须显式留痕（可信度弱于新鲜基线）', async () => {
    const be = freshRepo('age-clean-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)

    const post = await runInWithEnv(WORK_ROOT, '--post', be, { SCADA_FROZEN_MAX_AGE_MS: '1' })
    expect(post.code).toBe(0)
    expect(post.out).toContain('基线较旧')
    // 不能静默通过 —— 必须让人知道「参照物不新鲜」
    expect(post.out).toContain('弱于新鲜基线')
  }, 30000)

  it('新鲜基线 + 真污染 → 判词仍是「构建窗口内工作区被改动」（时效逻辑不得削弱主判据）', async () => {
    const be = freshRepo('age-fresh-dirty-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const pre = await runIn(WORK_ROOT, '--pre', be)
    expect(pre.code).toBe(0)
    fs.writeFileSync(path.join(be, 'pollution.py'), 'x\n')

    const post = await runIn(WORK_ROOT, '--post', be) // 不压阈值 = 新鲜
    expect(post.code).toBe(1)
    expect(post.out).toContain('构建窗口内工作区被改动')
    expect(post.out).not.toContain('基线**已过期**')

    fs.rmSync(path.join(be, 'pollution.py'), { force: true })
  }, 30000)
})

describe('后端仓库「是哪个」变了（探测不对称 / 换落点）', () => {
  it('pre 探测不到后端、post 探测到了 → 判负，且报因指向**环境问题**而非「有人动了仓库」', async () => {
    const pre = await runIn(WORK_ROOT, '--pre', undefined)
    expect(pre.code).toBe(0)
    expect(pre.out).toContain('未探测到后端仓库')

    const be = freshRepo('asym-be')
    initRepo(be)
    fs.writeFileSync(path.join(be, 'app.py'), 'print(1)\n')
    commitAll(be, 'init')

    const post = await runIn(WORK_ROOT, '--post', be)
    expect(post.code).toBe(1)
    expect(post.out).toContain('后端仓库探测结果变了')
    // ★ 核心：报因要指向最可能的真实原因（环境没配对），不是含糊的"有人动了仓库"
    expect(post.out).toContain('环境问题')
    expect(post.out).toContain('SCADA_BACKEND_REPO')
    // 且要提醒"只校验了前端那一次防护是打折的"
    expect(post.out).toContain('防护是打折的')
  }, 30000)

  it('pre 指向仓库 A、post 指向仓库 B → 判负，报「换了落点」（不是「消失了」）', async () => {
    // 这个场景比"消失"更隐蔽：两次指纹都算得出来，只是各算各的，
    // 于是任何真实改动都会被"换了仓库"这件事掩盖。
    const a = freshRepo('swap-a')
    const b = freshRepo('swap-b')
    for (const [d, f] of [[a, 'a.py'], [b, 'b.py']] as [string, string][]) {
      initRepo(d)
      fs.writeFileSync(path.join(d, f), 'x\n')
      commitAll(d, 'init')
    }

    const pre = await runIn(WORK_ROOT, '--pre', a)
    expect(pre.code).toBe(0)

    const post = await runIn(WORK_ROOT, '--post', b)
    expect(post.code).toBe(1)
    // 必须点出本质：**换了落点**、两次指纹不可比
    expect(post.out).toContain('换了落点')
    expect(post.out).toContain('比对结果无意义')
    // 注意：同时报「原仓库不见了」是**正确**的（pre 里有、post 里没有），
    // 不禁止它 —— 两条信息各有价值：前者说"换了谁"，后者说"旧的那个没了"。
    // （首版这里写了 not.toContain，是断言过窄，已放宽。）
  }, 30000)
})

describe('测试自身不得污染真实仓库（首版就是这样被自己污染的）', () => {
  it('本测试文件里不得出现对真实 TOOL 的直接 spawn', () => {
    // 为什么要有这条：
    //   `TOOL`（= 真实仓库里的 verify-workspace-frozen.js）的 REPO_ROOT 是
    //   **编译期常量** `resolve(__dirname, '..')`，**不受 spawn 的 cwd 影响**。
    //   直接 spawn 它 = 往**真实仓库**写基线文件（`.vitest_cache/workspace-frozen-state.json`）
    //   + 去探测**真实后端仓库**（另一个会话的活工作区）。
    //
    //   首版就是这么写的（一个 `run()` 辅助函数），后果实测：
    //     * 真实仓库被留下一个 state 文件 → 本机下次 `electron:build:frozen`
    //       会拿旧基线比对 → 直接误红；
    //     * 而且它是 flaky 的来源之一。
    //
    //   一律走 `<workroot>/tools/verify-workspace-frozen.js` 副本。
    const src = fs.readFileSync(
      path.join(REPO, 'tests', 'tools', 'verify-workspace-frozen.test.ts'),
      'utf8',
    )
    // 断言：spawn 的脚本路径参数必须来自 root（拼 `'tools', 'verify-workspace-frozen.js'`），
    // 而不是那个裸的 TOOL 常量。
    expect(src, '不得把 TOOL 直接喂给 spawn（会写真实仓库基线）')
      .not.toMatch(/spawn\([^)]*\[\s*TOOL\s*,/)
    expect(src).toContain("path.join(root, 'tools', 'verify-workspace-frozen.js')")
  })

  // 基线文件的真实路径（闸门 REPO_ROOT 是编译期常量 → 恒落在真实仓库里）。
  const REAL_STATE = path.join(REPO, '.vitest_cache', 'workspace-frozen-state.json')

  /**
   * 本文件**导入期**记录的真实基线状态 —— 必须早于任何 beforeAll。
   *
   * ⚠️ 这里不能再写成「断言文件不存在」。CI 的 `electron-build` job 里，
   *    步骤 3（`verify-workspace-frozen.js --pre`）**合法地**创建了这个文件，
   *    步骤 12 才跑测试 —— 此时它存在是**正确**的，不是污染。
   *    （2026-10-11 实测：该断言把 CI 假红了一整轮，日志：
   *      `测试污染了真实仓库：D:\a\scada-app\scada-app\.vitest_cache\workspace-frozen-state.json 应不存在`）
   *
   * 正确的判据是「**测试**有没有让它从无到有 / 有没有改过它」，
   * 而不是「它此刻在不在」—— 后者把「构建链路的合法产物」误判成「测试污染」。
   */
  const realStateExistedBefore = fs.existsSync(REAL_STATE)
  const realStateMtimeBefore = realStateExistedBefore ? fs.statSync(REAL_STATE).mtimeMs : -1

  it('测试自身不得让真实仓库的基线文件「从无到有」或改动它', () => {
    // 本条是本测试文件**自己**的副作用检查。
    // 判据（两条，取**已存在**时更严的那条）：
    //   ① 测试开始前不存在 → 跑完必须仍不存在（真·新增 = 污染）；
    //   ② 测试开始前已存在 → 跑完内容/mtime 必须没变（动了它 = 污染）。
    // 为什么不断言「不存在」：CI 的 --pre 步骤会合法留下它，那是构建链路的产物。
    const nowExists = fs.existsSync(REAL_STATE)

    if (!realStateExistedBefore) {
      expect(
        nowExists,
        `测试污染了真实仓库：${REAL_STATE} 被从无到有创建了（测试全程只该碰副本）`,
      ).toBe(false)
      return
    }

    // 已存在分支：本体不能消失（那说明测试删了构建产物，同样是破坏），
    // 更不能被改（mtime 变化 = 测试写过真实仓库）。
    expect(nowExists, `测试删掉了真实仓库的既有基线文件：${REAL_STATE}（这是构建链路的产物）`).toBe(true)
    const mtimeNow = fs.statSync(REAL_STATE).mtimeMs
    expect(
      mtimeNow,
      `测试改写了真实仓库的基线文件：${REAL_STATE}（mtime 由 ${realStateMtimeBefore} 变为 ${mtimeNow}）`,
    ).toBe(realStateMtimeBefore)
  })
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

  it('CI 里也接了闸门，且 pre/post **夹住**了打包步骤', () => {
    // 为什么 CI 也要有：本 job 从 checkout 到 electron-builder 之间有约 10 个步骤
    // （PyInstaller、两次 npm ci、build、三组测试……）。任何一步意外改了被跟踪源码
    // （依赖的 postinstall、工具写出的文件、将来可能加的缓存恢复），都会让
    // **打包进去的源码 ≠ checkout 出来的源码**，而下游七道闸门看不见这件事。
    const yml = fs.readFileSync(
      path.join(REPO, '.github', 'workflows', 'ci.yml'),
      'utf8',
    )

    const iPre = yml.indexOf('verify-workspace-frozen.js --pre')
    const iBuild = yml.indexOf('name: Build NSIS installer')
    const iPost = yml.indexOf('verify-workspace-frozen.js --post')

    expect(iPre, '--pre 未接进 CI').toBeGreaterThanOrEqual(0)
    expect(iPost, '--post 未接进 CI').toBeGreaterThanOrEqual(0)

    // ★ 核心：pre 必须在打包**之前**、post 在打包**之后** —— 否则断言的不是
    //   「打包用的那份源码」，而是别的时刻的快照，等于没测。
    expect(iBuild).toBeGreaterThan(iPre)
    expect(iPost).toBeGreaterThan(iBuild)
  })

  it('CI 的 post 断言必须紧跟打包，且不能是 if: always() 之外的软失败', () => {
    // 这条防「闸门被接成提醒而不是门」—— 若 post 带了 `continue-on-error: true`
    // 或 `if: always()`（在失败步骤里也当成功），它就退化成只打日志。
    const yml = fs.readFileSync(
      path.join(REPO, '.github', 'workflows', 'ci.yml'),
      'utf8',
    )
    const idx = yml.indexOf('verify-workspace-frozen.js --post')
    // 取该 run 所在 step 块（往上找最近的 `- name:`，往下到下一个 `- name:`）
    const blockStart = yml.lastIndexOf('\n      - name:', idx)
    const blockEnd = yml.indexOf('\n      - name:', idx)
    const block = yml.slice(blockStart, blockEnd === -1 ? undefined : blockEnd)

    expect(block).not.toContain('continue-on-error: true')
    // 允许 `if: always()` 的前提是它**仍然会因 exit 1 让 job 失败**；
    // 但我们这里刻意不加（它会掩盖「前面的步骤崩了」这一事实），
    // 所以直接断言没有 if 条件 —— 若将来看清理由要加，改这条测试即可。
    expect(block).not.toMatch(/^\s+if:/m)
  })
})

describe('git 调用挂起（超时）→ fail-closed，**不得**降级（2026-10-12 加固）', () => {
  const req = createRequire(import.meta.url)
  const mod = req(path.join(REPO, 'tools', 'verify-workspace-frozen.js')) as {
    repoFingerprint: (repo: string) => {
      repo: string
      head: string | null
      timedOut: boolean
      error: string | null
    }
    diffSnapshots: (pre: unknown, post: unknown) => string[]
  }

  it('repoFingerprint 必须带 timedOut 字段（供上层区分"挂起"与"不可用"）', () => {
    const fp = mod.repoFingerprint(REPO)
    // 正常仓库：不应 timedOut
    expect(fp.timedOut).toBe(false)
    expect(typeof fp.error === 'string' || fp.error === null).toBe(true)
  })

  // ★ "真触发超时"的两条路（各平台取更稳的那条）：
  //   · POSIX：用 SCADA_GIT_BIN 指向**必然挂起**的 shim（sleep 60 ≫ 超时）—— 语义明确、不靠时序。
  //   · Windows：无法用 .cmd shim（Node 安全限制报 EINVAL）→ 退回"把超时压到 1ms"
  //     （Windows 进程启动慢，1ms 必然来不及 —— 本地实测稳定触发）。
  //   ⚠️ 为什么不能在 POSIX 也用 1ms：实测 CI（Linux）git 快得在 1ms 内就跑完 → 假红。
  const isWin = process.platform === 'win32'
  it('★ 真触发超时：git 挂起 → repoFingerprint.timedOut === true', () => {
    // ⚠️ 为什么必须"真跑"而不是只构造假快照（2026-10-12 自测炸出的教训）：
    //    只喂构造数据的测试**测不到**"repoFingerprint 与真实超时的联系" ——
    //    实测：把源码里 `timedOut` 拍成恒 false（= 把挂起当降级、复刻事故），
    //    纯构造版测试**全绿**，一点没抓到。**判别力自检必须是端到端的**。
    let cleanup: (() => void) | null = null
    const prevBin = process.env.SCADA_GIT_BIN
    const prevTimeout = process.env.SCADA_GIT_TIMEOUT_MS
    try {
      if (isWin) {
        process.env.SCADA_GIT_TIMEOUT_MS = '1'
      } else {
        const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hang-git-'))
        const shim = path.join(shimDir, 'git-hang')
        fs.writeFileSync(shim, '#!/bin/sh\nsleep 60\n')
        fs.chmodSync(shim, 0o755)
        cleanup = () => { try { fs.rmSync(shimDir, { recursive: true, force: true }) } catch { /* 忽略 */ } }
        process.env.SCADA_GIT_BIN = shim
        process.env.SCADA_GIT_TIMEOUT_MS = '500'
      }
      const fp = mod.repoFingerprint(REPO)
      expect(fp.timedOut).toBe(true)
      expect(fp.head).toBe(null)
      expect(String(fp.error)).toMatch(/挂起/)
    } finally {
      if (prevBin === undefined) delete process.env.SCADA_GIT_BIN
      else process.env.SCADA_GIT_BIN = prevBin
      if (prevTimeout === undefined) delete process.env.SCADA_GIT_TIMEOUT_MS
      else process.env.SCADA_GIT_TIMEOUT_MS = prevTimeout
      if (cleanup) cleanup()
    }
  }, 30000)


  it('★ 反向对照：正常超时下 repoFingerprint 不得误报 timedOut（防"恒真"）', () => {
    // 没有这条，上面那条可能因为"永远为真"而假绿。
    const fp = mod.repoFingerprint(REPO)
    expect(fp.timedOut).toBe(false)
    expect(fp.head).not.toBe(null)
  })


  it('★ 判别核心：classifyGitError 把"超时"与"不可用"分开（纯函数，跨平台）', () => {
    const c = (mod as unknown as { classifyGitError: (e: unknown) => string }).classifyGitError
    expect(c({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(c({ signal: 'SIGTERM' })).toBe('timeout')
    expect(c({ killed: true })).toBe('timeout')
    // ★ EBUSY：实测"快进程 + 极短超时"下超时杀进程报的是 EBUSY（不是 ETIMEDOUT）。
    //   漏掉它 → 该种挂起被误判成"不可用" → 降级 → 复刻事故。
    expect(c({ code: 'EBUSY' })).toBe('timeout')
    // 反向：普通失败必须判成"不可用"（允许降级），否则所有 git 错误都会 fail-closed
    expect(c({ code: 'ENOENT' })).toBe('unavailable')
    expect(c(new Error('boom'))).toBe('unavailable')
    expect(c(null)).toBe('unavailable')
  })

  it('★ 静态守卫：本文件每处 execFileSync 都必须显式传 timeout（防新调用漏加）', () => {
    // 端到端触发受平台限制，这条做**兜底**：机械保证"再有人新写 git 调用"时不会漏超时。
    // ⚠️ 必须先剥注释：本文件头注里**用文字提到了** `execFileSync('git', ...)`，
    //    不剥就会把注释里的提及当成真调用（实测：假阳性报 104/134 两处）。
    //    用共享原语 stripComments（Bug 16 的真源）—— 别在这里手写正则剥注释。
    const src = stripComments(
      fs.readFileSync(path.join(REPO, 'tools', 'verify-workspace-frozen.js'), 'utf8'),
    )
    // 抠每个 execFileSync( ... ) 调用（配对括号），看不含 timeout:
    const missing: number[] = []
    const re = /execFileSync\s*\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const open = src.indexOf('(', m.index)
      let depth = 0
      let end = -1
      for (let k = open; k < src.length; k += 1) {
        const ch = src[k]
        if (ch === '(') depth += 1
        else if (ch === ')') {
          depth -= 1
          if (depth === 0) { end = k; break }
        }
      }
      if (end === -1) continue
      const call = src.slice(m.index, end + 1)
      if (!/timeout\s*:/.test(call)) {
        missing.push(src.slice(0, m.index).split('\n').length)
      }
    }
    expect(missing, `以下 execFileSync 调用没有显式 timeout（行号）：${missing.join(', ')}`).toEqual([])
  })


  it('★ 判别核心：classifyGitError 把"超时"与"不可用"分开（纯函数，跨平台）', () => {
    // 端到端在 Windows 上依赖 shim，判据强度受平台影响；
    // 这条直接钉住"分类"这一步 —— 它是"挂起不得降级"的全部依据。
    const c = (mod as unknown as { classifyGitError: (e: unknown) => string }).classifyGitError
    expect(c({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(c({ signal: 'SIGTERM' })).toBe('timeout')
    expect(c({ killed: true })).toBe('timeout')
    // ★ EBUSY：实测"快进程 + 极短超时"下超时杀进程报的是 EBUSY（不是 ETIMEDOUT）。
    //   漏掉它 → 该种挂起被误判成"不可用" → 降级 → 复刻事故。
    expect(c({ code: 'EBUSY' })).toBe('timeout')
    // 反向：普通失败必须判成"不可用"（允许降级），否则所有 git 错误都会 fail-closed
    expect(c({ code: 'ENOENT' })).toBe('unavailable')
    expect(c(new Error('boom'))).toBe('unavailable')
    expect(c(null)).toBe('unavailable')
  })


  it('diffSnapshots：任一侧 timedOut → 报 problem（fail-closed），即使两侧"值完全相同"', () => {
    const mk = (timedOut: boolean) => ({
      capturedAt: new Date().toISOString(),
      backendFound: true,
      backendRepo: REPO,
      repos: [
        {
          repo: REPO,
          head: 'abc123',
          status: '',
          trackedDiffSha: 'deadbeef',
          timedOut,
          error: timedOut ? 'git 调用挂起' : null,
        },
      ],
    })

    // ⚠️ 关键：两侧数据**一模一样**（head/status/diff 全相同）。
    //    若把挂起当降级，diffSnapshots 会认为"一致" → 假绿。
    //    正确行为 = 报出挂起。
    const problems = mod.diffSnapshots(mk(true), mk(true))
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toMatch(/挂起|超时/)

    // 反向对照：都未挂起 → 一致（不报），证明上面那条不是"总会报"
    expect(mod.diffSnapshots(mk(false), mk(false))).toEqual([])
  })
})

describe('git 超时语义与 verify-staging.js 保持一致（防两处漂移，2026-10-12）', () => {
  // ⚠️ 为什么需要（本轮自省发现）：
  //    `gitTimeoutMs()` / `GIT_TIMEOUT_DEFAULT_MS` 在**两个文件里各写了一份** ——
  //    这正是 `backendRepoCandidates()` 的同款情况（那边已有一致性守卫），
  //    但我本轮新引入 git 超时时**只写了实现、没配守卫** ——
  //    在我自己刚立的"多份实现必须有守卫"纪律上立刻违反了。
  //    若一边改成 30s、另一边忘改，同一个 `SCADA_GIT_TIMEOUT_MS` 在两个闸门里行为就不同。
  const req = createRequire(import.meta.url)
  const frozen = req(TOOL) as {
    gitTimeoutMs: () => number
    GIT_TIMEOUT_DEFAULT_MS: number
  }
  const staging = req(path.join(REPO, 'tools', 'verify-staging.js')) as {
    gitTimeoutMs: () => number
    GIT_TIMEOUT_DEFAULT_MS: number
  }

  it('两侧默认超时值相同', () => {
    expect(frozen.GIT_TIMEOUT_DEFAULT_MS).toBe(staging.GIT_TIMEOUT_DEFAULT_MS)
  })

  it('两侧 gitTimeoutMs() 对同一 env 给出相同结果（含非法值回退）', () => {
    const probes: (string | undefined)[] = [undefined, '1', '12345', '0', '-5', 'abc', '']
    const prev = process.env.SCADA_GIT_TIMEOUT_MS
    try {
      for (const v of probes) {
        if (v === undefined) delete process.env.SCADA_GIT_TIMEOUT_MS
        else process.env.SCADA_GIT_TIMEOUT_MS = v
        expect(
          frozen.gitTimeoutMs(),
          `env=${JSON.stringify(v)}：两侧对"非法/合法值"的回退必须一致`,
        ).toBe(staging.gitTimeoutMs())
      }
    } finally {
      if (prev === undefined) delete process.env.SCADA_GIT_TIMEOUT_MS
      else process.env.SCADA_GIT_TIMEOUT_MS = prev
    }
  })

  it('非法值（0 / 负数 / 非数字 / 空串）必须回退到默认值，而不是当成 0', () => {
    // ⚠️ 若把 "0" 当成合法超时=0ms，所有 git 调用会**立刻超时** → 闸门全红（假红）。
    const prev = process.env.SCADA_GIT_TIMEOUT_MS
    try {
      for (const bad of ['0', '-5', 'abc', '']) {
        process.env.SCADA_GIT_TIMEOUT_MS = bad
        expect(frozen.gitTimeoutMs(), `env=${JSON.stringify(bad)} 应回退默认`).toBe(
          frozen.GIT_TIMEOUT_DEFAULT_MS,
        )
      }
    } finally {
      if (prev === undefined) delete process.env.SCADA_GIT_TIMEOUT_MS
      else process.env.SCADA_GIT_TIMEOUT_MS = prev
    }
  })
})
