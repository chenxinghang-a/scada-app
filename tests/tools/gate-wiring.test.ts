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
 * 判据（四条，各自独立）
 * ----------------------
 *   ① `tools/` 下每个 `verify-*.js` 必须能从 `electron:build` 链走到
 *      （递归展开 `npm run`，不只看字面）；
 *   ② 本地链能走到的每道闸门，**CI 也必须能走到**（补上 gate-parity 的反方向：
 *      它查的是「CI 的闸门本地有没有」，查不到「本地的闸门 CI 有没有」）；
 *   ③ 判别力自检：一段**合成的死闸门**必须被 ① 的算法判定为"不可达"。
 *      没有 ③，①可能因为"连 readdir 都没读到"而恒绿。
 *   ④ **反向完整性**：链上引用的每个 `node tools/*.js` 文件都**必须真实存在**。
 *      ① 查的是「文件→链」（有没有人跑它），④ 查的是「链→文件」（引用有没有落空）。
 *      两者合起来才是双射；只做 ① 会出现「把 verify-dist.js 改名后忘了改 package.json」
 *      这种链上悬空引用仍然全绿的情况（实测确认，见 ④b）。
 *   ⑤ **孤儿脚本**：`scripts/` 下的每个脚本都必须**被某处引用**（npm script / CI /
 *      测试 / 源码）。①~④ 只覆盖 `tools/`，`scripts/` 是同一盲区的另一半 ——
 *      一个跟踪在册、看着像"工具"、却没人调用的脚本，不但是死代码，
 *      还会误导后人以为它在生效（本仓实测发现 `scripts/generate-api.ts`，见 ⑤）。
 *
 * ⚠️ 本守卫只回答「有没有人跑它」，**不回答「该不该有这道闸门」**。
 *    失效（作废）的闸门应由人**删除文件**，而不是靠把它登记成"已知死闸门"。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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

/**
 * 递归展开一组 npm script，返回它**引用到的所有 `node tools/*.js` 路径**。
 *
 * 与 reachableGates 的区别：这里**不做 `verify-` 前缀过滤** —— 目的是抓
 * "链上写了 `node tools/xxx.js` 但那个文件根本不在"的悬空引用，无论它叫
 * 什么名字。两条判据（③④）因此互相独立：① 只看 verify-*，④ 看全部引用。
 */
function referencedToolFiles(entrypoints: string[], scripts: Scripts): Set<string> {
  const refs = new Set<string>()
  const visited = new Set<string>()

  const walk = (name: string) => {
    if (visited.has(name)) return
    visited.add(name)
    const body = scripts[name]
    if (!body) return
    for (const raw of body.split('&&')) {
      const cmd = raw.trim()
      const ref = cmd.match(/node\s+(tools\/[\w.-]+\.js)/)
      if (ref) refs.add(ref[1])
      const nested = cmd.match(/npm\s+run\s+([\w:-]+)/)
      if (nested) walk(nested[1])
    }
  }

  for (const e of entrypoints) walk(e)
  return refs
}

