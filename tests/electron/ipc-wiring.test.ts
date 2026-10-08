/**
 * Electron IPC **接线状态**守卫：preload 暴露的每个方法，必须
 * 「渲染层真的在调用」**或**「在本文件的 UNWIRED 表里带理由声明为不接线」。
 *
 * 为什么需要它（与 `ipc-contract.test.ts` 是**两件事**）
 * --------------------------------------------------------
 * `ipc-contract.test.ts` 保证的是「主进程 / preload / env.d.ts 三份清单**互相一致**」——
 * 它管的是**管道有没有接错**。
 *
 * 但它**看不见另一种失败**：管道全都接得好好的，**却没有任何人用水龙头**。
 * 实测（2026-10-08，round 192）：preload 暴露 8 个方法，
 * 渲染层**只调用了 1 个**（`onBackendStatusChanged`）；另外 7 个在 `src/` 里
 * 各只有 1 处命中 —— 就是 `env.d.ts` 里的类型声明本身。
 *
 * 于是「开机自启」「运行诊断」「后端日志」「应用版本」这四个能力：
 * 主进程有实现、preload 有暴露、类型有声明、契约测试全绿，
 * **但用户界面上根本没有入口** —— 属于「功能未接线」而不是「功能不存在」。
 * 这类缺陷**不会报错**，只会让功能静默地不存在。
 *
 * 口径
 * ----
 * * 「已接线」= 在 `src/`（**排除 `env.d.ts` 这个声明文件本身**）里出现过
 *   `.<方法名>` 形式的调用；
 * * 「未接线」必须进 `UNWIRED` 表并给出**理由**；
 * * **双向断言**：新出现的未接线方法 → 红；表里声明了但已经被接上 → 也红
 *   （否则这张表会变成一份没人维护的过期清单）。
 *
 * ⚠️ 本守卫只回答「有没有人调用」，**不回答「该不该保留」**。
 * 删通道 / 补界面属产品口径，见报告与决策简报。
 *
 * 本文件还顺带钉住 round 192 一起查出来的另外两处（都是「写了但没生效」）：
 *
 * 1. **类型声明根本没生效**：`env.d.ts` 把 `interface Window` 包在 `declare global`
 *    里，而这个文件没有顶层 import/export，是**全局脚本**不是模块 ——
 *    `declare global` 惰性，`window.electronAPI` 从来没被类型化。
 *    后果不是报错而是**静默**：唯一消费者只能 `window as any` + 就地手写载荷类型，
 *    于是**声明写错了也没人发现**（实测 `onBackendStatusChanged` 的声明只写了
 *    `{healthy}`，实际载荷还有 `port` / `timeout` / `portConflict` / `missing`）。
 * 2. **语义反转**：`runDiagnostics` 的 `portAvailable` 实际等于 `!isPortOpen(...)`
 *    （= 端口**空闲**），与 `getBackendStatus` 的 `portOpen`（= 有进程在监听）
 *    **语义相反**。已改名 `portFree` 并加注释钉住。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const PRELOAD = path.join(REPO, 'electron', 'preload.js')
const SRC = path.join(REPO, 'src')
const ENV_D = path.join(SRC, 'env.d.ts')

const read = (p: string) => fs.readFileSync(p, 'utf8')

/**
 * 剥掉注释。
 *
 * ⚠️ **所有「某字符串不得出现」的断言都必须先过这一步。**
 * 本守卫第一版就栽在这上面（2026-10-08，round 192）：我在 `main.js` / `env.d.ts`
 * 里写了「**不能**叫 portAvailable」「**不能**写成 declare global」这样的解释性注释，
 * 结果守卫把**自己的说明文字**当成了违规证据 —— 4 条断言全红，
 * 而代码其实改对了。
 *
 * 这与 round 191 的 M4（子串匹配被注释喂饱）是**同一个坑，我犯了第二次** ——
 * 所以这次不只修，还把「先剥注释」做成 helper + 元守卫钉住。
 *
 * 已知局限：字符串字面量里的 `//`（如 URL）也会被剥掉。对本文件的用途无害，
 * 但**不要**拿它做「代码里是否出现过某字符串」的通用判定。
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '') // HTML/Vue 模板注释
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // 行注释（[^:] 避开 http:// 之类）
}

/** preload 通过 contextBridge 暴露的方法名（与 ipc-contract.test.ts 同一套抠法）。 */
function exposedMethods(): string[] {
  const src = read(PRELOAD)
  const block = src.match(/exposeInMainWorld\(\s*'[^']+'\s*,\s*\{([\s\S]*?)\n\}\)/)?.[1] ?? ''
  const out = new Set<string>()
  for (const m of block.matchAll(/^\s{2}(\w+)\s*:/gm)) out.add(m[1])
  return [...out].sort()
}

/** 递归收集渲染层源码（排除类型声明文件本身）。 */
function rendererFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      rendererFiles(full, out)
    } else if (/\.(ts|vue|js|tsx)$/.test(entry.name)) {
      // env.d.ts 只是**声明**，不算调用 —— 否则每个方法都会「自己引用自己」
      if (path.resolve(full) === path.resolve(ENV_D)) continue
      out.push(full)
    }
  }
  return out
}

