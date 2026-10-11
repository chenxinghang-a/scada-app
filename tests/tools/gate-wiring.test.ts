/**
 * 闸门接线守卫（**死闸门**探测器）—— `tools/verify-*.js` 的「反向平价」。
 *
 * 为什么需要这条
 * --------------
 * 已有 `gate-parity.test.ts` 管 **CI → 本地** 一个方向：
 *   「CI 里出现的每条 `node tools/verify-*.js`，本地都得有 npm script 能走到」。
 *
 * 但它**不管反方向**：
 *   「`tools/` 下存在的每道闸门，是不是真的有人会跑它？」
 *
 * 于是可以出现 **死闸门（dead gate）** —— 比没有闸门**更坏**：
 *   · 文件在、名字像闸门、review 时看着"有覆盖"；
 *   · 但 `electron:build` 与 CI **都不调用它**；
 *   · 它永远绿（因为没人跑），也永远不会拦下任何东西。
 * 这与本项目栽过的「闸门装了 ≠ 闸门走得到」「判据与意图隔一层」同族
 * （见 MEMORY 硬规则 21、BUGS.md Bug 10/11）。
 *
 * 这条守卫沿用了本仓既有的「接线守卫」家族形态（`api-wiring` / `component-wiring`
 * / `ipc-wiring` 都是这个形状）：**双向** —— 死闸门要红，登记表里的也要在。
 *
 * 判据（三条，各自独立）
 * ----------------------
 *   ① `tools/` 下每个 `verify-*.js` 必须能从 `electron:build` 链走到
 *      （递归展开 `npm run`，不只看字面）；
 *   ② 本地链能走到的每道闸门，**CI 也必须能走到**（补上 gate-parity 的反方向：
 *      它查的是「CI 的闸门本地有没有」，查不到「本地的闸门 CI 有没有」）；
 *   ③ 判别力自检：一段**合成的死闸门**必须被 ① 的算法判定为"不可达"。
 *      没有 ③，①可能因为"连 readdir 都没读到"而恒绿。
 *
 * ⚠️ 本守卫只回答「有没有人跑它」，**不回答「该不该有这道闸门」**。
 *    失效（作废）的闸门应由人**删除文件**，而不是靠把它登记成"已知死闸门"。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const TOOLS_DIR = path.join(REPO, 'tools')
const PKG = path.join(REPO, 'package.json')
const CI = path.join(REPO, '.github', 'workflows', 'ci.yml')

const read = (p: string) => fs.readFileSync(p, 'utf8')

/** 本地打包链的起点（这三条都在；任一覆盖到闸门即算"本地可达"）。 */
const BUILD_ENTRYPOINTS = ['electron:build', 'electron:build:frozen', 'electron:build:dir']

type Scripts = Record<string, string>

/**
 * 递归展开一个 npm script，返回它**最终执行的 `node tools/xxx.js` 列表**。
 *
 * 为什么必须递归：`electron:build` 里写的是 `npm run verify:dist`，
 * `verify:dist` 才是 `node tools/verify-dist.js`。只看第一层会**漏掉全部闸门**
 * （第一层一个 `node tools/` 都没有）。
 */
function reachableGates(entrypoints: string[], scripts: Scripts): Set<string> {
  const found = new Set<string>()
  const visited = new Set<string>()

  const walk = (name: string) => {
    if (visited.has(name)) return
    visited.add(name)
    const body = scripts[name]
    if (!body) return
    for (const raw of body.split('&&')) {
      const cmd = raw.trim()
      // 命中闸门文件
      const gate = cmd.match(/node\s+(tools\/[\w.-]+\.js)/)
      if (gate) found.add(gate[1])
      // 继续展开嵌套的 npm run
      const nested = cmd.match(/npm\s+run\s+([\w:-]+)/)
      if (nested) walk(nested[1])
    }
  }

  for (const e of entrypoints) walk(e)
  return found
}

/** `tools/` 下所有 `verify-*.js`（闸门文件）。 */
function allGateFiles(): string[] {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((f) => /^verify-.*\.js$/.test(f))
    .map((f) => `tools/${f}`)
    .sort()
}

function scripts(): Scripts {
  return JSON.parse(read(PKG)).scripts ?? {}
}

