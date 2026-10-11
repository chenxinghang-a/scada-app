/**
 * 闸门平价守卫：**CI 跑过的每道闸门，本地打包路径也必须能走到**。
 *
 * 为什么需要这条
 * --------------
 * 这是本项目栽过的老坑（见 MEMORY 硬规则 21「闸门装了 ≠ 闸门走得到」）：
 * `npm run electron:build` 与 CI 的 `electron-build` job 是**两条路径**，
 * 早先本地那条只跑 `verify:dist`，而 CI 跑四道 ——
 * 于是**本地打包出来的安装包有三道闸门没走过**，而且两条路径都绿，不报错。
 *
 * 实测（2026-10-08）：
 *   * CI：staged backend 冒烟 / verify:dist / verify:asar / 安装包内后端冒烟（四道）
 *   * 本地 `electron:build`：只有 `verify:dist`
 *   * 更糟的是本地 `backend/` 暂存目录当时已落后 HEAD **16.3 天**（2052 个文件），
 *     而 `verify:dist` 只看 `dist/`，**根本不会看 `backend/`** ——
 *     也就是说「版本号是新的、内容是旧的」包会被打出来，四道闸门一道都拦不住。
 *
 * 本守卫的判据刻意做成**机械可查**的：把 CI 里所有 `node tools/verify-*.js …`
 * 调用抠出来，逐条断言它在 `package.json` 的某个 script 里出现过。
 * 这样以后往 CI 加闸门、却忘了加进本地链时，这里会红。
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = process.cwd()
const CI = path.join(REPO, '.github', 'workflows', 'ci.yml')
const PKG = path.join(REPO, 'package.json')
const SCRIPT = path.join(REPO, '.github', 'scripts', 'emit_unit_test_failure.py')

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * 异步跑一个 python 脚本，返回 stdout+stderr。
 *
 * ⚠️ 本目录的既有约定：**同步 spawn 在本机 vitest 里一律 EBUSY**
 * （`execFileSync` / `spawnSync` 都不可用）→ 一律走异步 `spawn` + Promise。
 * 这与 `verify-workspace-frozen.test.ts` 的夹具做法一致。
 */
function runPy(script: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('python', [script], { cwd })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve(`spawn 失败: ${e.message}`))
    child.on('close', () => resolve(out))
  })
}

/** CI 里所有 `node tools/verify-*.js …` 的调用（去掉注释行）。 */
function ciGateCommands(): string[] {
  const text = fs.readFileSync(CI, 'utf8')
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const m = line.match(/^(?:run:\s*)?(node\s+tools\/verify-[\w.-]+\.js[^\n]*)$/)
    if (m) out.push(norm(m[1]))
  }
  return [...new Set(out)]
}

function scripts(): Record<string, string> {
  return JSON.parse(fs.readFileSync(PKG, 'utf8')).scripts ?? {}
}