/** 方法名 -> 在渲染层里被调用的位置（`文件:行`）。 */
function findCallers(method: string, files: string[]): string[] {
  const hits: string[] = []
  // `.<方法名>` 后必须跟 `(` 或 `?.(`，避免命中同名前缀（如 getAppVersionX）
  const re = new RegExp(`\\.${method}\\s*(?:\\?\\.)?\\(`)
  for (const f of files) {
    const lines = read(f).split(/\r?\n/)
    lines.forEach((line, i) => {
      // 跳过整行注释，避免「注释里提到过」被当成调用
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return
      if (re.test(line)) hits.push(`${path.relative(REPO, f).replace(/\\/g, '/')}:${i + 1}`)
    })
  }
  return hits
}

/**
 * 已确认**当前不接线**的方法，及理由。
 *
 * 进这张表的含义是：「这是**已知且已被判断过**的，不是漏接」。
 * 每一条都必须写清楚「被谁取代」或「属于真缺失（需要产品决策）」。
 */
const UNWIRED: Record<string, string> = {
  getAppVersion:
    '被 Vite 构建期常量 __APP_VERSION__ 取代（Config.vue:548，来源 package.json）。' +
    '注意：同一事实有两份真源（构建期常量 vs Electron app.getVersion()），且这份没人读。',
  getBackendStatus:
    '被 HTTP /api/health/status 取代（src/api/system.ts:170 getHealthStatus）。',
  getSystemInfo:
    '被 HTTP /api/system/status 取代（src/api/system.ts:146 getSystemStatus）。' +
    '注：主进程内部的 getSystemInfo() 函数仍被 run-diagnostics 使用，未接线的是这条 IPC 通道。',
  runDiagnostics: '无替代品 —— 属**真缺失**（没有诊断界面）。需产品决策。',
  onBackendLog: '无替代品 —— 属**真缺失**（没有后端日志查看界面）。需产品决策。',
  getAutoLaunch:
    '无替代品（开机自启是 OS 级能力，只有 Electron 能做）—— 属**真缺失**。需产品决策。',
  setAutoLaunch:
    '无替代品（同上）—— 属**真缺失**。需产品决策。',
}

const exposed = exposedMethods()
const files = rendererFiles(SRC)