/** 本仓 `tools/` 下实际存在的 `.js` 文件集合。 */
function existingToolFiles(): Set<string> {
  return new Set(
    fs
      .readdirSync(TOOLS_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => `tools/${f}`),
  )
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

  it('④ 链上引用的每个 node tools/*.js 都必须真实存在（防悬空引用）', () => {
    const refs = referencedToolFiles(BUILD_ENTRYPOINTS, scripts())
    expect(refs.size, '本地链一个 tools/*.js 引用都没解析到，守卫本身失效').toBeGreaterThan(0)

    const existing = existingToolFiles()
    // 只查 tools/ 下的引用（本仓约定：闸门/工具都在 tools/，其它路径不在本判据范围）
    const missing = [...refs].filter((r) => !existing.has(r)).sort()

    expect(
      missing,
      '以下文件被 npm script 引用（`node tools/xxx.js`），但 `tools/` 下**不存在** —— ' +
        '引用落空。要么文件名写错了，要么文件被改名/删除后忘了同步 package.json：\n' +
        missing.map((m) => `  ${m}`).join('\n') +
        '\n（这类悬空引用在 ① 里是盲区：① 只查"存在的 verify-* 有没有人跑"，' +
        '查不出"链上引用的文件在不在"。）',
    ).toEqual([])
  })

  it('④b 判别力自检：链上多串一个不存在的文件，referencedToolFiles 必须能报出来', () => {
    // 没有这条，④ 可能因为"正则没匹配到任何东西"而恒绿（missing 恒空）。
    const synthetic: Scripts = {
      'electron:build': 'npm run verify:dist',
      'verify:dist':
        'node tools/verify-dist.js && node tools/verify-typo-does-not-exist.js',
    }
    const refs = referencedToolFiles(['electron:build'], synthetic)
    expect([...refs].sort()).toEqual([
      'tools/verify-dist.js',
      'tools/verify-typo-does-not-exist.js',
    ])
    // 用真实文件集判定：不存在的那个必须被判为 missing
    const existing = existingToolFiles()
    expect(existing.has('tools/verify-typo-does-not-exist.js')).toBe(false)
    expect(existing.has('tools/verify-dist.js')).toBe(true)
  })

  it('⑤ 脚本位置（根目录 / scripts/ / .github/scripts/）下的脚本必须有人引用', () => {
    const orphans = findOrphanScripts()
    expect(
      orphans,
      '以下脚本**没有任何引用者**（不在任何 npm script、CI 步骤、测试或其它源码里被调用）' +
        '—— 写了等于没写，且容易误导后人以为它在生效：\n' +
        orphans.map((o) => `  ${o}`).join('\n') +
        '\n修法：把它接进正确的链路（npm script / CI / 测试），或删掉它（若已作废）；' +
        '若确实是"一次性生成器"（产物已入库、只需按需重跑），加进 ONE_SHOT_GENERATORS 并写理由。' +
        '\n（本仓纪律：失效脚本应由人删除文件，而不是登记成"已知孤儿"。）',
    ).toEqual([])
  })

  it('⑤b 判别力自检：findOrphanScripts 能区分「被引用」与「没人引用」', () => {
    // 用真实仓库的脚本集合，但喂一份合成的"引用者文本"：
    // 不包含任何脚本名 → 全部（除一次性生成器豁免外）都应被判孤儿（证明识别非恒空）；
    // 含某个脚本名 → 那个必须落榜（证明匹配真的生效）。
    const real = scandScriptFiles()
    if (real.length === 0) return // 无候选脚本时本判据不适用（不假装通过）

    const exempt = new Set(ONE_SHOT_GENERATORS.map((e) => e.file))
    const none = findOrphanScripts({ referrers: '' })
    expect(
      none.length,
      '空引用者文本下的孤儿数 != 候选脚本数 − 豁免数（识别失效则恒空）',
    ).toBe(real.length - exempt.size)

    const target = real.find((f) => !exempt.has(f))
    if (target) {
      const one = findOrphanScripts({ referrers: `npx ts-node ${target}` })
      expect(one.includes(target), '引用者文本里出现了却仍被判孤儿 —— 匹配失效').toBe(false)
    }
  })

  it('⑤c 一次性生成器豁免表不得含「已不存在的文件」（防豁免表变垃圾场）', () => {
    const stale = ONE_SHOT_GENERATORS.filter((e) => !fs.existsSync(path.join(REPO, e.file)))
    expect(
      stale.map((e) => e.file),
      '以下文件已加到 ONE_SHOT_GENERATORS 豁免表，但文件**已不存在** —— ' +
        '豁免表应在文件删除时同步清理，否则它会积累成"看起来有人管、实际是垃圾"的清单：',
    ).toEqual([])
    // 豁免表每条都必须写理由（防止有人图省事塞个空理由进来）
    const noReason = ONE_SHOT_GENERATORS.filter((e) => !e.why?.trim())
    expect(noReason.map((e) => e.file), '豁免表有条目没写理由').toEqual([])
  })
})

/**
 * 找出「脚本位置」下**没有任何引用者**的脚本。
 *
 * 脚本位置（`SCRIPT_LOCATIONS`，扩展名按位置区分 —— 见该常量注释）：
 *   · 仓库根目录（`.py` / `.sh` / `.bat` / `.cjs` / `.mjs`）—— 例如 `generate_icons.py`
 *   · `scripts/`（`.ts` / `.js` / `.cjs` / `.mjs` / `.py` / `.sh` / `.bat`）
 *   · `.github/scripts/`（同上）
 * 注意**不扫** `tools/`（那是 ①~④ 的地盘）与 `electron/`、`src/`（那是运行时代码）。
 *
 * 判据：「引用者文本」= 全部 npm script 命令 + package.json + ci.yml +
 * 全仓测试/源码正文（`.ts/.js/.vue/.json/.yml/.md`）拼接。某脚本文件名
 * （不含扩展名的 basename）在其中**一次都没出现**，即为孤儿 —— 除非它在
 * `ONE_SHOT_GENERATORS` 豁免表里（见该表注释）。
 *
 * ⚠️ **必须排除本守卫文件自身**（实测踩过）：本守卫的注释里会点名被检查的脚本
 * （例如"本仓实测发现 `scripts/generate-api.ts`"），若把自身计入引用者，
 * 就会**自己把自己的点名当成"有人引用"** → 真孤儿被静默放过（假绿）。
 * 这是一类通用陷阱：**审计工具的输出/说明不得回喂给它自己的判据**。
 *
 * 为什么用 basename 而非全路径：调用姿势五花八门（`ts-node scripts/x.ts`、
 * `node ./scripts/x.js`、`import '../scripts/x'`），路径前缀不可靠；
 * basename 命中即算被引用 —— 宁可**漏报**（把真孤儿看成被引用，如某文档顺带
 * 提过一嘴）也不**误报**（把在用的脚本判成孤儿）。⑤ 的价值是抓"完全没人提"的脚本。
 *
 * `opts.referrers` 仅用于判别力自检（⑤b）注入合成的引用者文本。
 */