describe('闸门平价（CI 路径 vs 本地脚本路径）', () => {
  it('CI 里每一条 verify-*.js 调用，本地都要有对应的 npm script 能跑到', () => {
    const cmds = ciGateCommands()
    expect(cmds.length, '没能从 ci.yml 里抠出任何闸门调用，守卫本身失效了').toBeGreaterThan(0)

    const allScripts = Object.entries(scripts()).map(([k, v]) => [k, norm(v)] as const)
    const missing = cmds.filter(
      (c) => !allScripts.some(([, v]) => v.includes(c)),
    )

    expect(
      missing,
      `以下闸门 CI 会跑、但本地没有任何 npm script 能走到 —— 本地打包会绕过它们：\n` +
        missing.map((m) => `  ${m}`).join('\n'),
    ).toEqual([])
  })

  it('本地打包链必须包含「打包后」的闸门（asar 完整性 + 安装包内后端冒烟）', () => {
    const s = scripts()
    for (const key of ['electron:build', 'electron:build:dir']) {
      expect(s[key], `缺少 script: ${key}`).toBeTruthy()
      // 打包前：暂存目录新鲜度 + dist 完整性
      expect(s[key], `${key} 没有先校验暂存目录（会打出陈旧后端）`).toContain('verify:staging')
      expect(s[key], `${key} 少了 verify:dist`).toContain('verify:dist')
      // 打包后：产物闸门
      const hasPost =
        norm(s[key]).includes('verify:packaged') || norm(s[key]).includes('verify:asar')
      expect(hasPost, `${key} 打包后没有任何产物闸门（等于产出未验证的安装包）`).toBe(true)
    }
  })

  it('electron:build 的打包后闸门组必须同时含 asar 与「安装包内后端」冒烟', () => {
    const s = scripts()
    const post = norm(s['verify:packaged'] ?? '')
    expect(post, 'verify:packaged 应包含 verify:asar').toContain('verify:asar')
    expect(post, 'verify:packaged 应包含安装包内后端冒烟').toContain('verify:backend-runtime:shipped')
  })

  it('安装包内后端冒烟必须指向 release/win-unpacked 里的那一份（不是暂存目录）', () => {
    // 若指向 backend/，那就只是在重复 staged 冒烟，**没有验证"打进安装包的那一份"**。
    const cmd = norm(scripts()['verify:backend-runtime:shipped'] ?? '')
    expect(cmd).toContain('release/win-unpacked/resources/backend/scada-backend.exe')
    expect(cmd).not.toMatch(/--exe\s+backend\//)
  })
})

/**
 * 「CI 红了要能一眼看清」守卫（2026-10-11 补）。
 *
 * 背景：`electron-build` 连红 5 笔时，远端拿不到 job log（匿名 403），
 * vitest 默认 reporter 又把失败用例名折进汇总 —— 排查只能靠猜。
 * 为此两条测试步骤补了 verbose + annotation。本守卫防它们被将来改回去
 * （或 annotation 脚本被删/被解除接线，退化成"只打日志"）。
 */
describe('CI 失败可观测性（verbose + annotation）', () => {
  const CI_TEXT = () => fs.readFileSync(CI, 'utf8')

  it('Unit tests 必须用 verbose reporter（失败用例名要逐行可见）', () => {
    // ⚠️ 不能只写 `expect(text).toContain('--reporter=verbose')` ——
    //    该字符串**在上方的注释里也出现**，删掉真实用法后文本断言照样绿
    //    （变异实测：正是本仓库 Bug 10/11 那个坑，第三次踩）。
    //    必须把断言**限定在真正的 `run:` 命令里**。
    const text = CI_TEXT()
    const runCmds = text
      .split(/\r?\n/)
      .filter((ln) => /^\s+(run:\s*)?npm test\b/.test(ln) || /npm test\s+--/.test(ln))
      .join('\n')
    expect(runCmds, 'Unit tests 的**命令**里丢了 --reporter=verbose（失败用例名会被折进汇总）')
      .toContain('--reporter=verbose')
  })

  it('Unit tests 必须保留 fail-closed 语义（tee + pipefail，不能把非 0 吞掉）', () => {
    const text = CI_TEXT()
    // 拿 Unit tests 那个 run 块（从 `run: |` 到下一个步骤名）
    const idx = text.indexOf('npm test -- --reporter=verbose')
    expect(idx, '找不到 Unit tests 的 verbose 调用').toBeGreaterThanOrEqual(0)
    const blockStart = text.lastIndexOf('- name:', idx)
    const blockEnd = text.indexOf('\n      - name:', idx)
    const block = text.slice(blockStart, blockEnd === -1 ? undefined : blockEnd)
    expect(block, '缺 tee unit-tests.log（annotation 脚本读不到日志）').toContain('tee unit-tests.log')
    expect(block, '缺 set -o pipefail（tee 会把 vitest 的非 0 吞成 0）').toContain('set -o pipefail')
  })

  it('必须有失败 annotation 步骤，且指向存在的脚本、带 if: failure()', () => {
    const text = CI_TEXT()
    const idx = text.indexOf('emit_unit_test_failure.py')
    expect(idx, 'annotation 脚本未被 CI 调用（失败原因又只能在日志里翻）').toBeGreaterThanOrEqual(0)
    const blockStart = text.lastIndexOf('- name:', idx)
    const blockEnd = text.indexOf('\n      - name:', idx)
    const block = text.slice(blockStart, blockEnd === -1 ? undefined : blockEnd)
    // 只在失败时跑：成功时不该执行（否则每次绿跑都发一条无用 annotation）
    expect(block, 'annotation 步骤缺 if: failure()').toContain('if: failure()')
    // 脚本真存在
    expect(
      fs.existsSync(path.join(REPO, '.github', 'scripts', 'emit_unit_test_failure.py')),
      'annotation 脚本不存在，CI 会在该步 ENOENT',
    ).toBe(true)
  })

  it('annotation 脚本必须能筛出失败用例名与断言消息（真喂一段失败输出）', async () => {
    // 为什么必须"真喂"：本仓库已三次栽在「断言的是行为、却只做文本检查」上
    // （见 BUGS.md Bug 10/11）。这里真执行脚本、真看它输出的 annotation 正文。
    // ⚠️ 必须用**异步 spawn** —— 本机 vitest 里同步 spawn 一律 EBUSY（本目录既有约定）。
    const fake = [
      ' RUN  v3.2.7 /repo',
      '',
      ' ✓ tests/tools/verify-dist.test.ts (7 tests) 340ms',
      ' ❯ tests/tools/verify-workspace-frozen.test.ts (24 tests | 1 failed) 48287ms',
      '   × 测试自身不得污染真实仓库 > 真实仓库的 .vitest_cache 下不该留基线文件 18ms',
      '     → 测试污染了真实仓库：D:\\a\\scada-app\\.vitest_cache\\workspace-frozen-state.json 应不存在',
      ' FAIL  tests/tools/verify-workspace-frozen.test.ts',
      '',
      ' Test Files  1 failed (1)',
      '      Tests  1 failed | 23 passed (24)',
    ].join('\n')

    // 脚本读的是 cwd 下的 unit-tests.log
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-ut-'))
    fs.writeFileSync(path.join(dir, 'unit-tests.log'), fake, 'utf8')

    const out = await runPy(SCRIPT, dir)

    // 必须发成 annotation
    expect(out, '没有输出 ::error annotation').toContain('::error')
    // 必须含失败用例名（这是"一眼看清是哪条"的全部意义）
    expect(out, 'annotation 丢了失败用例名').toContain('真实仓库的 .vitest_cache 下不该留基线文件')
    // 必须含断言消息
    expect(out, 'annotation 丢了断言消息').toContain('测试污染了真实仓库')
    // 换行必须转义（否则 GitHub 只显示第一行）
    expect(out, 'annotation 未转义换行（会被截断成一行）').toContain('%0A')
    // 干扰项不能出现
    expect(out, '把通过的用例也塞进了 annotation').not.toContain('verify-dist.test.ts (7 tests)')

    fs.rmSync(dir, { recursive: true, force: true })
  }, 30000)

  it('无日志时 annotation 脚本必须 fail 可见（不能静默 exit 0 假装没失败）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-ut-nolog-'))
    // 不写 unit-tests.log
    const out = await runPy(SCRIPT, dir)
    expect(out, '无日志时没有报 ::error（失败被静默吞掉）').toContain('::error')
    expect(out).toContain('unit-tests.log')
    fs.rmSync(dir, { recursive: true, force: true })
  }, 30000)
})
