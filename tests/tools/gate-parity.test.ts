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
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const CI = path.join(REPO, '.github', 'workflows', 'ci.yml')
const PKG = path.join(REPO, 'package.json')

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

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