function findOrphanScripts(opts?: { referrers?: string }): string[] {
  const files = scandScriptFiles()
  if (files.length === 0) return []

  let haystack = opts?.referrers
  if (haystack === undefined) {
    const s = scripts()
    const pkgText = read(PKG)
    const ciText = fs.existsSync(CI) ? read(CI) : ''
    const selfPath = fileURLToPath(import.meta.url)
    const srcText = collectSourceText(
      [
        path.join(REPO, 'tests'),
        path.join(REPO, 'src'),
        path.join(REPO, 'electron'),
        path.join(REPO, 'tools'),
        path.join(REPO, '.github'),
      ],
      selfPath,
    )
    haystack =
      Object.values(s).join('\n') + '\n' + pkgText + '\n' + ciText + '\n' + srcText
  }

  const exempt = new Set(ONE_SHOT_GENERATORS.map((e) => e.file))
  return files.filter((f) => {
    if (exempt.has(f)) return false
    const base = path.basename(f).replace(/\.(ts|js|cjs|mjs|py|sh|bat)$/, '')
    // basename 未在引用者文本中出现 → 孤儿。路径分隔符统一成正斜杠便于展示。
    return !haystack!.includes(base)
  })
}

/** 收集「脚本位置」下的候选脚本（相对仓库根的路径，正斜杠）。 */
function scandScriptFiles(): string[] {
  const out: string[] = []
  for (const loc of SCRIPT_LOCATIONS) {
    const dir = path.join(REPO, loc.dir)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (!loc.exts.test(f)) continue
      out.push(loc.dir === '.' ? f : `${loc.dir}/${f}`)
    }
  }
  return out.sort()
}

/**
 * 「一次性生成器」豁免表 —— 这些脚本**有意**不被任何链路调用：
 * 产物已入库，只在需要时（改设计 / 换图标）手工重跑一次。
 *
 * ⚠️ 加进这张表**必须**写 `why`（说清"为什么不需要被引用"），
 * 并且**文件被删除时必须同步删掉表项**（⑤c 会拦下悬空表项）。
 * 这是本仓纪律「失效脚本应由人删文件，而不是登记成已知孤儿」的**窄例外**：
 * 一次性生成器的产物是入库的，删掉脚本反而丢失"怎么重新生成"的知识。
 */
const ONE_SHOT_GENERATORS: Array<{ file: string; why: string }> = [
  {
    file: 'generate_icons.py',
    why:
      '一次性图标生成器：产物 resources/icon.ico 等已入库，仅在改图标设计时手工重跑。' +
      '不是构建链一环，故有意不被引用。',
  },
]

/**
 * 脚本位置（相对仓库根 + 该位置认的扩展名）。
 *
 * ⚠️ **根目录只认 `.py/.sh/.bat/.cjs/.mjs`**，不含 `.ts/.js` —— 根下的
 * `vite.config.ts` / `vitest.config.ts` 是**工具配置**（由 vite/vitest 隐式加载，
 * 没有任何地方按名字引用它们），把它们当"脚本"会产生恒假阳性（实测踩过）。
 * 子目录（`scripts/`、`.github/scripts/`）才认 `.ts/.js`（那里是真正的脚本）。
 */
const SCRIPT_LOCATIONS: Array<{ dir: string; exts: RegExp }> = [
  { dir: '.', exts: /\.(py|sh|bat|cjs|mjs)$/ },
  { dir: 'scripts', exts: /\.(ts|js|cjs|mjs|py|sh|bat)$/ },
  { dir: '.github/scripts', exts: /\.(ts|js|cjs|mjs|py|sh|bat)$/ },
]


/** 递归收集一组目录下所有文本文件的正文（跳过 node_modules / .vitest_cache / dist / 自身）。 */
function collectSourceText(dirs: string[], excludeSelf?: string): string {
  const SKIP = new Set(['node_modules', '.vitest_cache', 'dist', 'dist-iso', 'release', '.git'])
  const EXTS = /\.(ts|js|cjs|mjs|vue|json|yml|yaml|md)$/
  const self = excludeSelf ? path.resolve(excludeSelf) : null
  const out: string[] = []
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (EXTS.test(e.name)) {
        // ⚠️ 排除本守卫文件自身：它的说明性文字会被误当成"引用者"（见函数头注）
        if (self && path.resolve(p) === self) continue
        try {
          out.push(fs.readFileSync(p, 'utf8'))
        } catch {
          /* 二进制/不可读：忽略 */
        }
      }
    }
  }
  for (const d of dirs) walk(d)
  return out.join('\n')
}