describe('Electron IPC 接线状态（preload 暴露面 ⇄ 渲染层调用）', () => {
  it('抠出来的暴露面非空（否则守卫本身失效，会变成「空断言假绿」）', () => {
    expect(exposed.length).toBeGreaterThan(0)
    // 与 ipc-contract 的实测结果对齐：preload 当前暴露 8 个方法
    expect(exposed.length).toBe(8)
  })

  it('抠出来的渲染层文件非空（否则「没人调用」是因为没扫到文件）', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('每个暴露的方法：要么有人在渲染层调用，要么在 UNWIRED 表里声明', () => {
    const problems: string[] = []
    for (const m of exposed) {
      const callers = findCallers(m, files)
      if (callers.length === 0 && !(m in UNWIRED)) {
        problems.push(`  ${m} —— 渲染层无人调用，且未在 UNWIRED 表中声明`)
      }
    }
    expect(
      problems,
      'preload 暴露了但没人调用的方法必须显式声明（接线状态：未接线）——\n' +
        '这类「管道接好、没人用水龙头」的缺陷不会报错，只会让功能静默不存在。\n' +
        problems.join('\n'),
    ).toEqual([])
  })

  it('UNWIRED 表里的每一条都必须真的仍未接线（否则表会过期腐烂）', () => {
    const stale: string[] = []
    for (const m of Object.keys(UNWIRED)) {
      const callers = findCallers(m, files)
      if (callers.length > 0) {
        stale.push(`  ${m} —— 已经被接线了（${callers.join(', ')}），请从 UNWIRED 表里删掉`)
      }
    }
    expect(stale, 'UNWIRED 表已过期：\n' + stale.join('\n')).toEqual([])
  })

  it('UNWIRED 表里不许有已经不存在的暴露方法（防止改错名留下僵尸条目）', () => {
    const ghosts = Object.keys(UNWIRED).filter((m) => !exposed.includes(m))
    expect(ghosts, `UNWIRED 表里有已不存在的暴露方法：${ghosts.join(', ')}`).toEqual([])
  })

  it('每条未接线声明都必须写明理由（不能只写个名字）', () => {
    const noReason = Object.entries(UNWIRED)
      .filter(([, reason]) => !reason || reason.trim().length < 10)
      .map(([m]) => m)
    expect(noReason, `以下条目没写清理由：${noReason.join(', ')}`).toEqual([])
  })

  it('正向对照：已知被接线的 onBackendStatusChanged 必须被扫到', () => {
    // 如果这条红了，说明扫描口径坏了（而不是「它没被调用」）
    const callers = findCallers('onBackendStatusChanged', files)
    expect(callers.length).toBeGreaterThan(0)
    expect(callers.some((c) => c.includes('MainLayout.vue'))).toBe(true)
  })
})

/**
 * 类型声明**有没有真的生效** —— 这是与「声明内容对不对」不同的另一件事。
 *
 * 踩过（2026-10-08，round 192）：`env.d.ts` 把 `interface Window` 包在
 * `declare global { … }` 里，而这个文件**没有顶层 import/export**，
 * 是**全局脚本**而不是模块 —— `declare global` 在脚本里是惰性的，
 * 全局 `Window` 根本没被增强。
 *
 * 后果不是报错，而是**静默**：`window.electronAPI` 没有类型 →
 * 唯一的消费者只能 `window as any` + 就地手写载荷类型 → **绕过类型检查** →
 * 声明写错了也没人知道（实测载荷声明少了 4 个字段）。
 */
describe('Electron 类型声明必须真的生效（不只是「写了」）', () => {
  it('元守卫：剥注释这步真的在起作用（否则下面的断言可能被注释喂饱）', () => {
    const sample = 'const a = 1 // declare global {\n/* declare global { */\nconst b = 2'
    expect(stripComments(sample)).not.toMatch(/declare\s+global/)
    expect(sample).toMatch(/declare\s+global/) // 原文里确实有，证明剥掉的是它
  })

  it('Window 增强不得包在 declare global 里（本文件是全局脚本，不是模块）', () => {
    // 先剥注释：解释性注释里会引用这个写法本身
    const src = stripComments(read(ENV_D))
    expect(
      /declare\s+global\s*\{/.test(src),
      'env.d.ts 里出现了 `declare global { … }` —— 本文件没有顶层 import/export，' +
        '是全局脚本，`declare global` 不会生效（window.electronAPI 会失去类型，' +
        '消费者只能 `as any` 绕过）。请直接写 `interface Window { … }`。',
    ).toBe(false)
  })

  it('确实声明了全局 Window.electronAPI（防止「删掉增强」也算通过）', () => {
    const src = stripComments(read(ENV_D))
    expect(/^interface Window \{[\s\S]*?electronAPI\?: ElectronAPI/m.test(src)).toBe(true)
  })

  it('渲染层不得用 `window as any` 绕过 electronAPI 的类型', () => {
    const offenders: string[] = []
    for (const f of files) {
      // 先剥注释再扫：解释性注释里会引用 `window as any` 这个写法
      const lines = stripComments(read(f)).split(/\r?\n/)
      if (!lines.some((l) => /electronAPI/.test(l))) continue
      lines.forEach((line, i) => {
        if (/window\s+as\s+any/.test(line)) {
          offenders.push(`${path.relative(REPO, f).replace(/\\/g, '/')}:${i + 1}`)
        }
      })
    }
    expect(
      offenders,
      '这些文件用 `window as any` 绕过了 electronAPI 的类型 —— ' +
        '类型声明一旦被绕过，写错了也没人发现：\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})

/**
 * 语义反转守卫：`runDiagnostics` 的端口字段。
 *
 * `isPortOpen()` 的语义是「能连上（有进程在监听）」，所以
 * `!isPortOpen(...)` 是「端口**空闲**」。原先字段名叫 `portAvailable`，
 * 与 `getBackendStatus` 的 `portOpen` 恰好**语义相反** ——
 * 同一个概念两套名字、其中一套还是反的，读的人会得出相反结论。
 */
describe('端口字段不得再用语义相反的 portAvailable', () => {
  it('main.js 的 run-diagnostics 用 portFree', () => {
    const src = stripComments(read(path.join(REPO, 'electron', 'main.js')))
    expect(src).not.toMatch(/\bportAvailable\b/)
    expect(src).toMatch(/\bportFree\b/)
  })

  it('env.d.ts 同步声明 portFree（两侧一致）', () => {
    const src = stripComments(read(ENV_D))
    expect(src).not.toMatch(/\bportAvailable\b/)
    expect(src).toMatch(/\bportFree\b/)
  })

  it('portFree 的语义与 isPortOpen 相反 —— 声明里必须写明，避免下次又被改回', () => {
    const src = read(ENV_D)
    const at = src.indexOf('portFree')
    expect(at, 'env.d.ts 里找不到 portFree').toBeGreaterThan(-1)
    // 注释在 portFree **上方**，所以取前后各 600 字符的窗口
    const window = src.slice(Math.max(0, at - 600), at + 600)
    expect(window, 'portFree 附近缺少「语义相反」的说明注释').toMatch(/语义相反/)
  })
})