/** 从 ci.yml 抠出**最终执行**的 `node tools/verify-*.js`（经 npm run 展开）。 */
function ciReachableGates(): Set<string> {
  const ciText = read(CI)
  const s = scripts()
  const found = new Set<string>()

  // CI 直接写的 `node tools/verify-*.js`（带 run: 或裸命令）
  for (const line of ciText.split(/\r?\n/)) {
    const t = line.trim()
    if (t.startsWith('#')) continue
    const m = t.match(/^(?:run:\s*)?node\s+(tools\/verify-[\w.-]+\.js)/)
    if (m) found.add(m[1])
  }

  // CI 里 `npm run X` 的 X —— 展开后把里面的闸门也收进来
  const visited = new Set<string>()
  const walk = (name: string) => {
    if (visited.has(name)) return
    visited.add(name)
    const body = s[name]
    if (!body) return
    for (const raw of body.split('&&')) {
      const cmd = raw.trim()
      const g = cmd.match(/node\s+(tools\/verify-[\w.-]+\.js)/)
      if (g) found.add(g[1])
      const n = cmd.match(/npm\s+run\s+([\w:-]+)/)
      if (n) walk(n[1])
    }
  }
  for (const m of ciText.matchAll(/npm\s+run\s+([\w:-]+)/g)) walk(m[1])

  return found
}

describe('闸门接线（死闸门探测）', () => {
  it('① tools/ 下每道 verify-*.js 都必须能从本地打包链走到', () => {
    const gates = allGateFiles()
    // 若这是 0，说明 readdir 目标目录不对 —— 守卫自身失效，必须显式失败
    expect(gates.length, '没扫到任何网关文件，守卫本身失效').toBeGreaterThan(0)

    const local = reachableGates(BUILD_ENTRYPOINTS, scripts())
    const dead = gates.filter((g) => !local.has(g))

    expect(
      dead,
      '以下闸门文件存在、但从 electron:build 链**走不到** —— 它们永远是死闸门' +
        '（没人跑，所以永远绿，也永远拦不下任何东西）：\n' +
        dead.map((d) => `  ${d}`).join('\n') +
        '\n修法：要么把它接进 electron:build（若它该拦发布），要么删掉它（若已作废）。',
    ).toEqual([])
  })

  it('② 本地链可达的闸门，CI 也必须可达（补 gate-parity 的反方向）', () => {
    const local = reachableGates(BUILD_ENTRYPOINTS, scripts())
    const ci = ciReachableGates()

    expect(local.size, '本地链一道闸门都没走到，守卫本身失效').toBeGreaterThan(0)
    expect(ci.size, 'CI 一道闸门都没走到，守卫本身失效').toBeGreaterThan(0)

    const onlyLocal = [...local].filter((g) => !ci.has(g)).sort()

    expect(
      onlyLocal,
      '以下闸门**本地会跑、CI 不会跑** —— 意味着 CI 全绿也代表不了本地打包链是好的' +
        '（CI 漏测了这些闸门）：\n' +
        onlyLocal.map((d) => `  ${d}`).join('\n') +
        '\n修法：把对应闸门接进 CI（见 ci.yml 的 electron-build job）。',
    ).toEqual([])
  })

  it('③ 判别力自检：合成一段「死闸门」脚本，reachableGates 必须判定为不可达', () => {
    // 没有这条，①可能因为"展开算法根本没工作 / readdir 空"而恒绿。
    // 用一个**合成** scripts 对象：entry 只跑一道真闸门，另有一道从不被引用。
    const synthetic: Scripts = {
      'electron:build': 'npm run verify:dist && electron-builder --win',
      'verify:dist': 'node tools/verify-dist.js',
      'verify:orphan': 'node tools/verify-orphan-never-called.js',
    }
    const got = reachableGates(['electron:build'], synthetic)
    expect([...got], '应只收到达得到的那道').toEqual(['tools/verify-dist.js'])
    expect(
      got.has('tools/verify-orphan-never-called.js'),
      '合成死闸门竟然被判为可达 —— ①的展开算法失效',
    ).toBe(false)
  })

  it('③b 判别力自检：嵌套 npm run（两层）也必须被展开到', () => {
    const synthetic: Scripts = {
      'electron:build': 'npm run verify:packaged',
      'verify:packaged': 'npm run verify:asar && npm run verify:backend-runtime:shipped',
      'verify:asar': 'node tools/verify-asar.js release/win-unpacked/resources/app.asar',
      'verify:backend-runtime:shipped': 'node tools/verify-backend-runtime.js --exe release/x.exe',
    }
    const got = reachableGates(['electron:build'], synthetic)
    expect([...got].sort()).toEqual([
      'tools/verify-asar.js',
      'tools/verify-backend-runtime.js',
    ])
  })

  it('③c 判别力自检：CI 侧解析也能认出经 npm run 间接调用的闸门', () => {
    // ciReachableGates 读的是真文件；这里只断言真 CI 里能认出 verify:dist 背后的
    // verify-dist.js（它**不在** CI 里以裸 `node tools/…` 出现，只以 `npm run verify:dist`）。
    const ci = ciReachableGates()
    expect(ci.has('tools/verify-dist.js'), 'CI 解析漏了经 npm run 间接调用的闸门').toBe(true)
  })
})
